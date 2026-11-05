/**
 * The OpenID Connect relying party: discovery, the authorization request, the
 * code exchange, ID token verification, renewal, revocation and sign-out,
 * against Qeet ID through `@qeet-id/node`.
 */

import { type DiscoveryDocument, type Logger, OAuthError, QeetID, type TokenResponse, TokenVerifier, discover } from "@qeet-id/node";
import type { QeetIDConfig } from "./config.js";
import { VERSION } from "./version.js";

/** How long the discovery document is used before it is fetched again. */
const DISCOVERY_TTL_MS = 60 * 60 * 1000;
/**
 * How long a renewal's answer is reused for requests that still carry the
 * refresh token it spent: those sent before the browser had the new cookie.
 * Qeet ID treats a spent refresh token presented again as theft and ends
 * the whole grant, so the answer must be shared, never asked for twice.
 */
export const REFRESH_REUSE_MS: number = 60 * 1000;
/** Each call to Qeet ID made while a person waits gets at most this long. */
const REQUEST_TIMEOUT_MS = 10_000;

/** The ID token claims the session is built from, as Qeet ID issues them. */
export interface IdTokenClaims {
  iss: string;
  sub: string;
  aud: string | string[];
  exp: number;
  iat?: number;
  nonce?: string;
  /** The organisation (Qeet ID tenant) the sign-in is for: always the application's own. */
  tenant_id?: string;
  /** The hosted-login session. */
  sid?: string;
  auth_time?: number;
  /** With the `email` scope. */
  email?: string;
  email_verified?: boolean;
  /** With the `profile` scope, when the person has one. */
  name?: string;
  picture?: string;
  [claim: string]: unknown;
}

/** Why a renewal failed: the grant has `ended` (sign in again), or Qeet ID is `unavailable` (try later). */
export type RenewalFailure = "ended" | "unavailable";

/** Options for `OidcClient`, for tests and unusual runtimes. */
export interface OidcClientOptions {
  /** Replaces the global `fetch` for every call to Qeet ID. */
  fetch?: typeof fetch;
  /** Receives diagnostics from `@qeet-id/node`; never credentials. */
  logger?: Logger;
  /** The clock, in milliseconds. */
  now?: () => number;
}

/** The relying party for one application. Create one per process. */
export class OidcClient {
  /** The management API client, holding the API key when one is configured. */
  readonly api: QeetID;
  readonly #config: QeetIDConfig;
  readonly #fetch: typeof fetch | undefined;
  readonly #now: () => number;
  #metadata: { document: DiscoveryDocument; fetchedAt: number } | undefined;
  #loading: Promise<DiscoveryDocument> | undefined;
  #verifier: TokenVerifier | undefined;
  readonly #renewals = new Map<string, { result: Promise<TokenResponse>; startedAt: number }>();

  constructor(config: QeetIDConfig, options: OidcClientOptions = {}) {
    this.#config = config;
    this.#fetch = options.fetch;
    this.#now = options.now ?? Date.now;
    this.api = new QeetID({
      baseUrl: config.baseUrl,
      timeoutMs: REQUEST_TIMEOUT_MS,
      appInfo: { name: "qeet-id-tanstack", version: VERSION },
      ...(config.apiKey === undefined ? {} : { apiKey: config.apiKey }),
      ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
      ...(options.logger === undefined ? {} : { logger: options.logger }),
    });
  }

  /** Qeet ID's discovery document, fetched once an hour; concurrent callers share one fetch. */
  async metadata(): Promise<DiscoveryDocument> {
    if (this.#metadata && this.#now() - this.#metadata.fetchedAt < DISCOVERY_TTL_MS) return this.#metadata.document;
    this.#loading ??= discover({
      baseUrl: this.#config.baseUrl,
      timeoutMs: REQUEST_TIMEOUT_MS,
      ...(this.#fetch === undefined ? {} : { fetch: this.#fetch }),
    })
      .then((document) => {
        if (typeof document.authorization_endpoint !== "string" || typeof document.jwks_uri !== "string") {
          throw new TypeError("Qeet ID's discovery document has no authorization endpoint or JWKS.");
        }
        if (this.#metadata?.document.issuer !== document.issuer || this.#metadata?.document.jwks_uri !== document.jwks_uri) {
          this.#verifier = undefined;
        }
        this.#metadata = { document, fetchedAt: this.#now() };
        return document;
      })
      .finally(() => {
        this.#loading = undefined;
      });
    return this.#loading;
  }

  /** The issuer Qeet ID names itself by, in tokens and in the callback's `iss` (RFC 9207). */
  async issuer(): Promise<string> {
    return (await this.metadata()).issuer;
  }

