# PronounceAll Frontend Design Baseline v1

**Status:** Proposed owner baseline — freeze after maintainer approval  
**Date:** 2026-09-11  
**Scope:** PronounceAll v1 frontend visual language, interaction patterns, and implementation guardrails  
**Audience:** Maintainer, Claude Code, contributors  

---

## 0. Purpose

PronounceAll already has a functional backend, word pages, search, a 41-unit en-US pedagogical IPA inventory, clickable phoneme interactions, and IPA learning pages. The current frontend works but feels sparse and visually generic. This document defines a coherent frontend direction before additional features such as save/tag, accounts, progress, and practice add more UI surface area.

This is intentionally **not** a giant UI specification and **not** a redesign of the product architecture. It is a compact design baseline that tells implementers what PronounceAll should look and feel like, what patterns to reuse, and what generic AI-generated frontend habits to avoid.

The design goal is:

> **A modern language reference and pronunciation lab with editorial clarity, strong typographic hierarchy, and a distinctive “paper + sound” identity — not a SaaS landing page, not a dashboard, and not a Duolingo clone.**

The interface should feel useful enough for a serious learner, friendly enough for casual lookup, and restrained enough that the pronunciation content remains the main visual object.

---

# 1. Research summary

## 1.1 What successful dictionary and pronunciation products do well

The research showed that the strongest reference products do not try to make every section visually equal. They establish a very obvious hierarchy around the searched word, pronunciation, and definition.

### Cambridge Dictionary / Cambridge Pronunciation

Relevant pages:

- https://dictionary.cambridge.org/dictionary/english/beautiful
- https://dictionary.cambridge.org/pronunciation/english/beautiful

Useful patterns:

- Pronunciation appears immediately next to the word rather than being buried.
- UK/US variants are visually separated.
- The pronunciation-specific page includes **sound-by-sound pronunciation**, where the word is decomposed into individual sounds and each sound is connected to an example.
- Audio is presented as a direct action beside the pronunciation.

What PronounceAll should borrow:

- Make the pronunciation block a first-class part of the word page.
- Keep whole-word audio physically adjacent to the IPA it belongs to.
- Make phoneme exploration feel like a natural extension of reading the IPA, not a separate tool.

What PronounceAll should avoid:

- Cambridge pages are content-heavy and can become visually crowded with navigation, ads, cross-links, and secondary modules. PronounceAll should keep the core lookup surface cleaner.

### Merriam-Webster

Reference:

- https://www.merriam-webster.com/dictionary/beautiful

Useful patterns:

- Strong word-first editorial hierarchy.
- High information density without placing every block inside a floating card.
- Sections are separated mainly by typography, whitespace, and rules.
- Definitions read like a reference document rather than a dashboard.

What PronounceAll should borrow:

- Use editorial hierarchy and separators instead of a card for every section.
- Allow a word page to be dense when the content deserves density.
- Keep the headword visually dominant.

What PronounceAll should avoid:

- Do not inherit the amount of peripheral content or promotional clutter common to large commercial dictionary pages.

### Vocabulary.com

Reference:

- https://www.vocabulary.com/dictionary/beautiful

Useful patterns:

- The word, IPA, and learner-friendly explanation appear together near the top.
- Plain-language explanation gives the page more personality than a bare dictionary definition.
- The page moves from a simple learner explanation into more formal definition data.

What PronounceAll should borrow:

- Keep the first screen understandable to a learner, not only a linguist.
- Let the IPA guide the user into deeper pronunciation learning.

What PronounceAll should avoid:

- PronounceAll should not expand into a large thesaurus/word-network interface unless that becomes an explicit product requirement.

### Forvo

Reference:

- https://forvo.com/word/beautiful/

Useful patterns:

- Multiple pronunciations are treated as distinct recordings with speaker/accent provenance.
- Accent context matters.
- Audio is the primary object rather than an afterthought.

What PronounceAll should borrow:

- Never make two distinct pronunciations look as though they share one recording.
- Keep pronunciation provenance understandable when multiple pronunciations exist.

What PronounceAll should avoid:

- Do not reproduce Forvo's long recorder-by-recorder list in the primary word interface. PronounceAll should keep the canonical/primary pronunciation clearer.

### YouGlish

Reference:

- https://youglish.com/

Useful patterns:

- Search is the obvious first action.
- Accent filtering is conceptually close to the search action.
- The product's purpose is understandable immediately: enter a word/phrase and hear it in context.

What PronounceAll should borrow:

- Search must stay prominent on the home page **and on word pages**.
- The user should be able to move from one lookup to another without navigating “back home.”

What PronounceAll should avoid:

- Do not imitate a video-search interface. PronounceAll's differentiator is structured IPA learning, not clip browsing.

### EnglishClub interactive phonemic chart

References:

- https://www.englishclub.com/pronunciation/phonemic-chart.php
- https://www.englishclub.com/pronunciation/phonemic-chart-ia.php

Useful patterns:

- A phoneme inventory benefits from direct interaction and example words.
- Learners understand a sound more quickly when symbol, example, and audio are close together.

What PronounceAll should borrow:

- Keep symbol + example + audio spatially connected.
- Make IPA units clearly interactive.

What PronounceAll should avoid:

- A traditional phoneme chart encodes articulatory relationships spatially. PronounceAll's `/learnIPA` requirement is frequency-ranked, so a classic static chart should not replace the ranked list.

### Quizlet

Reference:

- https://quizlet.com/features/flashcards

