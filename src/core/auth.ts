/**
 * The backend-for-frontend (RFC 10017 §6.1): signing in with the code flow
 * and PKCE, the encrypted cookie session, renewal, and signing out. Works on
 * a standard `Request` and answers with locations and `Set-Cookie` values, so
 * it is the same code under TanStack Start, in tests and anywhere else.
 */

import type { Logger, TokenResponse } from "@qeet-id/node";
import { AUTH_ERROR_PARAMETER, type Session, type SignInErrorCode, safeReturnTo } from "../contract.js";
import type { QeetIDConfig } from "./config.js";
import { clearChunked, deleteCookie, parseCookies, readChunked, serializeCookie, writeChunked } from "./cookies.js";
import { type SealPurpose, type SealingKey, deriveKeys, pkceChallenge, seal, timingSafeEqual, unseal } from "./crypto.js";
import { decodeJwtPayload, randomToken } from "./encoding.js";
import { ConfigurationError, NotSignedInError, SessionUnavailableError } from "./errors.js";
import { type IdTokenClaims, OidcClient, renewalFailure } from "./oidc.js";
import { type SignInTransaction, type StoredSession, asSignInTransaction, asStoredSession, toSession } from "./session.js";

/** How long a sign-in may take, from the sign-in route to the callback. */
const SIGN_IN_TTL_SECONDS = 10 * 60;
/** The access token is renewed when it has less than this left. */
export const RENEW_BEFORE_MS: number = 60 * 1000;
/** How long the organisation's name, roles and permissions are trusted before they are looked up again. */
export const DIRECTORY_TTL_MS: number = 5 * 60 * 1000;
/** A `state` this package made: 32 random bytes, base64url. */
const STATE_PATTERN = /^[A-Za-z0-9_-]{43}$/;

/** The session tokens, for server code that calls an API with them. Never send them to the browser. */
export interface SessionTokens {
  readonly accessToken: string;
  /** When the access token expires. */
  readonly accessTokenExpiresAt: Date;
  /** The ID token Qeet ID issued at sign-in or at the last renewal. */
  readonly idToken: string;
}

/** A request's session, and the cookies the response must set. */
export interface LoadedSession {
  /** The signed-in person, or `null`. */
  readonly session: Session | null;
  /** The tokens behind `session`; `null` when signed out. */
  readonly tokens: SessionTokens | null;
  /** `Set-Cookie` values: a renewed session, or the deletion of one that ended. */
  readonly cookies: readonly string[];
}

/** Where to send the browser, and the cookies to set on the way. */
export interface AuthRedirect {
  readonly location: string;
  readonly cookies: readonly string[];
}

/** Options for `QeetIDAuth`, for tests and unusual runtimes. */
export interface QeetIDAuthOptions {
  /** Replaces the global `fetch` for every call to Qeet ID. */
  fetch?: typeof fetch;
  /** The clock, in milliseconds since the epoch. */
  now?: () => number;
  /** Receives warnings (a failed revocation, a failed lookup); never credentials. Default: `console`. */
  logger?: Logger;
}

const SIGNED_OUT: LoadedSession = Object.freeze({ session: null, tokens: null, cookies: Object.freeze([]) });

/** A renewal whose new ID token failed verification: the grant is not trusted, and the session ends. */
class RenewalRejected extends Error {}

/** One application's sign-in and sessions. Create one per process: it caches keys, discovery and renewals. */
export class QeetIDAuth {
  readonly config: QeetIDConfig;
  readonly oidc: OidcClient;
  /** The session cookie's name: `__Host-qeet-id-session` over https. */
  readonly sessionCookie: string;
  readonly #signInCookiePrefix: string;
  readonly #now: () => number;
  readonly #logger: Logger;
  readonly #keys = new Map<SealPurpose, Promise<SealingKey[]>>();
  readonly #loaded = new WeakMap<Request, Promise<LoadedSession>>();

  constructor(config: QeetIDConfig, options: QeetIDAuthOptions = {}) {
    this.config = config;
    this.#now = options.now ?? Date.now;
    this.#logger = options.logger ?? { warn: (message, context) => console.warn(`[@qeet-id/tanstack] ${message}`, context ?? "") };
    this.oidc = new OidcClient(config, {
      ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
      now: this.#now,
      logger: this.#logger,
    });
    const prefix = config.secureCookies ? "__Host-" : "";
    this.sessionCookie = `${prefix}qeet-id-session`;
    this.#signInCookiePrefix = `${prefix}qeet-id-signin.`;
  }

