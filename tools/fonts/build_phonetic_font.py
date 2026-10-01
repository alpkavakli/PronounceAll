# PronounceAll — Copyright (C) 2026 Alp Kavaklı
# SPDX-License-Identifier: AGPL-3.0-or-later
# See LICENSE-NOTICE.md at the repository root.

"""Build the PronounceAll Phonetic web font (FR-IPA-09, NFR-PERF-03).

A Modified Version, under the SIL Open Font License 1.1, of the upstream IPA
font in assets/fonts-source/ (maintainer decision 2026-10-01): subset to the
committed character set (tools/fonts/pronounceall-phonetic.charset.txt,
generated from PronounceAll's content by scripts/generate-phonetic-charset.js)
and renamed, because the upstream declares Reserved Font Names that a modified
version may not use (OFL section 3; OFL-FAQ 2.6-2.8).

Kept: the copyright notice, the licence text and URL, the designers' credit.
Renamed: family, subfamily, full, unique and PostScript names. Removed: the
trademark line, the vendor tag, the manufacturer and its URLs, the upstream
description and its private table. Nothing here claims or implies endorsement.

Deterministic: the same inputs give the same bytes (no timestamps). Fails if the
upstream licence declaration is not the one reviewed, or if any required
character is missing after subsetting.

Development only; the runtime never needs Python.

Usage:  python tools/fonts/build_phonetic_font.py           # build
        python tools/fonts/build_phonetic_font.py --check   # rebuild in memory; fail if the committed file differs
"""

import hashlib
import io
import re
import sys
from pathlib import Path

from fontTools import subset
from fontTools.ttLib import TTFont

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / "assets" / "fonts-source" / "charis-sil-400.woff2"
CHARSET = ROOT / "tools" / "fonts" / "pronounceall-phonetic.charset.txt"
OUTPUT = ROOT / "src" / "public" / "fonts" / "pronounceall-phonetic-400.woff2"

FAMILY = "PronounceAll Phonetic"
POSTSCRIPT = "PronounceAllPhonetic-Regular"

# The upstream declaration this build was reviewed against (font name ID 13).
EXPECTED_LICENSE = re.compile(r'Reserved Font Names "Charis" and "SIL".*SIL Open Font License, Version 1\.1', re.S)
RESERVED = re.compile(r"charis|\bsil\b", re.I)
# Name records kept verbatim: copyright, designers, licence, licence URL.
KEPT_NAME_IDS = {0, 9, 13, 14}


def read_charset():
    codepoints = []
    for line in CHARSET.read_text(encoding="utf-8").splitlines():
        if line.startswith("U+"):
            codepoints.append(int(line.split("\t", 1)[0][2:], 16))
    if not codepoints:
        sys.exit(f"{CHARSET} lists no characters")
    return sorted(set(codepoints))


def build():
    font = TTFont(str(SOURCE), recalcTimestamp=False)
    license_text = font["name"].getDebugName(13) or ""
    if not EXPECTED_LICENSE.search(license_text):
        sys.exit("The upstream licence declaration differs from the one reviewed; review it before building.")
    version = font["name"].getDebugName(5) or "unknown"

    codepoints = read_charset()
    missing_upstream = [cp for cp in codepoints if cp not in font.getBestCmap()]
    if missing_upstream:
        sys.exit("Upstream lacks: " + ", ".join(f"U+{cp:04X}" for cp in missing_upstream))

    options = subset.Options()
    options.layout_features = ["*"]  # kerning, mark positioning (e.g. the tie bar), ligatures
    options.name_IDs = ["*"]
    options.name_languages = ["*"]
    options.notdef_outline = True
    options.recalc_timestamp = False
    options.drop_tables += ["Silt"]
    options.flavor = "woff2"
    subsetter = subset.Subsetter(options)
    subsetter.populate(unicodes=codepoints)
    subsetter.subset(font)

    # Line endings normalised, so a CRLF checkout builds the same bytes as CI.
    charset_digest = hashlib.sha256(CHARSET.read_bytes().replace(b"\r\n", b"\n")).hexdigest()[:12]
    names = font["name"]
    for record in list(names.names):
        if record.nameID not in KEPT_NAME_IDS:
            names.removeNames(nameID=record.nameID)
    new_names = {
        1: FAMILY,
        2: "Regular",
        3: f"{POSTSCRIPT};{version};subset-{charset_digest}",
        4: f"{FAMILY} Regular",
        5: f"{version}; PronounceAll IPA subset {charset_digest}",
        6: POSTSCRIPT,
        8: "PronounceAll (modified version)",
        10: (
            "Modified Version under the Open Font License 1.1 (licence in name ID 13): subset to the characters "
            "PronounceAll renders in IPA, and renamed. Not endorsed by the original authors."
        ),
        11: "https://github.com/alpkavakli/PronounceAll",
    }
    for name_id, value in new_names.items():
        names.setName(value, name_id, 3, 1, 0x409)
        names.setName(value, name_id, 1, 0, 0)
    font["OS/2"].achVendID = "NONE"

    for record in names.names:
        if record.nameID not in {0, 9, 13, 14} and RESERVED.search(record.toUnicode()):
            sys.exit(f"Name ID {record.nameID} still uses a Reserved Font Name")
    cmap = font.getBestCmap()
    missing = [cp for cp in codepoints if cp not in cmap]
    if missing:
        sys.exit("Missing after subsetting: " + ", ".join(f"U+{cp:04X}" for cp in missing))

    out = io.BytesIO()
    font.flavor = "woff2"
    font.save(out)
    return out.getvalue(), len(codepoints)


def main():
    data, count = build()
    if "--check" in sys.argv:
        if not OUTPUT.exists() or OUTPUT.read_bytes() != data:
            sys.exit(f"{OUTPUT.relative_to(ROOT)} is stale: run python tools/fonts/build_phonetic_font.py")
        print(f"{OUTPUT.relative_to(ROOT)} is up to date ({count} characters, {len(data)} bytes).")
        return
    OUTPUT.write_bytes(data)
    print(f"Wrote {OUTPUT.relative_to(ROOT)}: {count} characters, {len(data)} bytes (source {SOURCE.stat().st_size} bytes).")


if __name__ == "__main__":
    main()