Useful pattern for later practice:

- Practice works best when the learner has **one dominant task at a time**.
- The prompt is visually larger than navigation and secondary information.

What PronounceAll should borrow later:

- Practice should feel like a focused exercise, not a dashboard with six equal widgets.

### Duolingo

Reference:

- https://design.duolingo.com/identity/typography

Useful pattern:

- Brand recognition comes from consistent typography and repeated design rules, not from adding decoration everywhere.

What PronounceAll should borrow:

- Use a small, explicit type system consistently.
- Create recognizable rules for how IPA, headwords, labels, and actions look.

What PronounceAll should avoid:

- Cartoon gamification, oversized rounded controls, mascot-driven UI, excessive celebration, and “lesson streak” aesthetics are not appropriate for PronounceAll's intended tone.

---

## 1.2 Established UX/accessibility guidance used in this baseline

### Readable layout and line length

The GOV.UK Design System recommends designing small-screen-first and constraining desktop text widths so reading lines do not become excessively long; its default maximum page width is roughly 1020px and it generally keeps long text to about 75 characters per line.

References:

- https://design-system.service.gov.uk/styles/layout/
- https://design-system.service.gov.uk/styles/spacing/
- https://design-system.service.gov.uk/styles/type-scale/

PronounceAll conclusion:

- Use a bounded page container.
- Keep definitions in a narrower reading column even on wide screens.
- Use a fixed spacing scale rather than arbitrary margins generated per component.

### Target size

WCAG 2.2 Success Criterion 2.5.8 establishes a 24×24 CSS-pixel minimum target in the general case, with defined exceptions. PronounceAll should exceed that for primary controls when practical.

Reference:

- https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum

PronounceAll conclusion:

- Primary buttons and audio controls should aim for ~40–44px visual hit areas.
- Inline IPA units are a special inline-content case, but they must still be comfortably targetable and spaced so adjacent symbols are not frustrating to activate.

### Keyboard focus

Visible focus needs sufficient size and contrast. PronounceAll already has keyboard-operable IPA interaction; the redesign must make that focus visually obvious rather than merely technically present.

Reference:

- https://www.w3.org/WAI/WCAG22/Understanding/focus-appearance.html

### Reduced motion

W3C and MDN recommend respecting `prefers-reduced-motion` so users can suppress non-essential motion.

References:

- https://www.w3.org/WAI/WCAG21/Techniques/css/C39
- https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/At-rules/@media/prefers-reduced-motion

PronounceAll conclusion:

- Motion is optional polish, never structural.
- No scroll-reveal animation, bouncing, continuous pulsing, or page-wide motion.

---

# 2. The “AI frontend sameness” problem

This section summarizes current practitioner commentary and design-community consensus. It is **not a formal UX standard**, but the pattern is consistent across 2025–2026 design writing and community discussion.

Useful references:

- CSS DNA, “Why Every AI-Generated UI Looks the Same” (2026): https://cssdna.com/blog/why-ai-generated-uis-look-the-same/
- Slicer.dev, “Why AI-generated UI all looks the same” (2026): https://slicer.dev/blog/why-ai-generated-ui-looks-the-same
- AI Made This, “Why All Vibe-Coded Designs Look the Same” (2025): https://aimadethis.design/blog/why-all-vibe-coded-designs-look-the-same
- Hacker News discussion on “AI beige slop”: https://news.ycombinator.com/item?id=46956964

The common explanation is simple: when a coding model receives an underspecified instruction such as “make this modern and clean,” it tends to generate the statistical center of the frontend examples it has seen. Popular Tailwind, shadcn/ui, Vercel-style, and SaaS templates therefore become disproportionately common defaults.

Typical tells:

- purple/indigo/blue gradients;
- gradient text in hero headings;
- Inter used without a brand reason;
- giant centered hero text;
- a small pill badge above every heading;
- three equal feature cards in a row;
- cards nested inside cards;
- `rounded-xl` or 16–24px radii on almost everything;
- frosted glass / glassmorphism;
- soft glow shadows around ordinary containers;
- generic Lucide icons inside tinted rounded squares;
- excessive empty space between simple content blocks;
- hover states where cards float upward;
- fade-up animation on every section;
- generic “Get started” CTA patterns even when the product is not a SaaS marketing site.

None of these techniques is inherently bad. The problem is **using them as defaults without a content-driven reason**.

## 2.1 How PronounceAll avoids it

The solution is not “tell Claude to be more creative.” The solution is to make the visual rules explicit and machine-readable.

PronounceAll therefore freezes:

1. exact colors;
2. exact typography roles;
3. exact spacing scale;
4. small radius scale;
5. rules for when a border/card is justified;
6. page-width and content-measure rules;
7. component hierarchy;
8. a blacklist of generic AI design habits.

Claude Code must treat these rules as constraints, not suggestions to reinterpret each time a new page is created.

---

# 3. Recommended visual direction

## 3.1 Direction name: **Editorial Language Lab**

The visual character should sit between:

- a well-designed modern dictionary;
- a linguistics notebook/reference sheet;
- a focused learning tool.

It should **not** look like:

- a startup landing page;
- a dashboard template;
- a glassmorphic AI product;
- a children's learning game;
- a clone of Cambridge, Duolingo, or Quizlet.

### Core visual idea

Use a **warm paper canvas**, dark ink, thin editorial rules, and one burnt-orange “sound/action” accent. IPA gets its own linguistically appropriate typeface. The UI relies on typography and alignment more than containers.

