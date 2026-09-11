/* PronounceAll — Copyright (C) 2026 Alp Kavaklı
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * See LICENSE-NOTICE.md at the repository root. */

/**
 * The Piper synthesis adapter (V1, C6, FR-CONTENT-02/04).
 *
 * BUILD-TIME ONLY. Piper is "run as a separate batch tool, not linked into the
 * application" (V1), so this module spawns the Piper CLI from a dedicated
 * virtualenv and is imported by `scripts/` alone. Nothing on the request path
 * may import it — SDD §2 is explicit that the request path makes no call to any
 * text-to-speech provider, and the C4 zone rules keep `services/` and `routes/`
 * from reaching a concrete infrastructure client like this one. It is injected
 * into `produceAsset` as the `produce` function by the batch entry point.
 *
 * Generation input is NOT derived here. It comes from the committed profile
 * `data/seed/en-us.piper-profile.json`, which records the owner-approved
 * canonical-unit -> Piper raw phoneme mapping. That mapping is synthesis
 * metadata: it is model-specific, never learner-facing, and must never be fed
 * back into the tokenizer, the normaliser, or D4.
 *
 * The preflight fails closed. A voice whose config has drifted, a speaker name
 * that no longer resolves to the recorded id, or a required phoneme codepoint
 * missing from the model's `phoneme_id_map` all stop the batch BEFORE any audio
 * is produced, because each of those silently changes what a learner would hear
 * under a key that promises otherwise.
 */

import { execFile } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/** Where the offline tooling lives by default; overridable for CI. */
export const DEFAULT_TOOL_ROOT = process.env.PIPER_TOOL_ROOT ?? 'tools/piper';

/** Silence floor. A 16-bit sample peak at or below this is not audible content. */
const SILENCE_PEAK_THRESHOLD = 64;

/**
 * Load the committed generation profile.
 *
 * @param {string} [variantCode]
 * @param {string} [seedDir]
 * @returns {Promise<object>}
 */
export async function loadProfile(variantCode = 'en-us', seedDir = 'data/seed') {
  if (!/^[a-z]{2}-[a-z]{2}$/.test(variantCode)) {
    throw new Error(`Malformed variant code: ${variantCode}`);
  }
  const file = path.join(seedDir, `${variantCode}.piper-profile.json`);
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  return JSON.parse(await fs.readFile(file, 'utf8'));
}

/**
 * Resolve the tooling paths for a profile.
 *
 * @param {object} profile
 * @param {string} [toolRoot]
 * @returns {{python: string, model: string, config: string}}
 */
export function resolveTooling(profile, toolRoot = DEFAULT_TOOL_ROOT) {
  const python =
    process.platform === 'win32'
      ? path.join(toolRoot, '.venv', 'Scripts', 'python.exe')
      : path.join(toolRoot, '.venv', 'bin', 'python');

  return {
    python,
    model: path.join(toolRoot, 'voices', profile.voice.modelFile),
    config: path.join(toolRoot, 'voices', profile.voice.configFile),
  };
}