  /**
   * The authorization request (OpenID Connect Core §3.1.2.1): the code flow
   * with PKCE S256 (RFC 7636), a `state` and a `nonce`.
   */
  async authorizationUrl(request: { state: string; nonce: string; codeChallenge: string }): Promise<string> {
    const url = new URL((await this.metadata()).authorization_endpoint);
    url.search = new URLSearchParams({
      response_type: "code",
      client_id: this.#config.clientId,
      redirect_uri: this.#config.redirectUri,
      scope: this.#config.scopes.join(" "),
      state: request.state,
      nonce: request.nonce,
      code_challenge: request.codeChallenge,
      code_challenge_method: "S256",
    }).toString();
    return url.toString();
  }

  /** Redeems an authorization code with its PKCE verifier. A code redeems once, so this is never retried. */
  async exchangeCode(code: string, codeVerifier: string): Promise<TokenResponse> {
    return this.api.oauth.authorizationCodeGrant({
      client_id: this.#config.clientId,
      client_secret: this.#config.clientSecret,
      code,
      code_verifier: codeVerifier,
      redirect_uri: this.#config.redirectUri,
    });
  }

  /**
   * Verifies an ID token: its ES256 signature against Qeet ID's keys, `iss`,
   * `aud` (this application), `exp`, `iat` and `sub` (OpenID Connect Core
   * §3.1.3.7). The caller checks `nonce` at sign-in and `sub` at renewal.
   */
  async verifyIdToken(idToken: string): Promise<IdTokenClaims> {
    const metadata = await this.metadata();
    this.#verifier ??= new TokenVerifier({
      issuer: metadata.issuer,
      audience: this.#config.clientId,
      jwksUrl: metadata.jwks_uri,
      ...(this.#fetch === undefined ? {} : { fetch: this.#fetch }),
    });
    const claims = (await this.#verifier.verify(idToken)) as unknown as IdTokenClaims;
    // With several audiences, the token must have been issued to this application (azp).
    if (Array.isArray(claims.aud) && claims.aud.length > 1 && claims.azp !== this.#config.clientId) {
      throw new TypeError("The ID token was issued to another application.");
    }
    return claims;
  }

  /**
   * Renews tokens with a refresh token. Calls made with the same refresh token
   * within `REFRESH_REUSE_MS` share one request and its answer: Qeet ID
   * rotates refresh tokens and ends the grant when a spent one comes back.
   */
  renew(refreshToken: string): Promise<TokenResponse> {
    const now = this.#now();
    for (const [token, entry] of this.#renewals) {
      if (now - entry.startedAt >= REFRESH_REUSE_MS) this.#renewals.delete(token);
    }
    const pending = this.#renewals.get(refreshToken);
    if (pending) return pending.result;
    const result = this.api.oauth.refreshTokenGrant({
      client_id: this.#config.clientId,
      client_secret: this.#config.clientSecret,
      refresh_token: refreshToken,
    });
    this.#renewals.set(refreshToken, { result, startedAt: now });
    // A failure isn't kept: the next request may try again.
    result.catch(() => this.#renewals.delete(refreshToken));
    return result;
  }

  /**
   * Revokes a refresh token, which ends its whole grant at Qeet ID (RFC 7009).
   * Access tokens can't be revoked there; they last out their few minutes.
   */
  async revoke(refreshToken: string): Promise<void> {
    await this.api.oauth.revoke(
      refreshToken,
      { client_id: this.#config.clientId, client_secret: this.#config.clientSecret },
      { token_type_hint: "refresh_token" },
    );
  }

  /**
   * The RP-initiated sign-out URL (OpenID Connect RP-Initiated Logout 1.0 §2),
   * which ends the person's hosted-login session at Qeet ID and comes back to
   * `postLogoutRedirectUri` when Qeet ID has it registered. `undefined` when
   * Qeet ID advertises no `end_session_endpoint`.
   */
  async endSessionUrl(idToken: string, postLogoutRedirectUri: string): Promise<string | undefined> {
    const endpoint = (await this.metadata()).end_session_endpoint;
    if (typeof endpoint !== "string") return undefined;
    const url = new URL(endpoint);
    url.search = new URLSearchParams({
      id_token_hint: idToken,
      client_id: this.#config.clientId,
      post_logout_redirect_uri: postLogoutRedirectUri,
    }).toString();
    return url.toString();
  }
}

/**
 * Whether a failed renewal means the grant has ended (`invalid_grant`: the
 * refresh token was revoked, expired or spent, or the person was suspended or
 * left the organisation; `unauthorized_client`: the application may no
 * longer renew) or only that Qeet ID couldn't answer now.
 */
export function renewalFailure(error: unknown): RenewalFailure {
  return error instanceof OAuthError && (error.code === "invalid_grant" || error.code === "unauthorized_client") ? "ended" : "unavailable";
}
