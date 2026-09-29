/* PronounceAll — Copyright (C) 2026 Alp Kavaklı
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * See LICENSE-NOTICE.md at the repository root. */

/**
 * Google sign-in over OpenID Connect, Authorization Code flow with PKCE
 * (FR-AUTH-04a, FR-AUTH-16; SDD v1.1 §5.6).
 *
 * The provider boundary: the only module that talks to Google. It builds the
 * authorization URL and exchanges a code for the ID token, over TLS, directly
 * with Google's token endpoint using the confidential client secret. Nothing
 * else of the token response is kept — the access token is discarded, and no
 * refresh token is requested (sign-in needs no later Google API access).
 *
 * The ID token's claims are validated by the sign-in service. Because the token
 * arrives in the direct, TLS-authenticated response from the token endpoint,
 * OpenID Connect Core §3.1.3.7 (6) lets TLS server validation stand in for the
 * signature check; the issuer, audience, expiry and nonce are still checked.
 *
 * Nothing here logs: not the code, the tokens, the secret or the state.
 */

const AUTHORIZATION_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';

/** FR-AUTH-16: these three, and nothing more. */
export const GOOGLE_SCOPES = Object.freeze(['openid', 'email', 'profile']);

/**
 * @typedef {object} GoogleOidcClient
 * @property {string} clientId the audience an ID token must carry
 * @property {(request: { state: string, nonce: string, codeChallenge: string }) => string} authorizationUrl
 * @property {(request: { code: string, codeVerifier: string }) => Promise<{ idToken: string }>} exchangeCode
 */

/**
 * @param {object} options
 * @param {string} options.clientId
 * @param {string} options.clientSecret
 * @param {string} options.redirectUri must match the URI registered with Google
 * @param {typeof fetch} [options.fetchImpl]
 * @param {number} [options.timeoutMs]
 * @returns {GoogleOidcClient}
 */
export function createGoogleOidcClient({ clientId, clientSecret, redirectUri, fetchImpl = fetch, timeoutMs = 10_000 }) {
  return {
    clientId,

    authorizationUrl({ state, nonce, codeChallenge }) {
      const url = new URL(AUTHORIZATION_ENDPOINT);
      url.search = new URLSearchParams({
        client_id: clientId,
        redirect_uri: redirectUri,
        response_type: 'code',
        scope: GOOGLE_SCOPES.join(' '),
        state,
        nonce,
        code_challenge: codeChallenge,
        code_challenge_method: 'S256',
        prompt: 'select_account',
      }).toString();
      return url.href;
    },

    async exchangeCode({ code, codeVerifier }) {
      const response = await fetchImpl(TOKEN_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          code,
          code_verifier: codeVerifier,
          client_id: clientId,
          client_secret: clientSecret,
          redirect_uri: redirectUri,
        }).toString(),
        signal: AbortSignal.timeout(timeoutMs),
      });
      // The body is not read on failure: it can echo request details.
      if (!response.ok) throw new Error(`Google token endpoint answered ${response.status}`);
      const body = await response.json();
      if (typeof body.id_token !== 'string') throw new Error('Google token response carried no ID token');
      return { idToken: body.id_token };
    },
  };
}
