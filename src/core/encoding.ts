/**
 * base64url (RFC 4648 §5, no padding) with the platform's own `btoa` and
 * `atob`, so the same code runs on Node.js, Deno, Bun and edge runtimes.
 */

const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });

/** Encodes bytes as base64url without padding. */
export function encodeBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Decodes base64url without padding; `undefined` for anything else. */
export function decodeBase64Url(value: string): Uint8Array<ArrayBuffer> | undefined {
  if (!/^[A-Za-z0-9_-]*$/.test(value) || value.length % 4 === 1) return undefined;
  const binary = atob(value.replace(/-/g, "+").replace(/_/g, "/"));
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

/** UTF-8 bytes of `value`. */
export function utf8(value: string): Uint8Array<ArrayBuffer> {
  const bytes = encoder.encode(value);
  const copy = new Uint8Array(new ArrayBuffer(bytes.byteLength));
  copy.set(bytes);
  return copy;
}

/** The UTF-8 text of `bytes`; `undefined` when they aren't UTF-8. */
export function fromUtf8(bytes: Uint8Array): string | undefined {
  try {
    return decoder.decode(bytes);
  } catch {
    return undefined;
  }
}

/** `length` random bytes from the platform's CSPRNG, as base64url. */
export function randomToken(length = 32): string {
  return encodeBase64Url(crypto.getRandomValues(new Uint8Array(length)));
}

/**
 * The claims of a JWT, decoded but not verified. Only for tokens this package
 * verified itself before sealing them into the session cookie.
 */
export function decodeJwtPayload(token: string): Record<string, unknown> | undefined {
  const payload = token.split(".")[1];
  if (payload === undefined) return undefined;
  const bytes = decodeBase64Url(payload);
  const text = bytes && fromUtf8(bytes);
  if (text === undefined) return undefined;
  try {
    const value: unknown = JSON.parse(text);
    return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
}
