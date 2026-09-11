/* PronounceAll — Copyright (C) 2026 Alp Kavaklı
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * See LICENSE-NOTICE.md at the repository root. */

/**
 * The Wikimedia Commons client (FR-CONTENT-04/05, E1, NFR-LEGAL-*).
 *
 * BUILD-TIME ONLY, like `piper.js`. Commons is a content-build dependency and
 * never appears on the request path; the C4 zone rules keep `routes/` and
 * `services/` from importing a concrete client such as this one.
 *
 * This module only FETCHES and DESCRIBES. It makes no judgement about whether a
 * recording is the right sound — that is the maintainer's listening pass, and
 * nothing here may promote a file into production on its own.
 *
 * Attribution is the hard part and is treated as such.
 *
 * AN UPLOADER IS NOT AN AUTHOR. Commons tells us who uploaded a file; it tells
 * us who created it only when someone recorded that, and on most of these IPA
 * articulation recordings nobody did — the `Artist` field is empty, or says in
 * so many words that no author was provided. Writing the uploader's name into
 * an `author` column, or into an attribution line reading "by X", asserts
 * something the source does not support.
 *
 * So this client classifies what Commons actually says into one of four bases
 * and never flattens them together:
 *
 *   stated             — `Artist` names a creator (often with Credit "Own work")
 *   assumed-by-commons — `Artist` says "No machine-readable author provided.
 *                        <name> assumed (based on copyright claims)"
 *   uploader-only      — `Artist` describes an uploader, e.g. "The original
 *                        uploader was <name> at English Wikipedia"
 *   unattributed       — nothing at all; only the upload history has a name
 *
 * The credit stored for each says which of those it is, so nothing downstream
 * can mistake an upload record for authorship. CC BY-SA is satisfied in the
 * last two cases the way it is designed to be: by crediting the work, the
 * source and its URI rather than inventing a person.
 */

/** Identify the project to the API, as Wikimedia's etiquette requires. */
const USER_AGENT = 'PronounceAll/0.1 (content build; https://github.com/ alpkavakliab@gmail.com)';

const API = 'https://commons.wikimedia.org/w/api.php';

/**
 * Minimum gap between requests to Wikimedia, and how hard to retry a refusal.
 *
 * Wikimedia asks clients to be unhurried, and an unthrottled loop over two
 * dozen files earns an HTTP 429 part way through — which it did. Being a polite
 * client is cheaper than retrying, and a content build has no deadline.
 */
const MIN_REQUEST_GAP_MS = 400;
const MAX_ATTEMPTS = 4;

let lastRequestAt = 0;

/** @param {number} ms */
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Space requests out, whatever order the caller makes them in. */
async function pace() {
  const waitFor = lastRequestAt + MIN_REQUEST_GAP_MS - Date.now();
  if (waitFor > 0) {
    await sleep(waitFor);
  }
  lastRequestAt = Date.now();
}

/**
 * Fetch with pacing, and back off when Wikimedia says to.
 *
 * `Retry-After` is honoured when present because it is the server telling us
 * exactly how long to wait; otherwise the delay doubles per attempt.
 *
 * @param {string} url
 * @returns {Promise<Response>}
 */
async function politeFetch(url) {
  let delay = 1000;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    await pace();
    const response = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });

    if (response.status !== 429 && response.status < 500) {
      return response;
    }
    if (attempt === MAX_ATTEMPTS) {
      return response;
    }

    const retryAfter = Number(response.headers.get('retry-after'));
    await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : delay);
    delay *= 2;
  }

  throw new Error('unreachable');
}

/** Licences this project can carry into its CC BY-SA 4.0 content model. */
const ACCEPTABLE_LICENCES = Object.freeze({
  'CC BY-SA 3.0': 'CC-BY-SA-3.0',
  'CC BY-SA 4.0': 'CC-BY-SA-4.0',
  'CC BY 3.0': 'CC-BY-3.0',
  'CC BY 4.0': 'CC-BY-4.0',
  'CC0': 'CC0-1.0',
  'Public domain': 'public-domain',
});

/** Ogg is routinely declared with the generic container type. */
const OGG_TYPES = new Set(['audio/ogg', 'application/ogg']);

/** @param {string} mimeType @returns {boolean} */
function isAudioContainer(mimeType) {
  return Boolean(mimeType) && (mimeType.startsWith('audio/') || OGG_TYPES.has(mimeType));
}

