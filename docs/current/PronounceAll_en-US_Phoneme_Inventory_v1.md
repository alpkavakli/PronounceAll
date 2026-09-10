# PronounceAll en-US Pedagogical IPA Inventory v1

**Artifact:** D4
**Version:** 1.0
**Date:** 2026-09-11
**Status:** **APPROVED and FROZEN.** The 41 teaching examples of §4 were approved
by the maintainer on 2026-09-11; the normalisation corrections of §5.3, §5.4 and
§5.7 were directed in the same review. Instantiates the frozen policy of
`FIND-07` / `D-R3-07`. Not a new design decision, and not to be reopened.

---

## 1. Purpose and status

This is the standalone phoneme artifact that SDD v1.1 §4.2 and `D-R3-07` name as
**authoritative** for the `en-us` variant's symbol set, its transcription
conventions, and its per-unit example words. The SDD references this artifact
rather than inlining it; where this document and a schema comment appear to
differ, this document governs the linguistic content and the schema governs the
storage.

**This is a product pedagogical and transcription convention. It is not a claim
that American English objectively has 41 phonemes.** The count is a *consequence*
of the list below, never an independent constraint. Reputable sources diverge on
the low-back contrast, on rhotic-vowel notation, and on vowel-length marks;
speech-technology inventories differ from all of them. PronounceAll fixes one
teachable convention so that a symbol a learner clicks means the same thing
everywhere in the product.

**Governing IDs:** `FR-IPA-01`, `FR-IPA-02`, `FR-IPA-03`, `FR-IPA-08`,
SRS Appendix B, `E1`, `E2`, `D-R3-07`.

**What this artifact does not do.** It does not change the inventory, reopen
`FIND-07`, or introduce a schema column. `phonemes.is_active` and
`word_pronunciations.source_ipa` remain rejected for v1.0 (SDD §4.12).

---

## 2. The canonical inventory

41 teaching units. `canonical_order` is the stable identity of a row in this
document; it is **not** a frequency ranking (see §6).

### Consonants — 24

`p` `b` `t` `d` `k` `ɡ` `tʃ` `dʒ` `f` `v` `θ` `ð` `s` `z` `ʃ` `ʒ` `h` `m` `n` `ŋ` `l` `ɹ` `w` `j`

### Vowel and central-rhotic teaching units — 12

`i` `ɪ` `ɛ` `æ` `ʌ` `ə` `ɑ` `ɔ` `ʊ` `u` `ɝ` `ɚ`

### Diphthongs — 5

`eɪ` `aɪ` `ɔɪ` `aʊ` `oʊ`

**Derived total: 24 + 12 + 5 = 41 teaching units.**

---

## 3. Frozen transcription conventions

1. **American R is canonical `/ɹ/`.** A source `/r/` normalises to `/ɹ/` only
   under an explicitly documented source-profile alias rule (§5), never silently.
2. **`/ə/` and `/ʌ/` are separate pedagogical units.** They are not merged, and
   stress is not used to decide between them at tokenization time.
3. **`/ɝ/` and `/ɚ/` are separate central-rhotic teaching units** — stressed and
   unstressed respectively. Both are single r-coloured units, not sequences.
4. **All other vowel-plus-R sequences are compositional.** `car` `/kɑɹ/`
   tokenizes to `/ɑ/` then `/ɹ/`, two clickable units. Only `/ɝ/` and `/ɚ/` are
   single r-coloured rows.
5. **The five diphthongs are atomic clickable units.** `/aɪ/` is one row and one
   click, never `/a/` + `/ɪ/`.
6. **`/ɔ/` is retained as canonical.** Cot–caught variation is represented
   through the existing multiple-pronunciation model (`word_pronunciations`,
   `E4`). There is no variation-metadata column, and none is added.
7. **No canonical vowel-length marks.** `ː` is a source notation, stripped by §5.
   `/i/` and `/u/` are the canonical units; `/iː/` and `/uː/` are not.
8. **Stress marks `ˈ` and `ˌ` and syllable separators are non-clickable marks.**
   They are preserved for display and carried alongside the phoneme sequence,
   never stored as `pronunciation_phonemes` rows.
9. **Allophonic and narrow-transcription symbols are not canonical rows.** `[ɾ]`,
   `[ɫ]`, `[ʔ]`, `[t̬]`, aspiration, nasalisation, and vowel-quality diacritics
   have no row here, and a transcription that depends on one does not tokenize.