/** @param {string} file */
async function sha256Of(file) {
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  const bytes = await fs.readFile(file);
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

/**
 * Verify the installed voice against the profile before anything is generated.
 *
 * Checks, in order of how quietly they would corrupt the output:
 *   1. the tooling and voice files exist;
 *   2. the model and config digests match the pinned values (V4 reproducibility);
 *   3. the speaker NAME still resolves to the recorded speaker id — a remap
 *      would change the voice while every asset key stayed identical;
 *   4. every codepoint every raw sequence needs exists in `phoneme_id_map`.
 *      The map is codepoint-based, so a two-codepoint teaching unit such as
 *      `tʃ` needs both of its codepoints present; that is an implementation
 *      detail of the model and does not make the unit non-atomic.
 *
 * @param {object} profile
 * @param {{toolRoot?: string, requireDigests?: boolean}} [options]
 * @returns {Promise<{problems: string[], checkedCodepoints: number, voiceConfig: object}>}
 */
export async function preflight(profile, { toolRoot = DEFAULT_TOOL_ROOT, requireDigests = true } = {}) {
  const problems = [];
  const tooling = resolveTooling(profile, toolRoot);

  for (const [label, file] of Object.entries(tooling)) {
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    const present = await fs.stat(file).then(() => true).catch(() => false);
    if (!present) {
      problems.push(`${label} not found at ${file}`);
    }
  }
  if (problems.length > 0) {
    return { problems, checkedCodepoints: 0, voiceConfig: null };
  }

  if (requireDigests) {
    const modelSha = await sha256Of(tooling.model);
    if (modelSha !== profile.voice.modelSha256) {
      problems.push(`model digest ${modelSha}, profile pins ${profile.voice.modelSha256}`);
    }
    const configSha = await sha256Of(tooling.config);
    if (configSha !== profile.voice.configSha256) {
      problems.push(`config digest ${configSha}, profile pins ${profile.voice.configSha256}`);
    }
  }

  // eslint-disable-next-line security/detect-non-literal-fs-filename
  const voiceConfig = JSON.parse(await fs.readFile(tooling.config, 'utf8'));

  const speakerMap = voiceConfig.speaker_id_map ?? {};
  const resolved = speakerMap[profile.voice.speakerName];
  if (resolved === undefined) {
    problems.push(`speaker ${profile.voice.speakerName} is absent from the voice's speaker_id_map`);
  } else if (resolved !== profile.voice.speakerId) {
    problems.push(
      `speaker ${profile.voice.speakerName} resolves to id ${resolved}, profile pins ${profile.voice.speakerId}`,
    );
  }

  if (voiceConfig.audio?.sample_rate !== undefined && voiceConfig.audio.sample_rate !== profile.voice.sampleRate) {
    problems.push(`voice sample rate ${voiceConfig.audio.sample_rate}, profile pins ${profile.voice.sampleRate}`);
  }

  const phonemeMap = voiceConfig.phoneme_id_map ?? {};
  const missing = new Map();
  let checkedCodepoints = 0;

  for (const unit of profile.units) {
    for (const codepoint of [...unit.piperRawPhonemes]) {
      checkedCodepoints += 1;
      if (!Object.hasOwn(phonemeMap, codepoint)) {
        const hex = codepoint.codePointAt(0).toString(16).padStart(4, '0');
        missing.set(`${codepoint} (U+${hex.toUpperCase()})`, unit.ipaSymbol);
      }
    }
  }
  for (const [codepoint, symbol] of missing) {
    problems.push(`phoneme_id_map has no ${codepoint}, required by /${symbol}/`);
  }

  return { problems, checkedCodepoints, voiceConfig };
}

/**
 * Parse a RIFF/WAVE payload far enough to judge whether it is usable audio.
 *
 * @param {Buffer} bytes
 * @returns {{channels: number, sampleRate: number, bitsPerSample: number, sampleCount: number, peak: number, durationSeconds: number}}
 * @throws {Error} when the payload is not a WAV this project can serve
 */
export function inspectWav(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 44) {
    throw new Error('not a WAV payload: shorter than a RIFF header');
  }
  if (bytes.toString('ascii', 0, 4) !== 'RIFF' || bytes.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error('not a WAV payload: missing the RIFF/WAVE markers');
  }

  // Walk the chunk list rather than assuming a canonical 44-byte header.
  let offset = 12;
  let fmt = null;
  let dataStart = -1;
  let dataLength = 0;

  while (offset + 8 <= bytes.length) {
    const id = bytes.toString('ascii', offset, offset + 4);
    const size = bytes.readUInt32LE(offset + 4);

    if (id === 'fmt ') {
      fmt = {
        channels: bytes.readUInt16LE(offset + 10),
        sampleRate: bytes.readUInt32LE(offset + 12),
        bitsPerSample: bytes.readUInt16LE(offset + 22),
      };
    } else if (id === 'data') {
      dataStart = offset + 8;
      dataLength = Math.min(size, bytes.length - dataStart);
    }
    offset += 8 + size + (size % 2);
  }

  if (!fmt) {
    throw new Error('not a WAV payload: no fmt chunk');
  }
  if (dataStart < 0 || dataLength <= 0) {
    throw new Error('WAV has no audio data');
  }
  if (fmt.bitsPerSample !== 16) {
    throw new Error(`unsupported sample width: ${fmt.bitsPerSample}-bit`);
  }

  let peak = 0;
  for (let i = dataStart; i + 1 < dataStart + dataLength; i += 2) {
    const sample = Math.abs(bytes.readInt16LE(i));
    if (sample > peak) {
      peak = sample;
    }
  }

  const sampleCount = Math.floor(dataLength / 2);
  return {
    ...fmt,
    sampleCount,
    peak,
    durationSeconds: sampleCount / fmt.channels / fmt.sampleRate,
  };
}

/**
 * Reject audio that is structurally valid but useless.
 *
 * These are conservative, mechanical checks: decodable, non-empty, non-silent,
 * and the declared sample format. Nothing here claims the clip is the RIGHT
 * sound — that is the maintainer listening pass, and no automated metric
 * substitutes for it.
 *
 * @param {Buffer} bytes
 * @param {object} expected the profile's `output` block
 * @returns {{channels: number, sampleRate: number, bitsPerSample: number, sampleCount: number, peak: number, durationSeconds: number}}
 */
export function assertUsableAudio(bytes, expected) {
  const info = inspectWav(bytes);

  if (info.channels !== expected.channels) {
    throw new Error(`expected ${expected.channels} channel(s), got ${info.channels}`);
  }
  if (info.sampleRate !== expected.sampleRate) {
    throw new Error(`expected ${expected.sampleRate} Hz, got ${info.sampleRate}`);
  }
  if (info.bitsPerSample !== expected.sampleWidthBytes * 8) {
    throw new Error(`expected ${expected.sampleWidthBytes * 8}-bit, got ${info.bitsPerSample}`);
  }
  if (info.sampleCount === 0) {
    throw new Error('generated audio contains no samples');
  }
  if (info.peak <= SILENCE_PEAK_THRESHOLD) {
    throw new Error(`generated audio is silent (peak amplitude ${info.peak})`);
  }

  return info;
}