The product's distinctive visual motif is **sound notation**, not generic tech imagery. Slashes `/ /`, stress marks, phoneme units, underlines, and compact audio actions may become recognizable visual elements. Do not decorate pages with fake waveforms unless the waveform conveys actual audio information.

---

# 4. Design tokens to freeze now

These values are the proposed baseline. Once owner-approved, new components should use these tokens instead of inventing new values.

## 4.1 Color system

```css
:root {
  /* Canvas and surfaces */
  --color-canvas: #F7F4ED;      /* warm paper */
  --color-surface: #FFFDF8;     /* raised/contained surface */
  --color-ink: #181713;         /* primary text */
  --color-text: #2C2A26;        /* normal body */
  --color-muted: #5B5850;       /* secondary text; AA-safe on canvas */
  --color-rule: #D9D4C8;        /* dividers/borders */
  --color-rule-soft: #E9E4DA;

  /* Brand/action */
  --color-accent: #A34700;      /* burnt orange */
  --color-accent-hover: #8F3F0F;
  --color-accent-soft: #F1DFCF;

  /* Semantic */
  --color-success: #236A4B;
  --color-danger: #9C2F2F;
  --color-focus: #1F5B55;
}
```

### Color rules

- Do **not** add decorative gradients in the core product UI.
- Do **not** introduce purple/indigo as a default “tech” accent.
- Burnt orange is for meaningful interactivity: primary actions, active phoneme state, play controls, important links.
- Dark teal is reserved for focus/accessibility and may be used sparingly for success/learning-confirmed states only when semantics justify it.
- A color must not be used as the only indicator of state.
- Most of the page should remain ink + paper + rule colors.

Why this direction:

- It is warmer and more editorial than generic white/blue SaaS.
- It leaves IPA and pronunciation content visually dominant.
- The accent is strong enough to make interaction obvious without turning the page into a color field.

---

## 4.2 Typography

### UI/body family

**IBM Plex Sans** is the preferred UI typeface.

Reasons:

- open-source and suitable for UI;
- more distinctive than the now-ubiquitous Inter default;
- serious without feeling bureaucratic;
- compatible with the “language lab” direction.

Reference/license/source:

- https://github.com/IBM/plex

### IPA family

**Charis SIL** is the preferred dedicated IPA typeface.

Reasons:

- explicitly designed for broad phonetic/orthographic needs;
- excellent IPA coverage;
- open under the SIL Open Font License;
- visually differentiates pronunciation notation from UI chrome.

Reference:

- https://software.sil.org/charis/

### Font delivery

- Self-host WOFF2 files.
- Do not load fonts from a third-party CDN.
- Keep the number of weights minimal.
- Initial target: IBM Plex Sans `400`, `500`, `600`; Charis SIL `400` only unless a real need for another weight appears.
- Subsetting is allowed only if every canonical IPA symbol, stress mark, punctuation mark, and intentionally displayed phonetic symbol is proven to remain present.
- The existing IPA glyph test must remain authoritative.

### Type roles

```text
Body             16–17px / 1.55
Small/meta       13–14px / 1.4
Navigation       14–15px / 1.2, medium
Section heading  22–26px / 1.2, semibold
Headword         42–52px desktop; 34–40px mobile / ~1.05
Main IPA         28–34px desktop; 24–30px mobile / ~1.25, Charis SIL
Popover IPA      34–40px / 1.1, Charis SIL
```

Rules:

- Do not use giant 64–96px SaaS hero headings.
- Headwords are the largest recurring typographic element.
- IPA must never be tiny secondary metadata.
- Avoid full-uppercase labels except very short technical labels where scanning genuinely improves.
- Body paragraphs should stay left aligned and never fully justified.

---

## 4.3 Spacing system

Use a strict 4px-based scale:

```css
--space-1: 4px;
--space-2: 8px;
--space-3: 12px;
--space-4: 16px;
--space-5: 24px;
--space-6: 32px;
--space-7: 48px;
--space-8: 64px;
```

Rules:

- Prefer these values over arbitrary `18px`, `27px`, `52px`, etc.
- Do not solve “clean design” by adding 96–160px of empty vertical space.
- Most content-section gaps on a word page should be 24–32px, not 64–96px.
- Large 48–64px gaps are reserved for genuine section changes.

---

## 4.4 Radius system

```css
--radius-sm: 4px;
--radius-md: 7px;
--radius-lg: 10px;
--radius-round: 999px; /* only genuinely pill/circular semantics */
```

Rules:

- Ordinary panels should not use 16–24px rounded corners.
- Search inputs/buttons may use 7–10px, not oversized pills.
- `999px` is allowed for a true status chip, tiny variant badge, circular audio control, or avatar — not every button.

---

## 4.5 Borders and shadows

Default separation method:

1. typography;
2. whitespace;
3. 1px rules;
4. surface color;
5. shadow only when physical layering matters.

Use a shadow primarily for:

- phoneme popover;
- modal/dialog if one exists later;
- temporarily floating autocomplete surface.

Do not put shadows around ordinary word-page sections.

Recommended popover shadow:

```css
box-shadow: 0 8px 24px rgb(24 23 19 / 0.12);
```

No neon glow. No card hover-lift.

---

# 5. Global page shell

## 5.1 Width

```css
--page-max: 1040px;
--reading-max: 720px;
--narrow-max: 640px;
```

