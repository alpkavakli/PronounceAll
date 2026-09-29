/* PronounceAll — Copyright (C) 2026 Alp Kavaklı
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * See LICENSE-NOTICE.md at the repository root. */

/**
 * Reserved usernames (FR-AUTH-05, SRS Appendix A). The single source-controlled
 * list: adding a route to the application implies adding its path segment here.
 * Matching is case-insensitive. Any language-variant code (`xx-yy`) is reserved
 * by pattern in the username policy, so future variants need no entry.
 *
 * Profanity is checked separately, by the external blocklist behind the
 * username policy (V8).
 */

export const RESERVED_USERNAMES = Object.freeze([
  // Administrative / role-like
  'admin', 'administrator', 'root', 'superuser', 'sysadmin', 'sysop', 'staff', 'team', 'owner',
  'maintainer', 'moderator', 'mod', 'support', 'help', 'billing', 'official', 'webmaster', 'postmaster',
  // Technical / route-collision risks
  'api', 'app', 'www', 'mail', 'email', 'ftp', 'ssh', 'static', 'assets', 'cdn', 'media', 'img', 'images',
  'audio', 'video', 'files', 'download', 'upload',
  // PronounceAll routes and concepts
  'settings', 'account', 'profile', 'login', 'logout', 'register', 'signup', 'signin', 'reset-password',
  'verify-email', 'privacy', 'kvkk', 'about', 'contact', 'terms', 'legal', 'cookies', 'learnipa', 'practice',
  'search', 'word', 'words', 'phoneme', 'phonemes', 'ipa', 'save', 'listen', 'encounter', 'request-word',
  'viewer-state', 'health',
  // Abuse / impersonation deterrents
  'pronounceall', 'anthropic', 'claude', 'google', 'cloudflare', 'system', 'null', 'undefined', 'anonymous',
  'deleted', 'user',
]);