/**
 * Build the `produce` function `produceAsset` injects.
 *
 * One Piper invocation per unit. The input is written to a UTF-8 file rather
 * than piped through stdin, because the raw phoneme payload carries non-ASCII
 * codepoints and the console encoding is not dependable on every platform.
 *
 * @param {object} profile
 * @param {{toolRoot?: string}} [options]
 * @returns {(unit: object) => Promise<{bytes: Buffer, mimeType: string, info: object}>}
 */
export function createSynthesiser(profile, { toolRoot = DEFAULT_TOOL_ROOT } = {}) {
  const tooling = resolveTooling(profile, toolRoot);

  return async function synthesise(unit) {
    const scratch = await fs.mkdtemp(path.join(os.tmpdir(), 'pronounceall-piper-'));
    const inputFile = path.join(scratch, 'input.txt');
    const outputFile = path.join(scratch, 'output.wav');

    try {
      // eslint-disable-next-line security/detect-non-literal-fs-filename
      await fs.writeFile(inputFile, unit.piperInput, 'utf8');

      await execFileAsync(
        tooling.python,
        [
          '-m',
          'piper',
          '-m',
          tooling.model,
          '-c',
          tooling.config,
          '-s',
          String(profile.voice.speakerId),
          '-i',
          inputFile,
          '-f',
          outputFile,
        ],
        { env: { ...process.env, PYTHONIOENCODING: 'utf-8' }, maxBuffer: 16 * 1024 * 1024 },
      );

      // eslint-disable-next-line security/detect-non-literal-fs-filename
      const bytes = await fs.readFile(outputFile);
      const info = assertUsableAudio(bytes, profile.output);

      return { bytes, mimeType: profile.output.mimeType, info };
    } finally {
      await fs.rm(scratch, { recursive: true, force: true });
    }
  };
}

/**
 * Synthesise many texts in ONE Piper invocation.
 *
 * Loading the 131 MB model dominates a single-item run: 41 separate invocations
 * cost about 1.6 s each, while one invocation over many lines costs that once
 * and roughly 0.1 s per additional item. For the several-thousand-word batch
 * that is the difference between hours and minutes.
 *
 * Piper names each output file after its input line, so the mapping back is by
 * text and the caller must pass distinct texts within a chunk. Anything Piper
 * did not write is simply absent from the returned map; the caller decides
 * whether to retry it singly rather than having a partial chunk throw away the
 * work that did succeed.
 *
 * The trade-off against {@link createSynthesiser} is that audio is produced
 * BEFORE the C6 claim rather than after it. That is safe for an offline,
 * single-operator content batch — `produceAsset` still performs the atomic
 * claim and refuses to store twice — but it means a losing worker would have
 * spent the synthesis. Do not reuse this shape for concurrent workers.
 *
 * @param {object} profile
 * @param {{toolRoot?: string}} [options]
 * @returns {(items: Array<{id: string, text: string}>) => Promise<Map<string, {bytes: Buffer, mimeType: string, info: object}>>}
 */
export function createBatchSynthesiser(profile, { toolRoot = DEFAULT_TOOL_ROOT } = {}) {
  const tooling = resolveTooling(profile, toolRoot);

  return async function synthesiseBatch(items) {
    const scratch = await fs.mkdtemp(path.join(os.tmpdir(), 'pronounceall-piper-batch-'));
    const inputFile = path.join(scratch, 'input.txt');
    const outputDir = path.join(scratch, 'out');
    const produced = new Map();

    try {
      // eslint-disable-next-line security/detect-non-literal-fs-filename
      await fs.mkdir(outputDir, { recursive: true });
      // eslint-disable-next-line security/detect-non-literal-fs-filename
      await fs.writeFile(inputFile, `${items.map((item) => item.text).join('\n')}\n`, 'utf8');

      await execFileAsync(
        tooling.python,
        [
          '-m',
          'piper',
          '-m',
          tooling.model,
          '-c',
          tooling.config,
          '-s',
          String(profile.voice.speakerId),
          '-i',
          inputFile,
          '-d',
          outputDir,
          '--output-dir-naming',
          'text',
        ],
        { env: { ...process.env, PYTHONIOENCODING: 'utf-8' }, maxBuffer: 64 * 1024 * 1024 },
      );

      for (const item of items) {
        const file = path.join(outputDir, `${item.text}.wav`);
        // eslint-disable-next-line security/detect-non-literal-fs-filename
        const bytes = await fs.readFile(file).catch(() => null);
        if (!bytes) {
          continue;
        }
        try {
          const info = assertUsableAudio(bytes, profile.output);
          produced.set(item.id, { bytes, mimeType: profile.output.mimeType, info });
        } catch {
          // Leave it out; the caller retries it singly and reports honestly.
        }
      }

      return produced;
    } finally {
      await fs.rm(scratch, { recursive: true, force: true });
    }
  };
}