- Main page container: max 1040px, centered.
- Definitions and long prose: normally max ~720px.
- Practice task: normally max ~640px.
- Desktop whitespace comes from bounded reading width, not from tiny floating cards.

Recommended horizontal padding:

- mobile: 16px;
- tablet: 24px;
- desktop: 32px.

Breakpoints may remain implementation details, but 640px and ~960px are sufficient for the current product. Do not create a breakpoint per device model.

---

# 6. Header, navigation, and search

Search is a primary product action and must be visible on every word lookup flow.

## 6.1 Desktop header

Target structure:

```text
PronounceAll     [ Search a word........................ ]    Learn IPA   Account
```

Rules:

- Header height approximately 60–68px.
- Wordmark at left.
- Search occupies the largest horizontal share.
- Secondary nav is visually quieter.
- Search submit button may be icon + accessible label or short text; avoid a giant branded CTA.
- Search should never be hidden behind a hamburger on normal desktop widths.

The header may become sticky later, but sticky behavior is **not frozen now**. Do not implement it merely because “modern sites have sticky headers.”

## 6.2 Mobile header

Use two rows when needed:

```text
PronounceAll                         Menu/account
[ Search a word.............................. ]
```

Do not crush the search field into a tiny 120px control beside the logo.

## 6.3 Search field

- Height: approximately 42–46px.
- Radius: 7px.
- 1px neutral border at rest.
- Strong focus outline.
- Search icon is optional; it must not replace an accessible label.
- Placeholder example: `Search a word`.
- On unknown-word pages, prefill the attempted term as already implemented.

The home page should put search above all secondary content. The word page should keep it in the global shell so the next lookup is always one action away.

---

# 7. Word page — primary reference design

The word page is the **reference implementation** for the rest of the product. New pages should inherit its typography, spacing, controls, and rules instead of inventing a new aesthetic.

## 7.1 Information hierarchy

Order:

1. headword;
2. part of speech / small grammatical metadata if available;
3. primary pronunciation;
4. alternate pronunciations;
5. definitions;
6. relevant learner actions (save/tag when implemented);
7. source/attribution;
8. secondary discovery links only when genuinely useful.

## 7.2 Do not wrap the entire word in a card

The main page should read as a reference sheet on the paper canvas.

Use a top and/or bottom rule around major pronunciation/definition transitions if needed. Avoid:

```text
[ giant rounded card
  [ pronunciation card ]
  [ definition card ]
  [ source card ]
]
```

That is exactly the card-in-card structure we want to avoid.

## 7.3 Headword block

Recommended desktop:

```text
beautiful                                      Save
adjective

/ˈbju.../     [▶ Play]     General American
```

- Headword: 42–52px.
- Part of speech: muted 14–15px.
- Save control, when added, belongs on the same visual row as the headword or at the start of the learning-actions row — not in a separate dashboard card.

## 7.4 Pronunciation block

The pronunciation should be visually distinct using a **thin accent rule or left marker**, not a rounded container around every line.

Example:

```text
│ PRIMARY PRONUNCIATION
│ /ˈbju.tə.fəl/        ▶
│  b   j   u   t   ə   f   əl
```

The accent rule can use `--color-accent`.

Do not necessarily display both the raw transcription and a second identical tokenized transcription if this duplicates information. The clickable transcription itself should be the main artifact.

## 7.5 Multiple pronunciations

Treat each pronunciation as a real row, not as a collection of equal cards.

```text
Primary      /ˈɹɛk.ɚd/       ▶
Alternative  /ɹɪˈkɔɹd/       ▶
```

Use:

- thin horizontal rule between rows;
- `Primary` as quiet text or a small semantic marker;
- audio only when that exact pronunciation has a valid matching asset.

Never reuse the primary audio visually or behaviorally for a different secondary pronunciation.

## 7.6 Definitions

Definitions should be editorial, not card-based.

```text
Meaning

1  Very attractive or pleasing to the senses.
2  Excellent or very pleasing.
```

- Number senses when multiple meanings exist.
- Number column can be muted and aligned.
- Definition text should use readable measure, around 65–75 characters per line.
- Examples, when added, should be indented or visually secondary rather than placed in a separate glowing box.

## 7.7 Attribution

Attribution is important but should not compete with the definition.

Recommended treatment:

- thin top rule;
- 13–14px muted text;
- links remain keyboard-visible;
- do not hide attribution behind hover-only UI.

---

# 8. Clickable IPA design

IPA interaction is PronounceAll's signature feature. It should look interactive without making each symbol resemble a separate SaaS button.

## 8.1 Default state

Each canonical unit should:

- remain visually part of a continuous transcription;
- use Charis SIL;
- have enough padding/hit area to be comfortably clicked;
- use a subtle bottom border or background change on hover/focus rather than permanent pill shapes.

Recommended concept:

```css
.phoneme {
  display: inline-flex;
  align-items: center;
  min-height: 32px;
  padding-inline: 3px;
  border-radius: var(--radius-sm);
  color: var(--color-ink);
  background: transparent;
}

.phoneme:hover {
  color: var(--color-accent-hover);
  background: var(--color-accent-soft);
}

.phoneme[aria-expanded="true"] {
  color: white;
  background: var(--color-accent);
}
```

Exact CSS may be adjusted for glyph metrics, but the visual rule is frozen: **inline sound units, not a chain of pill buttons**.

## 8.2 Keyboard

Existing behavior should remain:

- tab/focus reaches each clickable phoneme;
- Enter/Space opens/activates;
- Escape closes the popover;
- focus returns predictably.

