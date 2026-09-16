# PronounceAll — Privacy Policy (DRAFT)

**Status:** DRAFT v0.1 for owner review, 2026-09-17. Not published. Served at
`/privacy` once approved (FR-CONSENT-05). Final legal wording is reviewed by someone
with legal knowledge before go-live (FR-CONSENT-05).
**Source of truth:** every statement below describes behaviour specified in SRS
1.0.6, SDD v1.1 and the Round 1 Decisions. Items marked **[OWNER]** are facts the
specifications do not fix and must be supplied or confirmed before publication.
Sections marked **[ACCOUNTS]** describe registered accounts, which launch in
Iteration 4; they are omitted from the published page until accounts exist.
**Paired document:** `PronounceAll_KVKK_Aydinlatma_Metni_TR_DRAFT.md` is drafted from
the same facts and must stay equivalent.

---

## 1. Who we are

PronounceAll (pronounceall.com) is a free, open-source website for learning English
pronunciation through the International Phonetic Alphabet.

The data controller is **[OWNER: full name or legal entity, postal address]**.

Contact for privacy questions and data requests: **[OWNER: contact email address]**.

## 2. The short version

- You can read every word page without an account and without giving us anything.
- We use **one strictly necessary cookie**, `pa_uid`, a random identifier that lets
  the site remember your saved words and sounds. It is not used for advertising or
  cross-site tracking.
- We keep a history of your learning activity **only after you start using the
  learning features** — for example, by saving a word or a sound.
- We load no advertising or analytics trackers.
- You can ask us for a copy of your data, or to delete it.

## 3. What we collect, and why

### 3.1 The `pa_uid` identifier

A random identifier (a version 4 UUID) stored in a cookie and mirrored in your
browser's `localStorage`, so that clearing one does not lose your progress. It
contains nothing about you. Reading pages never creates a database record about you:
a record (an *anonymous progress profile*) is created only when you first save or tag
something.

**Purpose:** to keep your saved words and sounds attached to your browser.

### 3.2 Your learning activity (only once you use the learning features)

When you save, tag or remove a word or a sound, we record that action, which word or
sound it concerns, and when. From that history we keep your current state for each
word and sound (saved, learning, learned). A progress profile also records when it
was created and last used.

After you have a progress profile, we additionally record:

- **Listening.** Each time a word's or a sound's audio actually starts playing, we
  record which word or sound and when.
- **Word encounters.** When you open a word's page, we record the word — as our
  internal identifier for that dictionary entry — and when, **at most once per word
  per calendar day (UTC)**. This is the history that later lets PronounceAll bring words you looked
  up back for review.

What these records do **not** contain: the text you typed into search, searches that
found nothing, the page you came from (referrer), your IP address, or any other free
text. A person who only reads pages and has never saved anything has no learning
history at all — not even of the words they opened.

**Purpose:** to show your progress, to let you review what you have learned, and, in
later versions of PronounceAll, to bring words you looked up back for personalised
review. This history is not used for advertising, profiling for marketing, or
analytics.

### 3.3 Word requests

If you ask us to add a missing word, we store the word, the language variant and your
`pa_uid`, so repeated requests count once. The form asks for nothing else and is
protected by Cloudflare Turnstile (§6).

**Purpose:** to decide which words to add to the dictionary.

### 3.4 Operational logs

Like every website, our servers keep technical logs to run the service and keep it
secure:

- **Access logs** at our web server and at Cloudflare record your IP address, the
  requested address (including any search term in it), the time and technical request
  details.
- **Application logs** record the requested address and technical diagnostics, but not
  your IP address and not your cookies.

**[OWNER]** Search pages put the search term in the address (`/search?q=…`), so search
terms appear in these logs. They are not linked to your progress profile. See the
open item in the review notes.

**Purpose:** operating the site, diagnosing faults, and protecting it against abuse.

### 3.5 [ACCOUNTS] If you create an account

- **Username** (public), and for sign-in:
  - with email: your **email address** and a **password hash** (we never store your
    password); a new password is checked against known breaches by sending only the
    first five characters of its SHA-1 hash, never the password;
  - with Google: your **email address**, Google's **account identifier** and your
    **profile picture address**.
- Whether and when your email address was verified.
- A **session** held on our servers while you are signed in.
- **Consent records** where the service asks for a consent.
- When you sign in, the learning history of the `pa_uid` you used before joins your
  account.

**Purpose:** to provide the account and keep your progress across devices.

### 3.6 In your browser only

The site stores in your browser, not on our servers: the `pa_uid` mirror (§3.1) and
when you last dismissed the open-source banner. Your chosen playback speed is not
stored anywhere.

## 4. Legal bases

**[OWNER / legal review — proposed, not fixed by the specifications]**