/** @param {unknown} value @returns {string} */
function plain(value) {
  return String(value ?? '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * @param {Record<string, string>} params
 * @returns {Promise<object>}
 */
async function api(params) {
  const url = `${API}?${new URLSearchParams({ format: 'json', ...params })}`;
  const response = await politeFetch(url);
  if (!response.ok) {
    throw new Error(`Commons API ${response.status} for ${params.titles ?? ''}`);
  }
  return response.json();
}

/**
 * Describe one Commons file, or report that it is absent.
 *
 * @param {string} fileName without the `File:` prefix, e.g. `Voiceless bilabial plosive.ogg`
 * @returns {Promise<object|null>}
 */
export async function describeFile(fileName) {
  const title = `File:${fileName}`;

  const meta = await api({
    action: 'query',
    titles: title,
    prop: 'imageinfo',
    iiprop: 'url|extmetadata|mime|size',
  });
  const page = Object.values(meta.query.pages)[0];
  if (page.missing !== undefined || !page.imageinfo) {
    return null;
  }

  const info = page.imageinfo[0];
  const extended = info.extmetadata ?? {};
  const artist = plain(extended.Artist?.value);
  const credit = plain(extended.Credit?.value);

  const classified = classifyAuthorship(artist);

  // The uploader is fetched only to describe the file's history, never to
  // stand in for an author.
  let uploader = '';
  if (classified.basis !== 'stated') {
    const history = await api({
      action: 'query',
      titles: title,
      prop: 'imageinfo',
      iiprop: 'user|timestamp',
      iilimit: 'max',
    });
    const revisions = Object.values(history.query.pages)[0].imageinfo ?? [];
    uploader = revisions.at(-1)?.user ?? '';
  }

  const licenceName = plain(extended.LicenseShortName?.value);

  return {
    title: page.title,
    fileName,
    mimeType: info.mime,
    byteLength: info.size,
    durationSeconds: info.duration ?? null,
    // Strip the analytics query string Commons appends; the bare URL is the
    // stable one to record as provenance.
    fileUrl: String(info.url ?? '').split('?')[0],
    pageUrl: info.descriptionurl,
    licenceName,
    licenceIdentifier: ACCEPTABLE_LICENCES[licenceName] ?? null,
    licenceUrl: plain(extended.LicenseUrl?.value),
    // What Commons states, classified. `authorBasis` is the guard against an
    // upload record being read as authorship.
    artist,
    authorBasis: classified.basis,
    authorName: classified.name,
    uploader,
    credit,
    attributionRequired: plain(extended.AttributionRequired?.value) === 'true',
  };
}

/**
 * Decide what Commons' `Artist` field actually claims.
 *
 * @param {string} artist
 * @returns {{basis: 'stated'|'assumed-by-commons'|'uploader-only'|'unattributed', name: string}}
 */
export function classifyAuthorship(artist) {
  if (!artist) {
    return { basis: 'unattributed', name: '' };
  }

  const assumed = artist.match(
    /^no machine-readable author provided\.?\s*(.+?)\s+assumed\s*\(based on copyright claims\)\.?$/i,
  );
  if (assumed) {
    return { basis: 'assumed-by-commons', name: assumed[1].trim() };
  }
  if (/^no machine-readable author/i.test(artist)) {
    return { basis: 'unattributed', name: '' };
  }

  const uploaderOnly = /^the original uploader was\s+(.+)$/i.exec(artist);
  if (uploaderOnly) {
    // Trim the trailing " at <project>." in two simple passes rather than one
    // pattern with a nested optional quantifier, which backtracks badly.
    const name = uploaderOnly[1]
      .replace(/\s+at\s.*$/i, '')
      .replace(/\.\s*$/, '')
      .trim();
    return { basis: 'uploader-only', name };
  }

  return { basis: 'stated', name: artist };
}

/**
 * The credit stored in `audio_assets.author`.
 *
 * It is a STATEMENT ABOUT AUTHORSHIP, not a bare name, because a bare name in
 * that column would read as "this person made the recording" in every case —
 * which is true for only some of them.
 *
 * @param {object} described
 * @returns {string}
 */
export function authorCreditFor(described) {
  switch (described.authorBasis) {
    case 'stated':
      return described.authorName;
    case 'assumed-by-commons':
      return `${described.authorName} (assumed by Wikimedia Commons; not stated by the source)`;
    case 'uploader-only':
      return `Unattributed; original uploader ${described.authorName} (uploader, not stated as author)`;
    default:
      return described.uploader
        ? `Unattributed; uploaded to Wikimedia Commons by ${described.uploader} (uploader, not stated as author)`
        : 'Unattributed';
  }
}

/**
 * Find the first name under which a unit's articulation recording exists.
 *
 * Commons is inconsistent between "palato-alveolar" and "postalveolar" for the
 * same articulation, so a unit may need more than one name tried. The order of
 * `candidates` is the order of preference.
 *
 * @param {string[]} candidates file names, without `File:`
 * @returns {Promise<object|null>}
 */
export async function findFirstAvailable(candidates) {
  for (const candidate of candidates) {
    const described = await describeFile(candidate);
    if (described) {
      return described;
    }
  }
  return null;
}

/**
 * Reasons a described file is not usable as production content.
 *
 * These are the maintainer's stated suitability criteria, minus the one no
 * program can check: whether it is the correct sound. That stays with the
 * listening pass, which is why this returns problems rather than an approval.
 *
 * @param {object} described
 * @returns {string[]}
 */
export function unsuitabilityReasons(described) {
  const problems = [];

  if (!described.licenceIdentifier) {
    problems.push(`licence "${described.licenceName || 'unknown'}" is not on the accepted list`);
  }
  // An unattributed file is still usable — CC BY-SA anticipates a work with no
  // stated author, and the credit says so plainly. What is NOT acceptable is
  // having nothing at all to point at: no author, no uploader and no source
  // page leaves no way to credit the work honestly.
  if (described.authorBasis === 'unattributed' && !described.uploader && !described.pageUrl) {
    problems.push('no author, uploader or source page, so the work cannot be credited at all');
  }
  if (!described.fileUrl) {
    problems.push('no downloadable file URL');
  }
  // Commons declares these as `application/ogg`, the generic container type,
  // rather than `audio/ogg`. That is correct for an Ogg stream and is not a
  // reason to reject one: the payload signature is checked on download, and the
  // storage layer maps both to the same `.ogg` extension.
  if (!isAudioContainer(described.mimeType)) {
    problems.push(`not audio: ${described.mimeType}`);
  }
  if (!described.byteLength) {
    problems.push('zero byte length reported');
  }

  return problems;
}

/**
 * Download a described file's bytes.
 *
 * @param {object} described
 * @returns {Promise<Buffer>}
 */
export async function download(described) {
  const response = await politeFetch(described.fileUrl);
  if (!response.ok) {
    throw new Error(`download failed: HTTP ${response.status}`);
  }
  const bytes = Buffer.from(await response.arrayBuffer());

  if (bytes.length === 0) {
    throw new Error('downloaded an empty file');
  }
  // Commons serves these as Ogg. Verify the container signature rather than
  // trusting the declared MIME type, but make no claim about the audio inside:
  // this project has no decoder, so "not silent" is NOT asserted for Commons
  // audio the way it is for the WAV Piper produces. The listening pass is what
  // establishes that.
  if (OGG_TYPES.has(described.mimeType) && bytes.subarray(0, 4).toString('ascii') !== 'OggS') {
    throw new Error(`declared ${described.mimeType} but the payload has no OggS signature`);
  }
  if (described.byteLength && bytes.length !== described.byteLength) {
    throw new Error(`expected ${described.byteLength} bytes, received ${bytes.length}`);
  }

  return bytes;
}

/**
 * The attribution line FR-CONTENT-05 renders for a Commons recording.
 *
 * @param {object} described
 * @returns {string}
 */
export function attributionFor(described) {
  const work = described.fileName.replace(/\.[a-z0-9]+$/i, '');
  const licence = described.licenceName;

  switch (described.authorBasis) {
    case 'stated':
      return `“${work}” by ${described.authorName}, via Wikimedia Commons, ${licence}.`;
    case 'assumed-by-commons':
      return (
        `“${work}”, via Wikimedia Commons, ${licence}. No author was stated by the source; ` +
        `Commons records ${described.authorName} as the assumed author. See ${described.pageUrl}`
      );
    case 'uploader-only':
      return (
        `“${work}”, via Wikimedia Commons, ${licence}. No author was stated by the source; ` +
        `it was originally uploaded by ${described.authorName}. See ${described.pageUrl}`
      );
    default:
      // CC BY-SA is satisfied here the way it is designed to be when the work
      // supplies no author: by crediting the work, the source and its URI.
      return (
        `“${work}”, via Wikimedia Commons, ${licence}. No author is stated by the source. ` +
        `See ${described.pageUrl}`
      );
  }
}

/** Exposed so a caller can report which identity was used against the API. */
export const userAgent = USER_AGENT;
