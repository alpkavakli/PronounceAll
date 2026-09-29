/* PronounceAll — Copyright (C) 2026 Alp Kavaklı
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * See LICENSE-NOTICE.md at the repository root. */

/**
 * The Google provider boundary and ID-token validation (FR-AUTH-04a,
 * FR-AUTH-16; OIDC Core §3.1.3.7). No request here reaches Google.
 */

import { describe, expect, test } from '@jest/globals';

import { createGoogleOidcClient, GOOGLE_SCOPES } from '../../src/lib/google-oidc.js';
import { validateGoogleIdToken } from '../../src/services/google-sign-in.service.js';

const CLIENT_ID = 'test-client.apps.googleusercontent.com';
const NOW = 1_800_000_000;

const b64 = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
const token = (claims) => `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64(claims)}.c2lnbmF0dXJl`;
const good = (overrides = {}) => ({
  iss: 'https://accounts.google.com',
  aud: CLIENT_ID,
  sub: '109876543210',
  email: 'person@example.test',
  email_verified: true,
  nonce: 'the-nonce',
  iat: NOW - 10,
  exp: NOW + 3600,
  picture: 'https://lh3.googleusercontent.com/a/photo',
  ...overrides,
});
const check = (claims) => validateGoogleIdToken(token(claims), { clientId: CLIENT_ID, nonce: 'the-nonce', nowSeconds: NOW });

describe('ID token validation', () => {
  test('a valid token yields sub, email and picture', () => {
    expect(check(good())).toEqual({
      ok: true,
      claims: { sub: '109876543210', email: 'person@example.test', picture: 'https://lh3.googleusercontent.com/a/photo' },
    });
    expect(check(good({ iss: 'accounts.google.com' })).ok).toBe(true);
  });

  test.each([
    ['a foreign issuer', { iss: 'https://evil.example' }, 'issuer'],
    ['another audience', { aud: 'someone-else' }, 'audience'],
    ['several audiences without azp', { aud: [CLIENT_ID, 'other'] }, 'audience'],
    ['an expired token', { exp: NOW - 1 }, 'expired'],
    ['no expiry', { exp: undefined }, 'expired'],
    ['issued in the future', { iat: NOW + 3600 }, 'issued-at'],
    ['a different nonce', { nonce: 'replayed-nonce' }, 'nonce'],
    ['no nonce', { nonce: undefined }, 'nonce'],
    ['no subject', { sub: '' }, 'subject'],
    ['no email', { email: undefined }, 'email'],
    ['an unverified email', { email_verified: false }, 'email-unverified'],
    ['email_verified as a string', { email_verified: 'true' }, 'email-unverified'],
  ])('%s is refused', (_label, overrides, reason) => {
    expect(check(good(overrides))).toEqual({ ok: false, reason });
  });

  test('several audiences are accepted only when azp names this client', () => {
    expect(check(good({ aud: [CLIENT_ID, 'other'], azp: CLIENT_ID })).ok).toBe(true);
  });

  test.each(['', 'not-a-jwt', 'a.b', 'a.!!!.c', `x.${Buffer.from('null').toString('base64url')}.y`])(
    'malformed token %p is refused',
    (raw) => {
      expect(validateGoogleIdToken(raw, { clientId: CLIENT_ID, nonce: 'the-nonce', nowSeconds: NOW }).ok).toBe(false);
    },
  );

  test('a non-https picture is dropped, not stored', () => {
    expect(check(good({ picture: 'javascript:alert(1)' })).claims.picture).toBeNull();
  });
});

describe('the provider adapter', () => {
  const client = (fetchImpl) =>
    createGoogleOidcClient({
      clientId: CLIENT_ID,
      clientSecret: 'the-client-secret',
      redirectUri: 'http://localhost:3000/auth/google/callback',
      fetchImpl,
    });

  test('asks for openid, email and profile only, with state, nonce and PKCE S256 (FR-AUTH-16)', () => {
    const url = new URL(client().authorizationUrl({ state: 'S', nonce: 'N', codeChallenge: 'C' }));
    expect(GOOGLE_SCOPES).toEqual(['openid', 'email', 'profile']);
    expect(url.origin).toBe('https://accounts.google.com');
    expect(url.searchParams.get('scope')).toBe('openid email profile');
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('state')).toBe('S');
    expect(url.searchParams.get('nonce')).toBe('N');
    expect(url.searchParams.get('code_challenge')).toBe('C');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('redirect_uri')).toBe('http://localhost:3000/auth/google/callback');
    // No offline access: no refresh token is ever requested.
    expect(url.searchParams.has('access_type')).toBe(false);
    // The secret never goes to the browser.
    expect(url.href).not.toContain('the-client-secret');
  });

  test('the code exchange sends the verifier and the secret to the token endpoint, and keeps only the ID token', async () => {
    const calls = [];
    const fetchImpl = async (url, init) => {
      calls.push({ url, body: new URLSearchParams(init.body) });
      return { ok: true, json: async () => ({ id_token: 'the.id.token', access_token: 'discarded', expires_in: 3599 }) };
    };
    const result = await client(fetchImpl).exchangeCode({ code: 'the-code', codeVerifier: 'the-verifier' });

    expect(result).toEqual({ idToken: 'the.id.token' });
    expect(calls[0].url).toBe('https://oauth2.googleapis.com/token');
    expect(Object.fromEntries(calls[0].body)).toMatchObject({
      grant_type: 'authorization_code',
      code: 'the-code',
      code_verifier: 'the-verifier',
      client_secret: 'the-client-secret',
    });
  });

  test('a failed exchange throws without carrying the response body or the secret', async () => {
    const fetchImpl = async () => ({ ok: false, status: 400, json: async () => ({ error: 'invalid_grant' }) });
    const error = await client(fetchImpl).exchangeCode({ code: 'c', codeVerifier: 'v' }).catch((caught) => caught);
    expect(error.message).toBe('Google token endpoint answered 400');
    expect(error.message).not.toContain('the-client-secret');
  });
});