Focus must be visually obvious with a real outline, not only a background-color change.

Recommended focus concept:

```css
:focus-visible {
  outline: 2px solid var(--color-focus);
  outline-offset: 3px;
}
```

## 8.3 Stress and punctuation

Stress marks and syllable punctuation remain visually continuous with the transcription but are not styled as clickable.

Do not make punctuation appear disabled; it is simply notation.

---

# 9. Phoneme popover

The popover is one of the few places where a contained floating surface is semantically justified.

Recommended shape:

```text
┌─────────────────────────────┐
│ /ə/                     ×   │
│                             │
│ as in  about                 │
│        /əˈbaʊt/              │
│                             │
│ ▶ Hear /ə/                  │
└─────────────────────────────┘
```

Design:

- width ~260–320px;
- surface `#FFFDF8`;
- 1px rule;
- 7–10px radius;
- modest real shadow;
- IPA symbol 34–40px;
- example word 16–18px;
- audio action clearly labeled;
- no decorative icon cluster.

Interaction:

- positioned near trigger where possible;
- must remain within viewport;
- Escape closes;
- clicking outside may close;
- trigger state remains perceivable while open;
- no autoplay.

No tooltip-only critical information. On touch devices the popover must work as a tap-open surface, not depend on hover.

---

# 10. Audio controls

Do not use the browser's large native `<audio controls>` strip in the primary word/pronunciation UI once the final custom control is available.

Use a compact control:

```text
▶
```

or

```text
▶ Play
```

Rules:

- whole-word audio belongs beside the exact pronunciation;
- phoneme audio belongs inside the phoneme popover and `/learnIPA` row;
- no autoplay;
- show loading/playing state without layout shift;
- use a real `button` with an accessible name;
- primary hit area should aim for ~40–44px;
- do not animate a fake waveform for decoration;
- if a waveform is ever shown, it must correspond to actual audio data.

---

# 11. `/learnIPA` design

The current frequency-ranked requirement should remain visible in the interface. Do **not** turn the 41 phonemes into a generic 4×10 card grid.

Recommended desktop structure:

```text
Learn the sounds of American English
41 teaching units, most common first.

[ Search a word................................ ]

Rank   Sound     Example                     Action
────────────────────────────────────────────────────
 1      /ɪ/      sit   /sɪt/                 ▶   Save
 2      /t/      ten   /tɛn/                 ▶   Save
 3      /ə/      about /əˈbaʊt/              ▶   Save
 ...
```

This can be semantic list/grid markup rather than a literal HTML table if responsive behavior is cleaner.

Rules:

- one row per teaching unit;
- strong IPA column;
- example word adjacent;
- frequency rank visible but quiet;
- play/save controls aligned consistently;
- thin rules between rows;
- row hover may use a very subtle surface change;
- no card around every sound.

Mobile:

```text
1   /ɪ/        ▶
    sit /sɪt/
────────────────
2   /t/        ▶
    ten /tɛn/
```

Do not make the user horizontally scroll the inventory.

A traditional articulatory phonemic chart may be explored later as a secondary learning visualization, but it must not replace the required frequency-ranked list without an explicit product decision.

---

# 12. Home page

The home page should be search-first and **not** a SaaS marketing landing page.

Avoid:

- giant centered slogan;
- “Trusted by 10,000 learners” filler;
- three feature cards;
- gradient hero;
- CTA repeated three times;
- generic illustration of a person wearing headphones.

Recommended structure:

```text
PronounceAll

See the sounds inside a word.
[ Search a word...................................... ]

Try: gorgeous · thought · record · water · comfortable

Learn the 41 sounds of American English →

─────────────────────────────────────────────────────
A short 2–3 sentence explanation of clickable IPA.
```

The page should feel useful within one second. Search is the hero.

---

# 13. Search results and unknown-word states

## Search results

Use a simple ranked list, not a card grid.

```text
Results for “gorgeus”

1  gorgeous       /ˈɡɔɹ.dʒəs/
2  gorge          /ɡɔɹdʒ/
...
```

The query/search field stays visible at top.

## Unknown word

Recommended hierarchy:

```text
We don't have “x” yet.

Did you mean?
  gorgeous
  ...

[ Search again........................ ]

Request this word
[ Request ]
```

- Do not use a giant sad illustration.
- The state should help the learner recover immediately.
- Suggestions are more visually important than the request form.

---

# 14. Future save/tag design

Do not create a new floating card solely to hold a bookmark icon.

Recommended states:

- unsaved: outline bookmark + `Save` when room permits;
- saved: filled/strong bookmark + `Saved` or accessible state text;
- tag editing appears in a small popover or dedicated lightweight panel after save.

State must not rely only on color.

On word pages, save belongs near the headword or pronunciation learning area. On `/learnIPA`, it belongs at the end of the phoneme row.

---

# 15. Future practice interface

Practice should use one dominant learning task.

Recommended structure:

```text
12 / 20                                      session progress

Which sound do you hear?

              [ ▶ Play ]

       /ɪ/        /i/        /ɛ/

────────────────────────────────
Again        Hard        Good        Easy
```

Rules:

- one prompt per screen;
- no dashboard widgets around the question;
- progress is visible but visually secondary;
- feedback appears close to the answer;
- keyboard shortcuts may be added with visible discoverability;
- animations, if any, are brief and non-essential;
- no confetti as a default correct-answer response.

Quizlet's focused-card model is a better inspiration here than a multi-panel analytics dashboard.