| Processing | Proposed legal basis (GDPR) |
|---|---|
| `pa_uid` cookie, saved words and sounds, learning history, listening and word encounters | Art. 6(1)(b) — necessary to provide the learning service you are using |
| Word requests | Art. 6(1)(f) — legitimate interest in improving the dictionary |
| Operational and access logs, rate limiting, Turnstile | Art. 6(1)(f) — legitimate interest in operating and securing the service |
| [ACCOUNTS] Account data | Art. 6(1)(b) — necessary to provide the account |
| [ACCOUNTS] Deletion records without personal data | Art. 6(1)(c) — accountability |

The `pa_uid` cookie is strictly necessary for the service you are using, so it does
not require consent under the ePrivacy rules; the site shows a notice instead.

## 5. How long we keep it

| Data | Retention |
|---|---|
| Learning history of an anonymous identity not linked to an account | Deleted after 2 years without use (matching the cookie's maximum lifetime) |
| [ACCOUNTS] Learning history of an account, including history carried over from an anonymous identity | Until the account is deleted |
| [ACCOUNTS] Account data | Until the account is deleted |
| [ACCOUNTS] Sessions | 30 minutes idle, 12 hours at most |
| [ACCOUNTS] Email verification links | 24 hours |
| [ACCOUNTS] Password reset links | 1 hour |
| [ACCOUNTS] Soft-deleted accounts | 30 days, then permanently deleted |
| Access logs | 30 days |
| Application logs | 90 days at launch, reducing to 30 days |
| Backups | Daily for 30 days and weekly for 26 weeks, encrypted |
| Deletion records (no personal data) | Kept for audit |

Word requests remain after your data is deleted, with your identifier removed.

## 6. Who receives data

We do not sell data and do not share it for advertising. These providers process data
on our behalf, only as needed:

| Provider | What | Why |
|---|---|---|
| Hetzner (servers in the EU) | All data we store | Hosting |
| Cloudflare | IP address, request details, Turnstile check | Delivering the site, protection against attacks and bots |
| Backblaze B2 | Encrypted database backups | Recovery |
| [ACCOUNTS] Transactional email provider (Brevo, provisional) | Your email address and the link we send | Account emails |
| [ACCOUNTS] Google | Only when you choose "Continue with Google" | Sign-in |
| [ACCOUNTS] Have I Been Pwned | First five characters of a password hash | Breach check |
| **[OWNER]** Error-tracking service, if used | Error diagnostics with personal data removed | Fixing faults |

Our servers are in the European Union. **[OWNER / legal review: international
transfer wording, including for Cloudflare and any provider outside the EU.]**

## 7. Your rights

You can ask us to:

- **access** the data we hold about you, and receive a copy;
- **correct** it;
- **delete** it;
- **object** to processing based on legitimate interests;
- receive your data in a portable form, to the extent of what we store.

[ACCOUNTS] You can delete your account in Settings. A soft delete can be undone by
signing in within 30 days; a hard delete permanently removes your account and its
learning history within 24 hours.

Write to **[OWNER: contact email]**. We acknowledge a request within 3 business days
and answer within 30 days; if a request is complex we may extend this by up to 60
days and will tell you. We may ask for information to confirm the data concerns you.

You may also complain to a data protection supervisory authority. **[OWNER / legal
review: the competent authority, and whether an EU representative under GDPR Art. 27
is required.]**

## 8. Cookies

| Name | Category | Purpose | Duration | Scope |
|---|---|---|---|---|
| `pa_uid` | Strictly necessary | Anonymous progress identifier | 2 years, renewed on use | pronounceall.com |
| `pa_sid` [ACCOUNTS] | Strictly necessary | Signed-in session | 12 hours at most, 30 minutes idle | pronounceall.com |
| Cloudflare cookies | Strictly necessary | Security and bot protection at the edge | Per Cloudflare | pronounceall.com |

No other cookies are set. Protection against cross-site request forgery uses a token
sent with each request, not a cookie. No advertising cookie exists; if advertising is
ever offered it will be opt-in only and added here first.

## 9. Changes

We will update this page before any change to what we collect, and show the date of
the last change.

**Last updated:** [OWNER: date of publication]

---

## Review notes (not part of the published policy)

1. **Search terms in logs.** Request logging records the full address, so search terms
   reach application and access logs for every visitor, without a link to a progress
   profile. Choose: (a) publish §3.4 as written, or (b) strip query strings from
   application logs before launch — a small change — and keep them only in the 30-day
   access logs.
2. **[OWNER] facts:** controller identity and address, contact address, publication
   date.
3. **Legal review:** legal bases (§4), international transfers (§6), supervisory
   authority and GDPR Art. 27 representative (§7).
4. **Error tracker:** NFR-PRIV-06 leaves its residual-data determination to the
   Threat Model; no service is selected or deployed yet.
5. **Promises beyond the specifications:** none intended. The statements of §3.2
   restate FR-SAVE-03, FR-SAVE-09, FR-SAVE-10 and FR-AUTH-03; retention restates
   NFR-PRIV-02; request handling restates NFR-PRIV-04.
