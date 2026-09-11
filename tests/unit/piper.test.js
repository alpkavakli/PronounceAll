/* PronounceAll — Copyright (C) 2026 Alp Kavaklı
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * See LICENSE-NOTICE.md at the repository root. */

/**
 * The Piper preflight and output sanity checks (V1, C6, FR-CONTENT-04).
 *
 * The preflight is the only thing standing between a drifted voice and 41
 * assets that sound wrong under keys promising otherwise. Asset keys embed the
 * voice NAME and generator version but not the speaker id or the model digest,
 * so a speaker remap or a re-released model would change what a learner hears
 * while every key stayed identical. These tests prove each of those is caught
 * BEFORE anything is generated.
 *
 * The audio checks are deliberately mechanical — decodable, non-empty,
 * non-silent, declared format. None of them claims a clip is the RIGHT sound;
 * that is the maintainer listening pass.
 */

import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, test } from '@jest/globals';

import { assertUsableAudio, inspectWav, loadProfile, preflight, resolveTooling } from '../../src/lib/piper.js';

const OUTPUT = Object.freeze({ mimeType: 'audio/wav', sampleRate: 22050, channels: 1, sampleWidthBytes: 2 });

/**
 * Build a minimal canonical RIFF/WAVE payload.
 *
 * @param {{samples?: number[], sampleRate?: number, channels?: number, bits?: number}} [options]
 * @returns {Buffer}
 */
function wav({ samples = [1000, -2000, 3000], sampleRate = 22050, channels = 1, bits = 16 } = {}) {
  const data = Buffer.alloc(samples.length * 2);
  samples.forEach((sample, index) => data.writeInt16LE(sample, index * 2));

  const header = Buffer.alloc(44);
  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(36 + data.length, 4);
  header.write('WAVE', 8, 'ascii');
  header.write('fmt ', 12, 'ascii');
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE((sampleRate * channels * bits) / 8, 28);
  header.writeUInt16LE((channels * bits) / 8, 32);
  header.writeUInt16LE(bits, 34);
  header.write('data', 36, 'ascii');
  header.writeUInt32LE(data.length, 40);

  return Buffer.concat([header, data]);
}

describe('inspectWav', () => {
  test('reads the format and peak amplitude', () => {
    const info = inspectWav(wav({ samples: [100, -32000, 5] }));

    expect(info.channels).toBe(1);
    expect(info.sampleRate).toBe(22050);
    expect(info.bitsPerSample).toBe(16);
    expect(info.sampleCount).toBe(3);
    expect(info.peak).toBe(32000);
  });

  test.each([
    ['a payload shorter than a header', Buffer.alloc(10)],
    ['a payload with no RIFF marker', Buffer.alloc(64)],
  ])('rejects %s', (_label, bytes) => {
    expect(() => inspectWav(bytes)).toThrow(/not a WAV payload/);
  });

  test('rejects a non-16-bit sample width', () => {
    expect(() => inspectWav(wav({ bits: 8 }))).toThrow(/unsupported sample width/);
  });
});

describe('assertUsableAudio', () => {
  test('accepts ordinary generated audio', () => {
    expect(() => assertUsableAudio(wav(), OUTPUT)).not.toThrow();
  });

  test('rejects silence, which is decodable but useless', () => {
    expect(() => assertUsableAudio(wav({ samples: [0, 0, 0, 1, -2] }), OUTPUT)).toThrow(/silent/);
  });

  test('rejects an unexpected sample rate', () => {
    expect(() => assertUsableAudio(wav({ sampleRate: 16000 }), OUTPUT)).toThrow(/22050 Hz/);
  });

  test('rejects an unexpected channel count', () => {
    expect(() => assertUsableAudio(wav({ channels: 2 }), OUTPUT)).toThrow(/1 channel/);
  });
});

describe('the committed profile tracks D4', () => {
  /**
   * The profile is synthesis metadata keyed BY canonical unit. If the two
   * artifacts drift, the batch would either skip a unit or generate audio for a
   * symbol the inventory does not teach — and the asset keys would still look
   * right. This is the guard against that.
   */
  test('covers exactly the canonical inventory, in canonical order', async () => {
    const profile = await loadProfile('en-us');
    const d4 = JSON.parse(await fs.readFile('data/seed/en-us.phonemes.json', 'utf8'));

    expect(profile.units.map((unit) => unit.ipaSymbol)).toEqual(d4.units.map((unit) => unit.ipaSymbol));
  });

  test('every unit has a non-empty bracketed synthesis input', async () => {
    const profile = await loadProfile('en-us');

    for (const unit of profile.units) {
      expect(unit.piperRawPhonemes.length).toBeGreaterThan(0);
      expect(unit.piperInput).toBe(`[[${unit.piperRawPhonemes}]]`);
    }
  });

  test('the synthesis mapping never leaks into a canonical symbol', async () => {
    const profile = await loadProfile('en-us');
    const canonical = new Set(profile.units.map((unit) => unit.ipaSymbol));

    // /ɝ/ is the one unit whose synthesis input deliberately differs from its
    // canonical form. The adapter must exist ONLY here and must never have been
    // written back as a teaching unit.
    const rhotic = profile.units.find((unit) => unit.ipaSymbol === 'ɝ');
    expect(rhotic.piperRawPhonemes).toBe('ˈɜ˞');
    expect(canonical.has('ɜ')).toBe(false);
    expect(canonical.has('ˈɜ˞')).toBe(false);
  });

  test('the asset-key inputs are pinned', async () => {
    const profile = await loadProfile('en-us');

    // These two participate in every generated asset key, so a change here
    // silently strands the rows the seed registered.
    expect(profile.voice.name).toBe('en_US-libritts-high');
    expect(profile.generatorVersion).toBe('v1');
    expect(profile.voice.speakerName).toBe('p3922');
    expect(profile.voice.speakerId).toBe(0);
  });
});