---

# 16. Responsive behavior

Design small-screen-first.

## Mobile

- one column;
- 16px outer padding;
- search full width;
- headword 34–40px;
- IPA 24–30px;
- pronunciation controls wrap below only when necessary;
- no horizontal scrolling at 320px;
- popovers become anchored overlays or near-full-width compact sheets when there is insufficient room.

## Tablet

- 24px outer padding;
- same content order;
- do not create a two-column layout merely because width exists.

## Desktop

- 1040px shell;
- reading column usually ~720px;
- a second column should appear only when there is **real persistent content** worth showing, such as future learner state or related learning tools.
- Do not invent sidebars as filler for empty space.

---

# 17. How to fix the current “empty” feeling

The current problem should **not** be solved by surrounding every block with a card.

The emptiness comes primarily from weak hierarchy and insufficient structural rhythm.

Fix it with:

1. a compact but substantial global header with persistent search;
2. a larger headword;
3. a larger IPA transcription;
4. a visually anchored pronunciation section;
5. consistent section headings;
6. tighter 24–32px vertical rhythm;
7. thin editorial separators;
8. clear alignment between pronunciation rows and actions;
9. stronger definition typography;
10. meaningful content density when multiple pronunciations/definitions exist.

Do **not** fix it with:

- random recommendation cards;
- fake stats;
- decorative dashboard widgets;
- huge hero padding;
- illustrations that communicate nothing;
- excessive boxed containers.

A page can have whitespace and still feel intentional when the typography and alignment create a strong composition.

---

# 18. Icon strategy

Use icons only where their meaning is conventional and useful.

Initial icon set should stay tiny:

- search;
- play/pause;
- bookmark/save;
- close;
- optional chevron where expansion exists.

Rules:

- no icon for every section heading;
- no decorative icons in colored rounded squares;
- pair ambiguous icons with text or an accessible label;
- do not add a large icon dependency just to obtain five symbols;
- simple local SVGs or a minimal sprite are preferable.

---

# 19. Illustration and imagery

Core reference pages should generally use **no decorative illustration**.

If illustration is introduced later:

- it must be custom to pronunciation/language learning;
- it should use the paper/ink/accent language;
- it must not be generic stock “person with laptop/headphones” art;
- it must not be generated simply to fill empty space.

Photography is not required for the core product.

---

# 20. Motion

Default transitions should be subtle:

```text
color/background: ~100–150ms
popover appearance: ~120–180ms opacity + very small translation if desired
button press: immediate or <=100ms
```

No:

- scroll-reveal sections;
- bounce;
- constant pulsing;
- parallax;
- large scale transforms;
- hover-lift on every row/card.

All non-essential motion must respect:

```css
@media (prefers-reduced-motion: reduce) {
  /* suppress non-essential transitions/animation */
}
```

---

# 21. Accessibility baseline

The frontend redesign must preserve or improve the current accessibility work.

Freeze these rules:

- WCAG 2.2 AA is the practical baseline.
- Normal text contrast target: at least 4.5:1.
- UI/focus indicators must remain clearly visible.
- Primary controls should aim for ~40–44px hit areas.
- Do not make adjacent phoneme targets frustratingly small.
- Full keyboard operation remains required for IPA interactions.
- Escape closes transient popovers and restores predictable focus.
- No hover-only required action.
- No color-only state.
- Search and form inputs have persistent accessible labels even if a visible placeholder is used.
- Audio never autoplays.
- Page remains readable without JavaScript where current progressive-enhancement requirements say it should.
- Test 200% zoom and narrow reflow.
- Continue axe checks and real keyboard QA.

---

# 22. Dark mode strategy

**Do not build dark mode as part of this redesign.**

Do make it possible later by using semantic color tokens rather than hard-coded component colors.

If dark mode is added later, it should be a deliberate owner decision with:

- a tested dark palette;
- IPA contrast verification;
- audio/focus state review;
- `prefers-color-scheme` and/or explicit user choice;
- persistence behavior defined.

Do not auto-generate a dark palette by mechanically inverting colors.

---

# 23. Technical implementation constraints

This design baseline must fit the existing PronounceAll architecture.

### Must preserve

- server-rendered EJS;
- vanilla JS and raw CSS;
- no SPA requirement;
- no browser-side IPA parsing;
- IPA units arrive from server-side `pronunciation_phonemes` data;
- progressive enhancement/no-JS readability;
- strict CSP with no inline scripts/styles;
- cacheable shared word-page shell behavior;
- no viewer-specific content leaking into shared edge-cached HTML;
- current performance budget;
- existing route → service → repository architecture.

### Frontend implementation rule

**Do not add React, Vue, Svelte, Tailwind, shadcn/ui, Bootstrap, Material UI, or a CSS-in-JS system for this redesign.**

The current product does not need them. Adding a framework would increase complexity and also pull the interface toward the same component defaults this baseline is specifically trying to avoid.

### CSS organization

Prefer a small token layer plus component/feature sections:

```text
1. tokens
2. reset/base
3. typography
4. shell/header/footer
5. forms/buttons
6. word page
7. IPA/phoneme/popover
8. learnIPA
9. search/error states
10. utilities/accessibility
11. responsive overrides
```

Do not create one-off values in every template.

---

# 24. Anti-pattern blacklist for Claude Code

When implementing or extending PronounceAll, **do not introduce any of the following unless the maintainer explicitly requests it**:

- purple/blue decorative gradients;
- gradient text;
- glassmorphism;
- frosted translucent cards;
- giant centered SaaS hero sections;
- feature grids of three equal cards;
- card-in-card nesting;
- 16–24px radius everywhere;
- pill buttons everywhere;
- generic icon-in-colored-square decoration;
- arbitrary Lucide icon proliferation;
- “floating” cards with large soft shadows;
- hover translateY/lift on ordinary content;
- scroll-reveal/fade-up on every section;
- unnecessary charts/stat widgets;
- fake waveforms;
- stock illustrations to fill space;
- generic “Get Started” marketing CTAs inside the dictionary product;
- excessive centered text;
- excessive vertical whitespace marketed as “clean.”

If a new component does not fit the baseline, Claude must ask whether a new design pattern is actually needed instead of silently inventing one.

---

# 25. Wireframes

## 25.1 Desktop word page

```text
┌────────────────────────────────────────────────────────────────────────────┐
│ PronounceAll   [ Search a word............................. ]  Learn IPA    │
├────────────────────────────────────────────────────────────────────────────┤
│                                                                            │
│  beautiful                                                     ♧ Save      │
│  adjective                                                                 │
│                                                                            │
│  │ Primary pronunciation                                                   │
│  │ /ˈbju.tə.fəl/                                      [▶ Play]             │
│  │  b   j   u   t   ə   f   əl                                            │
│                                                                            │
│  ─────────────────────────────────────────────────────────────────────     │
│                                                                            │
│  Meaning                                                                   │
│                                                                            │
│  1   Very attractive or pleasing to the senses or mind.                   │
│                                                                            │
│  2   Excellent or very pleasing.                                          │
│                                                                            │
│  ─────────────────────────────────────────────────────────────────────     │
│  Source: Wiktionary · attribution/licence                                  │
│                                                                            │
└────────────────────────────────────────────────────────────────────────────┘
```

Key idea: **one editorial page, not five separate cards.**

## 25.2 Mobile word page

```text
┌──────────────────────────────┐
│ PronounceAll                 │
│ [ Search a word........... ] │
├──────────────────────────────┤
│                              │
│ beautiful                    │
│ adjective              Save  │
│                              │
│ │ Primary                    │
│ │ /ˈbju.tə.fəl/       ▶      │
│ │ b j u t ə f əl             │
│                              │
│ ───────────────────────────  │
│ Meaning                      │
│                              │
│ 1 Very attractive or         │
│   pleasing to the senses.    │
│                              │
│ 2 Excellent or very          │
│   pleasing.                  │
│                              │
│ ───────────────────────────  │
│ Source · licence             │
└──────────────────────────────┘
```

## 25.3 `/learnIPA`

```text
┌─────────────────────────────────────────────────────────────────────┐
│ PronounceAll  [ Search a word...................... ]   Learn IPA   │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│ Learn the sounds of American English                                │
│ 41 teaching units, ordered by frequency.                            │
│                                                                     │
│ #    Sound     Example                                   Actions    │
│ ─────────────────────────────────────────────────────────────────   │
│ 1     /ɪ/      sit      /sɪt/                           ▶   Save    │
│ 2     /t/      ten      /tɛn/                           ▶   Save    │
│ 3     /ə/      about    /əˈbaʊt/                        ▶   Save    │
│ 4     /n/      nap      /næp/                           ▶   Save    │
│ ...                                                                 │
└─────────────────────────────────────────────────────────────────────┘
```

---

# 26. Inspiration matrix

| PronounceAll component | Primary inspiration | What to borrow | What not to copy |
|---|---|---|---|
| Word-page hierarchy | Merriam-Webster | Headword-first editorial density | Commercial clutter |
| Learner-friendly definition flow | Vocabulary.com | IPA near word; approachable explanation | Large word-network expansion |
| Sound-by-sound exploration | Cambridge Pronunciation | Pronunciation decomposed into learnable sounds | Exact UK/US visual system |
| Multiple audio/pronunciation provenance | Forvo | Distinct pronunciation/speaker/accent context | Long recorder list as main UI |
| Persistent lookup | YouGlish | Search as primary action | Video-centric interface |
| IPA learning | EnglishClub interactive chart | Symbol + example + audio proximity | Replacing ranked list with a fixed chart |
| Future practice | Quizlet | One dominant study task | Generic dashboard shell |
| Brand consistency | Duolingo design guidelines | Strong repeated typography rules | Mascot/cartoon/gamified aesthetic |
| Layout/spacing discipline | GOV.UK Design System | Bounded width, readable measure, scale-based spacing | Government visual identity |
| Accessibility | W3C WCAG 2.2 | target size, focus, motion guidance | N/A |

---

# 27. What should be frozen now vs. left flexible

## Freeze now

- Editorial Language Lab direction.
- Warm paper / dark ink / burnt-orange action palette.
- IBM Plex Sans UI family.
- Charis SIL IPA family, self-hosted.
- 4px spacing scale.
- small radius scale.
- no decorative gradients/glassmorphism/card grids.
- 1040px overall max width and ~720px reading measure.
- search remains globally prominent.
- word page is the reference visual implementation.
- pronunciation is a first-class block.
- IPA units stay inline rather than pills.
- popover visual pattern.
- compact custom audio control direction.
- `/learnIPA` uses ranked rows rather than cards.
- accessibility/motion baseline.
- no frontend framework/component-library addition for the redesign.

## Leave flexible until needed

