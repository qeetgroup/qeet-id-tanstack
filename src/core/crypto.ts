/**
 * Cookie sealing: JSON encrypted and authenticated as a JWE (RFC 7516) in
 * compact serialization, with direct encryption (`alg: "dir"`) and AES-256-GCM
 * (`enc: "A256GCM"`, RFC 7518 §5.3), by Web Crypto alone.
 *
 * Each secret yields one key per purpose through HKDF-SHA-256 (RFC 5869), so
 * a sign-in cookie can never be read as a session cookie. The first secret
 * seals; every secret unseals, so secrets rotate by putting the new one first
 * and dropping the old one once the cookies it sealed have expired. A sealed
 * value names its key in the protected header (`kid`), a hash of the key, not
 * the key or the secret.
 */

import { decodeBase64Url, encodeBase64Url, fromUtf8, utf8 } from "./encoding.js";

/** What a cookie is for. Each purpose has its own keys. */
export type SealPurpose = "session" | "sign-in";

/** One derived key: AES-256-GCM, and the id the protected header names it by. */
export interface SealingKey {
  readonly kid: string;
  readonly key: CryptoKey;
}

const HKDF_SALT = "@qeet-id/tanstack";
const IV_BYTES = 12;
const TAG_BYTES = 16;
/** Longer sealed values aren't looked at: no cookie this package writes comes close. */
const MAX_SEALED_LENGTH = 64 * 1024;

/** Derives the sealing keys for `purpose`, one per secret, in the secrets' order. */
export async function deriveKeys(secrets: readonly string[], purpose: SealPurpose): Promise<SealingKey[]> {
  return Promise.all(
    secrets.map(async (secret) => {
      const material = await crypto.subtle.importKey("raw", utf8(secret), "HKDF", false, ["deriveBits"]);
      const bits = await crypto.subtle.deriveBits(
        { name: "HKDF", hash: "SHA-256", salt: utf8(HKDF_SALT), info: utf8(`cookie:${purpose}`) },
        material,
        256,
      );
      const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bits));
      const key = await crypto.subtle.importKey("raw", bits, "AES-GCM", false, ["encrypt", "decrypt"]);
      return { kid: encodeBase64Url(digest.subarray(0, 12)), key };
    }),
  );
}

/** Seals `value` (JSON) with `key`: a JWE in compact serialization. */
export async function seal(value: unknown, key: SealingKey): Promise<string> {
  const header = encodeBase64Url(utf8(JSON.stringify({ alg: "dir", enc: "A256GCM", kid: key.kid })));
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const sealed = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv, additionalData: utf8(header), tagLength: TAG_BYTES * 8 },
      key.key,
      utf8(JSON.stringify(value)),
    ),
  );
  const ciphertext = sealed.subarray(0, sealed.length - TAG_BYTES);
  const tag = sealed.subarray(sealed.length - TAG_BYTES);
  // No encrypted key: with "dir" the key is shared, so the second part is empty.
  return `${header}..${encodeBase64Url(iv)}.${encodeBase64Url(ciphertext)}.${encodeBase64Url(tag)}`;
}

/**
 * Opens a value `seal` made with one of `keys`. Anything else, a value
 * changed by a single bit, sealed with another key or another purpose's key,
 * or not a JWE at all, is `undefined`: never an exception, since cookies are
 * whatever the browser sends.
 */
export async function unseal(sealed: string, keys: readonly SealingKey[]): Promise<unknown> {
  if (typeof sealed !== "string" || sealed.length > MAX_SEALED_LENGTH) return undefined;
  const parts = sealed.split(".");
  if (parts.length !== 5 || parts[1] !== "") return undefined;
  const [headerPart, , ivPart, ciphertextPart, tagPart] = parts as [string, string, string, string, string];

  const headerBytes = decodeBase64Url(headerPart);
  const headerText = headerBytes && fromUtf8(headerBytes);
  if (headerText === undefined) return undefined;
  let header: unknown;
  try {
    header = JSON.parse(headerText);
  } catch {
    return undefined;
  }
  if (typeof header !== "object" || header === null) return undefined;
  const { alg, enc, kid, ...rest } = header as Record<string, unknown>;
  // Exactly the header seal writes: no "zip", no "crit", nothing to negotiate.
  if (alg !== "dir" || enc !== "A256GCM" || typeof kid !== "string" || Object.keys(rest).length > 0) return undefined;
  const key = keys.find((candidate) => candidate.kid === kid);
  if (!key) return undefined;

  const iv = decodeBase64Url(ivPart);
  const ciphertext = decodeBase64Url(ciphertextPart);
  const tag = decodeBase64Url(tagPart);
  if (!iv || iv.length !== IV_BYTES || !ciphertext || !tag || tag.length !== TAG_BYTES) return undefined;
  const sealedBytes = new Uint8Array(ciphertext.length + TAG_BYTES);
  sealedBytes.set(ciphertext);
  sealedBytes.set(tag, ciphertext.length);

  let plaintext: ArrayBuffer;
  try {
    plaintext = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv, additionalData: utf8(headerPart), tagLength: TAG_BYTES * 8 },
      key.key,
      sealedBytes,
    );
  } catch {
    return undefined;
  }
  const text = fromUtf8(new Uint8Array(plaintext));
  if (text === undefined) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/** The PKCE S256 challenge of `verifier` (RFC 7636 §4.2): base64url(SHA-256(ASCII(verifier))). */
export async function pkceChallenge(verifier: string): Promise<string> {
  return encodeBase64Url(new Uint8Array(await crypto.subtle.digest("SHA-256", utf8(verifier))));
}

/** Compares two strings in time that depends only on their lengths. */
export function timingSafeEqual(a: string, b: string): boolean {
  const left = utf8(a);
  const right = utf8(b);
  let difference = left.length ^ right.length;
  for (let index = 0; index < Math.max(left.length, right.length); index++) {
    difference |= (left[index] ?? 0) ^ (right[index] ?? 0);
  }
  return difference === 0;
}