  /**
   * Starts a sign-in: a fresh state, nonce and PKCE verifier, sealed into a
   * sign-in cookie of their own (so sign-ins in two tabs don't collide), and
   * the authorization URL to send the browser to.
   */
  async startSignIn(returnTo: unknown): Promise<AuthRedirect> {
    const target = safeReturnTo(returnTo, this.config.origin) ?? "/";
    const transaction: SignInTransaction = {
      v: 1,
      state: randomToken(32),
      nonce: randomToken(32),
      codeVerifier: randomToken(32),
      returnTo: target,
      expiresAt: this.#now() + SIGN_IN_TTL_SECONDS * 1000,
    };
    let location: string;
    try {
      location = await this.oidc.authorizationUrl({
        state: transaction.state,
        nonce: transaction.nonce,
        codeChallenge: await pkceChallenge(transaction.codeVerifier),
      });
    } catch (error) {
      this.#warn("Qeet ID's discovery document couldn't be read, so sign-in couldn't start.", error);
      return { location: this.#withAuthError(target, "temporarily_unavailable"), cookies: [] };
    }
    const sealed = await seal(transaction, await this.#currentKey("sign-in"));
    const cookie = serializeCookie(this.#signInCookie(transaction.state), sealed, {
      maxAge: SIGN_IN_TTL_SECONDS,
      secure: this.config.secureCookies,
    });
    return { location, cookies: [cookie] };
  }

  /**
   * Finishes a sign-in at the callback: checks `state` against this browser's
   * sign-in cookie and `iss` against the issuer (RFC 9207), redeems the code
   * with the PKCE verifier, verifies the ID token and its `nonce`, and stores
   * the session. Never throws: a failure sends the browser back to the
   * return path with `?authError=<code>`, storing nothing.
   */
  async finishSignIn(request: Request): Promise<AuthRedirect> {
    const params = new URL(request.url).searchParams;
    const cookies = parseCookies(request.headers.get("cookie"));
    const state = params.get("state") ?? "";
    const cookieName = STATE_PATTERN.test(state) ? this.#signInCookie(state) : undefined;
    const sealed = cookieName === undefined ? undefined : cookies.get(cookieName);
    const transaction = sealed === undefined ? undefined : asSignInTransaction(await unseal(sealed, await this.#allKeys("sign-in")));
    const clearSignIn = cookieName !== undefined && sealed !== undefined ? [deleteCookie(cookieName, this.config.secureCookies)] : [];

    if (!transaction || !timingSafeEqual(transaction.state, state)) {
      return { location: this.#withAuthError("/", "invalid_state"), cookies: clearSignIn };
    }
    const fail = (code: SignInErrorCode): AuthRedirect => ({
      location: this.#withAuthError(transaction.returnTo, code),
      cookies: clearSignIn,
    });
    if (transaction.expiresAt <= this.#now()) return fail("invalid_state");

    let tokens: TokenResponse;
    let claims: IdTokenClaims;
    try {
      // RFC 9207 §2.4: every answer, an error included, must come from the issuer this sign-in went to.
      if (params.get("iss") !== (await this.oidc.issuer())) return fail("invalid_state");
      const error = params.get("error");
      if (error !== null) return fail((/^[a-z_]{1,64}$/.test(error) ? error : "server_error") as SignInErrorCode);
      const code = params.get("code");
      if (code === null || code === "") return fail("invalid_state");
      tokens = await this.oidc.exchangeCode(code, transaction.codeVerifier);
      if (typeof tokens.id_token !== "string") throw new TypeError("Qeet ID issued no ID token: is openid among the scopes?");
      claims = await this.oidc.verifyIdToken(tokens.id_token);
    } catch (cause) {
      this.#warn("The sign-in couldn't be completed.", cause);
      return fail("session_unavailable");
    }
    if (typeof claims.nonce !== "string" || !timingSafeEqual(claims.nonce, transaction.nonce)) return fail("invalid_state");

    const now = this.#now();
    const stored = await this.#withDirectory(
      this.#withLifetime(
        {
          v: 1,
          idToken: tokens.id_token,
          accessToken: tokens.access_token,
          accessTokenExpiresAt: now + tokens.expires_in * 1000,
          refreshToken: tokens.refresh_token ?? null,
          organizationName: null,
          roles: [],
          permissions: [],
          directoryCheckedAt: null,
          expiresAt: 0,
        },
        now,
      ),
    );

    // A session this browser held before (another person, say) ends at Qeet ID too.
    const previous = await this.#readStored(cookies);
    if (previous?.refreshToken && previous.refreshToken !== stored.refreshToken) await this.#revoke(previous.refreshToken);

    return { location: transaction.returnTo, cookies: [...clearSignIn, ...(await this.#write(cookies, stored))] };
  }

  /**
   * The request's session, renewing the access token when it has less than a
   * minute left. Read once per request, however often it is asked for.
   *
   * @throws {SessionUnavailableError} when the access token has expired and Qeet ID can't be reached to renew it.
   */
  loadSession(request: Request): Promise<LoadedSession> {
    let loaded = this.#loaded.get(request);
    if (!loaded) {
      loaded = this.#load(request);
      this.#loaded.set(request, loaded);
    }
    return loaded;
  }

  /** Whether `request` is for one of the session routes, which set their own cookies. */
  isSessionRoute(request: Request): boolean {
    const { pathname } = new URL(request.url);
    return pathname === this.config.basePath || pathname.startsWith(`${this.config.basePath}/`);
  }

  /**
   * Signs out: forgets the session, revokes its refresh token at Qeet ID and
   * returns where the browser goes next, Qeet ID's sign-out page with the ID
   * token as the hint, so the hosted-login session ends too, and then
   * `returnTo` on this site (which must be registered with Qeet ID as a
   * post-logout redirect URI) or `QEET_ID_POST_SIGN_OUT_REDIRECT_URI`.
   * Without a session it returns `returnTo` itself, or `/`.
   */
  async signOut(request: Request, returnTo: unknown): Promise<{ redirectTo: string; cookies: readonly string[] }> {
    const cookies = parseCookies(request.headers.get("cookie"));
    const target = safeReturnTo(returnTo, this.config.origin);
    const stored = await this.#readStored(cookies);
    const cleared =
      readChunked(cookies, this.sessionCookie) === undefined ? [] : clearChunked(cookies, this.sessionCookie, this.config.secureCookies);
    if (!stored) return { redirectTo: target ?? "/", cookies: cleared };

    if (stored.refreshToken) await this.#revoke(stored.refreshToken);
    const postLogout = target === undefined ? this.config.postSignOutRedirectUri : `${this.config.origin}${target}`;
    let endSession: string | undefined;
    try {
      endSession = await this.oidc.endSessionUrl(stored.idToken, postLogout);
    } catch (error) {
      this.#warn("Qeet ID's discovery document couldn't be read, so only this app's session ended.", error);
    }
    return { redirectTo: endSession ?? target ?? "/", cookies: cleared };
  }

  /**
   * Whether the signed-in person holds `permission` in their organisation,
   * asked of Qeet ID now (`GET /v1/check`, roles and attribute policies
   * together). Needs `QEET_ID_API_KEY`.
   *
   * @throws {NotSignedInError} when nobody is signed in.
   */
  async checkPermission(request: Request, permission: string): Promise<boolean> {
    if (this.config.apiKey === undefined) {
      throw new ConfigurationError([
        "QEET_ID_API_KEY is required to check permissions: a server-side API key with permission to read roles.",
      ]);
    }
    const { session } = await this.loadSession(request);
    if (!session) throw new NotSignedInError();
    if (!session.organization) return false;
    return this.oidc.api.permissions.check({ user_id: session.user.id, tenant_id: session.organization.id, permission });
  }

  async #load(request: Request): Promise<LoadedSession> {
    const cookies = parseCookies(request.headers.get("cookie"));
    if (readChunked(cookies, this.sessionCookie) === undefined) return SIGNED_OUT;
    const ended: LoadedSession = {
      session: null,
      tokens: null,
      cookies: clearChunked(cookies, this.sessionCookie, this.config.secureCookies),
    };
    const stored = await this.#readStored(cookies);
    const now = this.#now();
    if (!stored || stored.expiresAt <= now) return ended;

    let current = stored;
    if (current.accessTokenExpiresAt - now <= RENEW_BEFORE_MS) {
      if (current.refreshToken === null) {
        if (current.accessTokenExpiresAt <= now) return ended;
      } else {
        try {
          current = await this.#renewed(current, await this.oidc.renew(current.refreshToken));
        } catch (error) {
          if (error instanceof RenewalRejected || renewalFailure(error) === "ended") return ended;
          if (current.accessTokenExpiresAt <= now) throw new SessionUnavailableError({ cause: error });
          // The access token still works: keep the session, and renew on a later request.
          this.#warn("The session couldn't be renewed yet; it will be tried again.", error);
        }
      }
    }
    if (this.config.apiKey !== undefined && (current.directoryCheckedAt === null || now - current.directoryCheckedAt >= DIRECTORY_TTL_MS)) {
      current = await this.#withDirectory(current);
    }
    return {
      session: toSession(current),
      tokens: { accessToken: current.accessToken, accessTokenExpiresAt: new Date(current.accessTokenExpiresAt), idToken: current.idToken },
      cookies: current === stored ? [] : await this.#write(cookies, current),
    };
  }

  /**
   * The session after a renewal. The new ID token must name the same person
   * (OpenID Connect Core §12.2); if its signature can't be checked because
   * Qeet ID's keys are unreachable, the previous one is kept.
   */
  async #renewed(current: StoredSession, tokens: TokenResponse): Promise<StoredSession> {
    let idToken = current.idToken;
    if (typeof tokens.id_token === "string") {
      try {
        const claims = await this.oidc.verifyIdToken(tokens.id_token);
        if (claims.sub !== decodeJwtPayload(current.idToken)?.sub) throw new TypeError("The renewed ID token names another person.");
        idToken = tokens.id_token;
      } catch (error) {
        if (!(error instanceof Error && "code" in error && error.code === "jwks_unavailable")) {
          // The grant can't be trusted: end it rather than keep a session for the wrong person.
          if (tokens.refresh_token) await this.#revoke(tokens.refresh_token);
          throw new RenewalRejected("The renewed ID token failed verification.", { cause: error });
        }
      }
    }
    const now = this.#now();
    return this.#withLifetime(
      {
        ...current,
        idToken,
        accessToken: tokens.access_token,
        accessTokenExpiresAt: now + tokens.expires_in * 1000,
        // Qeet ID rotates refresh tokens: the old one is spent, so never keep it.
        refreshToken: tokens.refresh_token ?? null,
      },
      now,
    );
  }

  /**
   * The session's end, from `now`: the configured lifetime, rolling forward at
   * every renewal; without a refresh token, no later than the access token.
   */
  #withLifetime(stored: StoredSession, now: number): StoredSession {
    const lifetime = now + this.config.sessionMaxAgeSeconds * 1000;
    return { ...stored, expiresAt: stored.refreshToken === null ? Math.min(lifetime, stored.accessTokenExpiresAt) : lifetime };
  }

  /**
   * Looks up the organisation's name and the person's roles and permissions
   * with the API key, when there is one. A failed lookup keeps what the
   * session had and is tried again after `DIRECTORY_TTL_MS`.
   */
  async #withDirectory(stored: StoredSession): Promise<StoredSession> {
    if (this.config.apiKey === undefined) return stored;
    const checked = { ...stored, directoryCheckedAt: this.#now() };
    const claims = decodeJwtPayload(stored.idToken);
    const tenantId = claims?.tenant_id;
    const userId = claims?.sub;
    if (typeof tenantId !== "string" || typeof userId !== "string") return checked;
    try {
      const [organization, access] = await Promise.all([
        this.oidc.api.tenants.get(tenantId),
        this.oidc.api.permissions.listEffective(tenantId, userId),
      ]);
      const roles = access.grants.map((grant) => grant.role_name).filter((name): name is string => typeof name === "string" && name !== "");
      return {
        ...checked,
        organizationName: typeof organization.name === "string" && organization.name !== "" ? organization.name : null,
        roles: [...new Set(roles)].sort(),
        permissions: [...new Set(access.permissions)].sort(),
      };
    } catch (error) {
      this.#warn("The organisation's name, roles and permissions couldn't be looked up.", error);
      return checked;
    }
  }

  async #readStored(cookies: ReadonlyMap<string, string>): Promise<StoredSession | undefined> {
    const sealed = readChunked(cookies, this.sessionCookie);
    return sealed === undefined ? undefined : asStoredSession(await unseal(sealed, await this.#allKeys("session")));
  }

  async #write(cookies: ReadonlyMap<string, string>, stored: StoredSession): Promise<string[]> {
    const sealed = await seal(stored, await this.#currentKey("session"));
    return writeChunked(cookies, this.sessionCookie, sealed, {
      maxAge: Math.ceil((stored.expiresAt - this.#now()) / 1000),
      secure: this.config.secureCookies,
    });
  }

  async #revoke(refreshToken: string): Promise<void> {
    try {
      await this.oidc.revoke(refreshToken);
    } catch (error) {
      this.#warn("A refresh token couldn't be revoked; it stays valid at Qeet ID until it expires.", error);
    }
  }

  #signInCookie(state: string): string {
    return `${this.#signInCookiePrefix}${state}`;
  }

  #allKeys(purpose: SealPurpose): Promise<SealingKey[]> {
    let keys = this.#keys.get(purpose);
    if (!keys) {
      keys = deriveKeys(this.config.cookieSecrets, purpose);
      this.#keys.set(purpose, keys);
    }
    return keys;
  }

  async #currentKey(purpose: SealPurpose): Promise<SealingKey> {
    const [current] = await this.#allKeys(purpose);
    if (!current) throw new ConfigurationError(["QEET_ID_COOKIE_SECRET is required."]);
    return current;
  }

  /** `path` (already checked as same-origin) with `?authError=<code>` added. */
  #withAuthError(path: string, code: SignInErrorCode): string {
    const url = new URL(path, this.config.origin);
    url.searchParams.set(AUTH_ERROR_PARAMETER, code);
    return `${url.pathname}${url.search}${url.hash}`;
  }

  #warn(message: string, error: unknown): void {
    const code = typeof error === "object" && error !== null && "code" in error ? String(error.code) : undefined;
    const name = error instanceof Error ? error.name : typeof error;
    this.#logger.warn?.(message, code === undefined ? { error: name } : { error: name, code });
  }
}