- exact logo/wordmark artwork;
- whether desktop header becomes sticky;
- whether a useful right sidebar ever exists;
- exact saved-word/tag-management layout;
- exact account/settings layout;
- exact SM-2 practice answer-control wording;
- dark mode;
- custom illustration system;
- traditional IPA chart as an optional secondary visualization;
- animation details beyond the “minimal + reduced-motion” rule.

---

# 28. Implementation sequence

Do not redesign every planned page at once.

### Phase A — establish the system

1. Add semantic CSS tokens.
2. Self-host/verify the approved fonts.
3. Redesign global shell/header/search/footer.
4. Establish buttons, fields, focus states, rules, typography.

### Phase B — prove the baseline on existing pages

Implement in this order:

1. word page;
2. phoneme popover;
3. home page;
4. search results;
5. unknown-word/request page;
6. `/en-us/learnIPA` and `/learnIPA`.

Stop after these pages and have the maintainer visually review them at desktop and mobile sizes before treating the visual baseline as frozen.

### Phase C — inherit, do not reinvent

Later save/tag, accounts, and practice features must use the same tokens and established patterns.

---

# 29. Visual QA acceptance checklist

Before the frontend baseline is considered implemented:

- [ ] Home page search is immediately visible without scrolling.
- [ ] Word pages keep search visible in the global shell.
- [ ] Headword is the dominant visual element.
- [ ] IPA is visually prominent and uses the IPA font.
- [ ] Clickable phonemes look interactive but not like a row of pills.
- [ ] Keyboard focus is obvious.
- [ ] Phoneme popover works by keyboard and pointer/touch.
- [ ] Multiple pronunciations are distinguishable without separate giant cards.
- [ ] Definitions use readable measure.
- [ ] `/learnIPA` remains frequency-ranked and does not become a card grid.
- [ ] 320px, 375px, 768px, 1024px, and 1440px widths have no horizontal overflow.
- [ ] No decorative gradient was introduced.
- [ ] No glassmorphism was introduced.
- [ ] No card-in-card layout was introduced.
- [ ] No new frontend framework/component library was introduced.
- [ ] No inline script/style was introduced.
- [ ] No viewer-specific state leaks into the shared cacheable word shell.
- [ ] No-JS reading behavior remains intact where required.
- [ ] `prefers-reduced-motion` is respected.
- [ ] axe tests remain green.
- [ ] Contrast is checked rather than guessed.
- [ ] IPA glyph coverage test remains green.
- [ ] Performance remains comfortably inside the existing budget.

---

# 30. Maintainer decision / freeze statement

This document is a **research-backed proposed frontend baseline**, not a silent amendment to the SRS or SDD.

Once the maintainer approves the visual direction and tokens, this document becomes the authoritative frontend design baseline for v1 implementation. Claude Code may implement within it, but must not independently change the product's aesthetic language or add new generic UI patterns.

If a later product requirement genuinely needs a new pattern, add the smallest documented extension rather than redesigning the entire system.

---

# 31. Research references

Primary product/reference examples:

1. Cambridge Dictionary — beautiful: https://dictionary.cambridge.org/dictionary/english/beautiful
2. Cambridge pronunciation — beautiful: https://dictionary.cambridge.org/pronunciation/english/beautiful
3. Merriam-Webster — beautiful: https://www.merriam-webster.com/dictionary/beautiful
4. Vocabulary.com — beautiful: https://www.vocabulary.com/dictionary/beautiful
5. Forvo — beautiful: https://forvo.com/word/beautiful/
6. YouGlish: https://youglish.com/
7. EnglishClub Phonemic Chart: https://www.englishclub.com/pronunciation/phonemic-chart.php
8. EnglishClub Interactive Phonemic Chart: https://www.englishclub.com/pronunciation/phonemic-chart-ia.php
9. Quizlet Flashcards: https://quizlet.com/features/flashcards
10. Duolingo Typography Guidelines: https://design.duolingo.com/identity/typography
11. IBM Plex: https://github.com/IBM/plex
12. Charis SIL: https://software.sil.org/charis/

Accessibility/layout references:

13. GOV.UK Layout: https://design-system.service.gov.uk/styles/layout/
14. GOV.UK Spacing: https://design-system.service.gov.uk/styles/spacing/
15. GOV.UK Type Scale: https://design-system.service.gov.uk/styles/type-scale/
16. WCAG 2.2 Target Size: https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum
17. WCAG Focus Appearance: https://www.w3.org/WAI/WCAG22/Understanding/focus-appearance.html
18. W3C Reduced Motion Technique: https://www.w3.org/WAI/WCAG21/Techniques/css/C39
19. MDN `prefers-reduced-motion`: https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/At-rules/@media/prefers-reduced-motion

AI-aesthetic / design-homogeneity commentary:

20. CSS DNA — Why Every AI-Generated UI Looks the Same: https://cssdna.com/blog/why-ai-generated-uis-look-the-same/
21. Slicer.dev — Why AI-generated UI all looks the same: https://slicer.dev/blog/why-ai-generated-ui-looks-the-same
22. AI Made This — Why All Vibe-Coded Designs Look the Same: https://aimadethis.design/blog/why-all-vibe-coded-designs-look-the-same
23. Hacker News discussion — “AI beige slop”: https://news.ycombinator.com/item?id=46956964

The AI-aesthetic sources are practitioner/community commentary and are used here to identify recurring visual defaults. Accessibility and layout requirements should continue to be grounded primarily in W3C and established design-system guidance.
