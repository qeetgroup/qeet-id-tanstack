/**
 * What the cookies hold, and how the stored session becomes the contract's
 * `Session`. The tokens never leave the server: they are sealed into the
 * cookie (see crypto.ts), and `toSession` carries none of them.
 */

import { type Session, parseSession } from "../contract.js";
import { decodeJwtPayload } from "./encoding.js";

/** The session cookie's contents. Times are milliseconds since the epoch. */
export interface StoredSession {
  readonly v: 1;
  /** The ID token, verified before it was stored: the person's claims, and the hint for signing out. */
  readonly idToken: string;
  readonly accessToken: string;
  readonly accessTokenExpiresAt: number;
  /** `null` when the application isn't registered for the refresh_token grant. */
  readonly refreshToken: string | null;
  /** From the management API, with an API key; `null` when not looked up. */
  readonly organizationName: string | null;
  readonly roles: readonly string[];
  readonly permissions: readonly string[];
  /** When the organisation's name, roles and permissions were last looked up; `null` for never. */
  readonly directoryCheckedAt: number | null;
  /** When the session ends unless renewed: the cookie's own expiry, checked on every read. */
  readonly expiresAt: number;
}

/** The sign-in cookie's contents, from the sign-in route to the callback. */
export interface SignInTransaction {
  readonly v: 1;
  readonly state: string;
  readonly nonce: string;
  readonly codeVerifier: string;
  /** The checked same-origin path to come back to. */
  readonly returnTo: string;
  readonly expiresAt: number;
}

/** `value` as a `StoredSession`, or `undefined` when it isn't one (an older format, say). */
export function asStoredSession(value: unknown): StoredSession | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const v = value as Record<string, unknown>;
  const ok =
    v.v === 1 &&
    isText(v.idToken) &&
    isText(v.accessToken) &&
    isTime(v.accessTokenExpiresAt) &&
    (v.refreshToken === null || isText(v.refreshToken)) &&
    (v.organizationName === null || typeof v.organizationName === "string") &&
    isTexts(v.roles) &&
    isTexts(v.permissions) &&
    (v.directoryCheckedAt === null || isTime(v.directoryCheckedAt)) &&
    isTime(v.expiresAt);
  return ok ? (v as unknown as StoredSession) : undefined;
}

/** `value` as a `SignInTransaction`, or `undefined`. */
export function asSignInTransaction(value: unknown): SignInTransaction | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const v = value as Record<string, unknown>;
  const ok = v.v === 1 && isText(v.state) && isText(v.nonce) && isText(v.codeVerifier) && isText(v.returnTo) && isTime(v.expiresAt);
  return ok ? (v as unknown as SignInTransaction) : undefined;
}

/**
 * The contract's `Session` for a stored session: the person from the ID
 * token's claims, the organisation from `tenant_id`, and what the management
 * API added. `parseSession` checks the result against the contract.
 */
export function toSession(stored: StoredSession): Session {
  const claims = decodeJwtPayload(stored.idToken) ?? {};
  const email = typeof claims.email === "string" && claims.email !== "" ? claims.email : null;
  const tenantId = typeof claims.tenant_id === "string" && claims.tenant_id !== "" ? claims.tenant_id : null;
  return parseSession({
    user: {
      id: claims.sub,
      email,
      emailVerified: email !== null && claims.email_verified === true,
      name: typeof claims.name === "string" ? claims.name : null,
      picture: typeof claims.picture === "string" ? claims.picture : null,
    },
    organization: tenantId === null ? null : { id: tenantId, name: stored.organizationName },
    roles: [...stored.roles],
    permissions: [...stored.permissions],
    expiresAt: new Date(stored.expiresAt).toISOString(),
  });
}

function isText(value: unknown): value is string {
  return typeof value === "string" && value !== "";
}

function isTime(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isTexts(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}