describe('preflight fails closed', () => {
  let root;

  /** Write a voice config and matching profile, then run the preflight over them. */
  async function check({ config, profileOverrides = {}, requireDigests = false }) {
    const voices = path.join(root, 'voices');
    await fs.mkdir(voices, { recursive: true });
    await fs.writeFile(path.join(voices, 'voice.onnx'), 'not a real model', 'utf8');
    await fs.writeFile(path.join(voices, 'voice.onnx.json'), JSON.stringify(config), 'utf8');

    const python = resolveTooling({ voice: { modelFile: 'x', configFile: 'y' } }, root).python;
    await fs.mkdir(path.dirname(python), { recursive: true });
    await fs.writeFile(python, '', 'utf8');

    const profile = {
      voice: {
        name: 'test-voice',
        speakerName: 'p3922',
        speakerId: 0,
        modelFile: 'voice.onnx',
        configFile: 'voice.onnx.json',
        sampleRate: 22050,
        ...profileOverrides,
      },
      units: [{ ipaSymbol: 'ɝ', piperRawPhonemes: 'ˈɜ˞' }],
    };

    return preflight(profile, { toolRoot: root, requireDigests });
  }

  const healthy = {
    audio: { sample_rate: 22050 },
    speaker_id_map: { p3922: 0 },
    phoneme_id_map: { 'ˈ': [1], 'ɜ': [2], '˞': [3] },
  };

  beforeAll(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'piper-preflight-'));
  });

  afterAll(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  test('passes on a voice that matches the profile', async () => {
    const { problems, checkedCodepoints } = await check({ config: healthy });

    expect(problems).toEqual([]);
    expect(checkedCodepoints).toBe(3);
  });

  test('catches a speaker remapped to a different id', async () => {
    const { problems } = await check({
      config: { ...healthy, speaker_id_map: { p3922: 417 } },
    });

    expect(problems).toEqual([expect.stringMatching(/resolves to id 417/)]);
  });

  test('catches a speaker that no longer exists', async () => {
    const { problems } = await check({
      config: { ...healthy, speaker_id_map: { someone_else: 0 } },
    });

    expect(problems).toEqual([expect.stringMatching(/absent from the voice's speaker_id_map/)]);
  });

  test('catches a codepoint the model cannot pronounce', async () => {
    // The rhoticity marker is exactly the one /ɝ/ depends on.
    const { '˞': _dropped, ...withoutRhoticity } = healthy.phoneme_id_map;
    const { problems } = await check({
      config: { ...healthy, phoneme_id_map: withoutRhoticity },
    });

    expect(problems).toEqual([expect.stringMatching(/no ˞ \(U\+02DE\), required by \/ɝ\//)]);
  });

  test('catches a changed sample rate', async () => {
    const { problems } = await check({
      config: { ...healthy, audio: { sample_rate: 16000 } },
    });

    expect(problems).toEqual([expect.stringMatching(/sample rate 16000/)]);
  });

  test('catches a model whose digest is not the pinned one', async () => {
    const { problems } = await check({
      config: healthy,
      profileOverrides: { modelSha256: 'a'.repeat(64), configSha256: 'b'.repeat(64) },
      requireDigests: true,
    });

    expect(problems).toHaveLength(2);
    expect(problems[0]).toMatch(/model digest/);
    expect(problems[1]).toMatch(/config digest/);
  });

  test('reports missing tooling rather than proceeding', async () => {
    const empty = await fs.mkdtemp(path.join(os.tmpdir(), 'piper-empty-'));

    const { problems } = await preflight(
      {
        voice: { modelFile: 'voice.onnx', configFile: 'voice.onnx.json', speakerName: 'p', speakerId: 0 },
        units: [],
      },
      { toolRoot: empty, requireDigests: false },
    );

    expect(problems.length).toBeGreaterThan(0);
    expect(problems.join(' ')).toMatch(/not found/);
    await fs.rm(empty, { recursive: true, force: true });
  });
});