10. **Browser JavaScript never linguistically tokenizes IPA.** Tokenization is a
    seed-time, server-side concern; the browser only reads `data-phoneme-id`.
    This is a root `CLAUDE.md` invariant.

---

## 4. Teaching examples — one reviewed row per canonical unit

Every row was verified against **English Wiktionary** (CC BY-SA 4.0), the named
primary source, on 2026-09-10. `example_word_ipa` is the American transcription
Wiktionary gives, after the §5 source profile. Per `E2`/`FIND-01`, the target
unit need only occur **somewhere** in the transcription; word-initial is preferred
where the sound permits it.

Of the 41 units, **35 have a word-initial example**. The six that do not are
noted, and each is a sound that cannot or does not normally begin an English
word — precisely the case `FIND-01` was raised about.

| # | ipa_unit | category | example_word | example_word_ipa | target_position | source_reference | notes |
|---|---|---|---|---|---|---|---|
| 1 | `p` | consonant | pen | /pɛn/ | initial | [pen](https://en.wiktionary.org/wiki/pen#English) | |
| 2 | `b` | consonant | bed | /bɛd/ | initial | [bed](https://en.wiktionary.org/wiki/bed#English) | |
| 3 | `t` | consonant | ten | /tɛn/ | initial | [ten](https://en.wiktionary.org/wiki/ten#English) | |
| 4 | `d` | consonant | dog | /dɔɡ/ | initial | [dog](https://en.wiktionary.org/wiki/dog#English) | non-cot-caught form |
| 5 | `k` | consonant | cat | /ˈkæt/ | initial | [cat](https://en.wiktionary.org/wiki/cat#English) | |
| 6 | `ɡ` | consonant | go | /ɡoʊ/ | initial | [go](https://en.wiktionary.org/wiki/go#English) | |
| 7 | `tʃ` | consonant | chair | /tʃɛɚ/ | initial | [chair](https://en.wiktionary.org/wiki/chair#English) | tie bar removed |
| 8 | `dʒ` | consonant | jump | /dʒʌmp/ | initial | [jump](https://en.wiktionary.org/wiki/jump#English) | tie bar removed |
| 9 | `f` | consonant | fish | /fɪʃ/ | initial | [fish](https://en.wiktionary.org/wiki/fish#English) | |
| 10 | `v` | consonant | van | /væn/ | initial | [van](https://en.wiktionary.org/wiki/van#English) | |
| 11 | `θ` | consonant | think | /ˈθɪŋk/ | initial | [think](https://en.wiktionary.org/wiki/think#English) | |
| 12 | `ð` | consonant | this | /ðɪs/ | initial | [this](https://en.wiktionary.org/wiki/this#English) | |
| 13 | `s` | consonant | sun | /sʌn/ | initial | [sun](https://en.wiktionary.org/wiki/sun#English) | |
| 14 | `z` | consonant | zoo | /zu/ | initial | [zoo](https://en.wiktionary.org/wiki/zoo#English) | length mark dropped |
| 15 | `ʃ` | consonant | ship | /ˈʃɪp/ | initial | [ship](https://en.wiktionary.org/wiki/ship#English) | |
| 16 | `ʒ` | consonant | measure | /ˈmɛʒ.ɚ/ | **medial** | [measure](https://en.wiktionary.org/wiki/measure#English) | never word-initial in native English |
| 17 | `h` | consonant | hat | /hæt/ | initial | [hat](https://en.wiktionary.org/wiki/hat#English) | |
| 18 | `m` | consonant | moon | /mun/ | initial | [moon](https://en.wiktionary.org/wiki/moon#English) | |
| 19 | `n` | consonant | name | /neɪm/ | initial | [name](https://en.wiktionary.org/wiki/name#English) | |
| 20 | `ŋ` | consonant | sing | /ˈsɪŋ/ | **final** | [sing](https://en.wiktionary.org/wiki/sing#English) | cannot be word-initial in English |
| 21 | `l` | consonant | leg | /lɛɡ/ | initial | [leg](https://en.wiktionary.org/wiki/leg#English) | |
| 22 | `ɹ` | consonant | red | /ɹɛd/ | initial | [red](https://en.wiktionary.org/wiki/red#English) | |
| 23 | `w` | consonant | water | /ˈwɔ.tɚ/ | initial | [water](https://en.wiktionary.org/wiki/water#English) | non-cot-caught form |
| 24 | `j` | consonant | yes | /jɛs/ | initial | [yes](https://en.wiktionary.org/wiki/yes#English) | |
| 25 | `i` | vowel | eat | /it/ | initial | [eat](https://en.wiktionary.org/wiki/eat#English) | length mark dropped |
| 26 | `ɪ` | vowel | ink | /ˈɪŋk/ | initial | [ink](https://en.wiktionary.org/wiki/ink#English) | |
| 27 | `ɛ` | vowel | egg | /ɛɡ/ | initial | [egg](https://en.wiktionary.org/wiki/egg#English) | |
| 28 | `æ` | vowel | apple | /ˈæpəl/ | initial | [apple](https://en.wiktionary.org/wiki/apple#English) | |
| 29 | `ʌ` | vowel | up | /ʌp/ | initial | [up](https://en.wiktionary.org/wiki/up#English) | |
| 30 | `ə` | vowel | about | /əˈbaʊt/ | initial | [about](https://en.wiktionary.org/wiki/about#English) | offglide mark dropped; `/ə/` is inherently unstressed |
| 31 | `ɑ` | vowel | otter | /ˈɑtɚ/ | initial | [otter](https://en.wiktionary.org/wiki/otter#English) | |
| 32 | `ɔ` | vowel | author | /ˈɔ.θɚ/ | initial | [author](https://en.wiktionary.org/wiki/author#English) | non-cot-caught form; see §3.6 |
| 33 | `ʊ` | vowel | book | /bʊk/ | **medial** | [book](https://en.wiktionary.org/wiki/book#English) | does not occur word-initially |
| 34 | `u` | vowel | food | /fud/ | **medial** | [food](https://en.wiktionary.org/wiki/food#English) | length mark dropped |
| 35 | `ɝ` | central rhotic | earth | /ɝθ/ | initial | [earth](https://en.wiktionary.org/wiki/earth#English) | stressed central rhotic |
| 36 | `ɚ` | central rhotic | butter | /ˈbʌtɚ/ | **final** | [butter](https://en.wiktionary.org/wiki/butter#English) | unstressed; cannot be word-initial |
| 37 | `eɪ` | diphthong | eight | /eɪt/ | initial | [eight](https://en.wiktionary.org/wiki/eight#English) | |
| 38 | `aɪ` | diphthong | ice | /aɪs/ | initial | [ice](https://en.wiktionary.org/wiki/ice#English) | |
| 39 | `ɔɪ` | diphthong | oil | /ɔɪl/ | initial | [oil](https://en.wiktionary.org/wiki/oil#English) | |
| 40 | `aʊ` | diphthong | out | /ˈaʊt/ | initial | [out](https://en.wiktionary.org/wiki/out#English) | offglide mark dropped |
| 41 | `oʊ` | diphthong | open | /ˈoʊ.pən/ | initial | [open](https://en.wiktionary.org/wiki/open#English) | |

**Review status:** every row is machine-verified — the transcription was fetched
from the named source and tokenized, and the target unit was confirmed present at
the stated position. **The pedagogical suitability of the 41 example words is the
one thing awaiting maintainer sign-off.** Phonetician review remains a pre-launch
*Should* rather than a blocker (`E2`).

---

## 5. Normalisation and tokenisation policy

### 5.1 Order of operations

1. Unicode **NFC** normalise.
2. Apply the **source profile** for the ingesting source (§5.2). Nothing here is
   generic: a mapping belongs to a named source profile, never to "IPA at large".
3. **Longest-match** tokenise left to right against the 41 canonical units,
   preferring the two-character unit where one exists (`tʃ`, `dʒ`, and the five
   diphthongs).
4. Preserve permitted non-clickable marks separately from the phoneme sequence.

### 5.2 English Wiktionary source profile

| Source form | Canonical form | Why |
|---|---|---|
| `t͡ʃ` `d͡ʒ` (U+0361 tie bar) | `tʃ` `dʒ` | Same unit, different notation |
| `g` (U+0067) | `ɡ` (U+0261) | Latin g for IPA script g |
| `r` | `ɹ` | §3.1, the documented alias rule |
| `ː` (U+02D0) | *removed* | §3.7, no canonical length marks |
| `◌̯` (U+032F non-syllabic) | *removed* | Redundant inside an atomic diphthong |
| `oɹ` (pre-rhotic, not `oʊɹ`) | `ɔɹ` | See §5.3 |
| `ɜɹ` | `ɝ` | NURSE, where this profile writes `ɜɹ` for the stressed central rhotic |
| `əɹ` | `ɚ` | Unstressed rhotic schwa, where this profile writes `əɹ` for the unstressed central rhotic |
| `l̩` `n̩` `m̩` (U+0329 syllabic) | `əl` `ən` `əm` | See §5.3.2 |
| `( … )` | *resolved, never persisted* | See §5.4 |

**The two rhotic merges are symmetrical and both are source-profile
normalisations, not arbitrary character replacements.** Each applies only where
the profile actually uses that notation for that unit.

Both are also conditioned on the `/ɹ/` being **non-prevocalic**. `ˈfɑ.ðəɹ`
becomes `ˈfɑ.ðɚ` because the `/ɹ/` closes the syllable, but `kəɹɛkt` keeps a
compositional `/ə/` + `/ɹ/` because the `/ɹ/` is an onset. Without that guard the
merge would corrupt every word whose `/ɹ/` begins the next syllable.

### 5.3 Two named source-profile fixtures

#### 5.3.1 The pre-rhotic `/oɹ/` case

English Wiktionary writes the NORTH/FORCE-class vowel as `/o/` before `/ɹ/` —
`orange` is `/ˈoɹənd͡ʒ/`, `more` is `/moɹ/`. The inventory has no bare `/o/`: it
has the atomic diphthong `/oʊ/` and the monophthong `/ɔ/`.

**One documented convention, chosen once:** for the Wiktionary en-US source
profile, pre-rhotic `/oɹ/` representing the FORCE/NORTH-class source notation
normalises to canonical `/ɔɹ/`, tokenised `/ɔ/` + `/ɹ/`.

**This mapping is source-profile-specific. It is NOT a global `/o/` → `/ɔ/`
substitution.** It fires only where `/o/` is immediately followed by `/ɹ/` and is
not already part of `/oʊ/`; `/ˈkoʊld/` is untouched. Making the case explicit here
is the whole point — it stops an importer choosing between `/ɔ/` and `/oʊ/`
ad hoc, per word.

#### 5.3.2 Syllabic consonants

`/l̩ n̩ m̩/` → `/əl ən əm/`.

**This is PronounceAll's broad pedagogical representation. It is not a claim that
every surface realisation contains a full phonetic schwa.** The realisation of
`hospital` is commonly a syllabic `[l̩]` with no separate vocalic segment; the
inventory has no syllabic-consonant unit, and this convention writes that
syllable as schwa plus the consonant, which is the standard broad-transcription
equivalence and is what a learner is taught to produce.

### 5.4 Parentheses are source notation and are resolved at ingestion

**Parentheses are NOT a permitted canonical mark, and are never persisted into
`word_pronunciations.ipa_transcription`.**

They encode *optionality*, which is a different kind of thing from a stress mark.
Carrying `/ˈwɛðə(ɹ)/` into the product and making the `/ɹ/` clickable would have
the page assert "this pronunciation contains `/ɹ/`, except perhaps it does not" —
not a clean canonical pronunciation row.

Ingestion resolves them:

1. **Optional `(ɹ)` under the en-US profile** — select the rhotic realisation and
   canonicalise it with the ordinary rhotic rules: stressed NURSE → `/ɝ/`,
   unstressed rhotic schwa → `/ɚ/`, otherwise vowel + `/ɹ/` compositionally.
   So `/ˈwɛðə(ɹ)/` becomes `/ˈwɛðɚ/` — an actual American rhotic pronunciation.
2. **Another optional segment where both realisations are genuinely supported
   en-US pronunciations** — ingestion may expand them into separate normalised
   `word_pronunciations` rows, provided **each** expansion tokenises completely.
   `/ˈfæm(ə)li/` yields `/ˈfæməli/` and `/ˈfæmli/`.
3. **Otherwise fail closed and report the source case.**

The expansion in (2) is subject to the `E4` invariants like any other row: the
natural key `(word_id, ipa_transcription)` deduplicates, and exactly one
pronunciation per word still carries `is_primary`.

### 5.5 Permitted non-clickable marks

`ˈ` `ˌ` `.`

Stress marks and the syllable separator only. They are preserved for display and
carried alongside the phoneme sequence, never stored as `pronunciation_phonemes`
rows.

### 5.6 No silent lossy coercion

A transcription that cannot be represented **fails ingestion and is reported**. It
is never coerced to the nearest canonical unit, and the inventory is never
expanded automatically to accommodate a source.

The failure is per transcription, not per word: a word keeps its other
pronunciations. **Seed validation must assert that every word retains at least one
fully tokenised pronunciation, and that its primary is among them** — a word whose
primary does not tokenise cannot render clickable IPA and is a seed defect.

### 5.7 Runtime loading invariant (Iteration 2 onward)

**Every pronunciation row loaded into the runtime `word_pronunciations` table
must tokenise completely into canonical `phoneme_id`s plus permitted
non-clickable marks.** This is what `FR-IPA-01` requires, and after the
Iteration 2 seed converges it admits no exceptions.

Unsupported source variants may — and should — be retained in the raw, source,
and curation artifacts, where they remain useful evidence. They **must not remain
as runtime pronunciation rows.**

The Iteration 1 state is transitional and does not satisfy this. Iteration 1
loaded 187 pronunciations, of which 7 do not tokenise (§8); those seven must be
filtered or reconciled out of the runtime seed unless an explicitly approved
lossless normalisation is added to §5.2 for them.

**Do not coerce** narrow flap or allophonic variants, RP `/ɒ/`, `/ʍ/`, the
erroneous `/ʙɹɪŋ/` source row, or any other unsupported distinction. Filter and
report them.

Post-Iteration-2 target: **100 % of rows actually loaded into
`word_pronunciations` tokenise.**

---

## 6. Frequency-rank policy

**`canonical_order` in §2 and §4 is not a frequency ranking.** It is a stable
document ordering, grouped by category. Nothing may treat it as linguistic
frequency evidence.

`phonemes.frequency_rank` is **derived by the seed pipeline** from occurrence
counts over the supported en-US pronunciation corpus, *after* canonical
tokenisation:

- count each canonical unit's occurrences across tokenised pronunciations;
- **more frequent unit ⇒ lower rank number**;
- ranks are **dense and unique, 1..N**, as `FR-IPA-01` and the
  `UNIQUE (variant_id, frequency_rank)` constraint require;
- **equal counts break deterministically by `canonical_order`.**

This is seed metadata. It may be regenerated as the corpus grows without changing
the canonical inventory, and regenerating it changes no row identity, because
`phonemes` keys on `UNIQUE (variant_id, ipa_symbol)`.

**Known limitation at Iteration 2 start.** Over the 123-word Iteration 1 corpus,
`/ɔɪ/` and `/aʊ/` never occur and several low-frequency units tie, so the
tie-break carries real weight. The ranking becomes meaningful as the corpus
approaches the `FR-WORD-10` launch target of 5 000 headwords. The learnIPA pages
order by this rank, so it should be regenerated with the launch seed.

---

## 7. Iteration 2 acceptance fixtures

These are the tokenizer's test vectors. All were run against a prototype
implementing §5 on 2026-09-10; results are in §8.

### Must tokenise

| Fixture | Input | Expected to contain |
|---|---|---|
| pre-rhotic `oɹ` | `/ˈoɹənd͡ʒ/` | `ɔ` `ɹ` |
| `oʊ` untouched by that rule | `/ˈkoʊld/` | `oʊ` — proves §5.3.1 is not global |
| `ɚ` unstressed | `/ˈbʌtɚ/` | `ɚ` |
| `ɝ` stressed | `/ɝθ/` | `ɝ` |
| NURSE `ɜɹ` → `ɝ` | `/wɜɹd/` | `ɝ` |
| `əɹ` → `ɚ` in coda | `/ˈfɑ.ðəɹ/` | `ɚ` |
| `əɹ` stays split before a vowel | `/kəɹɛkt/` | `ə` then `ɹ` — the prevocalic guard |
| `ʌ` vs `ə` | `/əˈbʌv/` | `ə` and `ʌ`, distinct |
| source `r` → `ɹ` | `/ˈrɛkɔrd/` | `ɹ` |
| tied `t͡ʃ` | `/t͡ʃɛɚ/` | `tʃ` |
| tied `d͡ʒ` | `/d͡ʒʌmp/` | `dʒ` |
| stress marks | `/ˈkʌpˌkeɪk/` | `k ʌ p k eɪ k`, marks not rows |
| syllable separators | `/ˈoʊ.pən/` | `oʊ p ə n` |
| `ɔ` vs `ɑ` | `/ˈɔ.θɚ/`, `/ˈɑtɚ/` | `ɔ`; `ɑ` |
| length marks | `/fuːd/` | `u` |
| non-syllabic offglide | `/ˈaʊ̯t/` | `aʊ` |
| vowel+R compositional | `/kɑɹ/` | `ɑ` then `ɹ`, two rows |
| atomic diphthong | `/aɪs/` | `aɪ` as one row |
| syllabic consonant | `/ˈhɑs.pɪ.tl̩/` | `ə` `l` |
| optional `(ɹ)` → rhotic | `/ˈwɛðə(ɹ)/` | **one** form, `/ˈwɛðɚ/` |
| optional segment expands | `/ˈfæm(ə)li/` | **two** forms, `/ˈfæməli/` and `/ˈfæmli/` |
| no parenthesis survives | every fixture above | no canonical form contains `(` or `)` |

### Must be rejected

| Fixture | Input | Why |
|---|---|---|
| flap | `/ˈbɑɾɫ̩/` | `[ɾ]` is allophonic, §3.9 |
| RP `ɒ` | `/dɒɡ/` | not an American unit |
| glottal stop | `/hæʔ/` | allophonic |
| RP `ɜː` | `/ˈɜːli/` | not an American unit; only pre-rhotic `ɜɹ` maps |
| voiced-t diacritic | `/ˈdɔ.t̬ɚ/` | narrow transcription |
| bilabial trill | `/ʙɹɪŋ/` | upstream error for `/b/` |

### Corpus-level acceptance

Every pronunciation row **loaded into the runtime table** must tokenise
completely into canonical phoneme ids plus permitted non-clickable marks (§5.7),
and **every word must retain at least one fully tokenised pronunciation, with its
primary among them.**

---

## 8. Validation performed for this draft

Run 2026-09-10 with a prototype of §5 against live English Wiktionary and the
committed Iteration 1 seed. The production implementation is Iteration 2 work.

| Check | Result |
|---|---|
| §4 example rows verified against source | **41 / 41** |
| §7 fixtures | **29 / 29** (22 tokenise, 6 correctly rejected, 1 no-parenthesis check) |
| Stored Iteration 1 pronunciations tokenising | **180 / 187 (96.3 %)** |
| — of those, expanding to two realisations per §5.4 | 12 |
| Words retaining a tokenisable pronunciation | **123 / 123** |
| Words whose primary tokenises | **123 / 123** |
| Canonical units observed in the seed corpus | 40 / 41 (`ɔɪ` absent — §6) |

The 7 pronunciations that do not tokenise are all **secondary** variants that are
genuinely outside the inventory, and each is correctly rejected rather than
coerced. **Per §5.7 these seven must not survive the Iteration 2 seed** — every
one of their words keeps another, valid pronunciation:

| Word | Transcription | Blocked by |
|---|---|---|
| bottle | `/ˈbɑɾɫ̩/` | `[ɾ]` flap, `[ɫ]` dark l |
| hospital | `/ˈhɑs.pɪ.ɾl̩/` | `[ɾ]` flap |
| important | `/ɪmˈpɔɹ.ɾənt/` | `[ɾ]` flap |
| daughter | `/ˈdɔ.t̬ɚ/` | `[t̬]` voiced-t diacritic |
| water | `/ˈwɒ.tɚ/` | `ɒ`, an RP vowel |
| whether | `/ˈʍɛðə(ɹ)/` | `ʍ`, conservative voiceless w |
| bring | `/ʙɹɪŋ/` | `ʙ` bilabial trill — an upstream error for `/b/` |

`bring` is worth reporting upstream; it is a Wiktionary typo, not a dialect.

Note that `whether`'s other transcription, `/ˈwɛðə(ɹ)/`, resolves cleanly to
`/ˈwɛðɚ/` under §5.4, so the word is unaffected by dropping the `/ʍ/` variant.

---

## 9. Change control

This artifact is authoritative for the `en-us` symbol set, its transcription
conventions, and its example words. Changing §2 or §3 is a specification change
requiring an explicit decision — not an implementation convenience. Adding a
source profile to §5 is an ordinary content change, provided it names its source
and coerces nothing silently.

`DOC_INDEX.md` §1 routes to this file. `phonemes` and `phoneme_example_words`
are seeded from it (`FR-CONTENT-02`, `E1`, `E2`).
