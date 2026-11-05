/**
 * Reading the `Cookie` header and writing `Set-Cookie` values: every cookie
 * this package sets is `HttpOnly`, `SameSite=Lax` and `Path=/`, with no
 * `Domain`, and `Secure` (with the `__Host-` prefix on its name) whenever the
 * app is served over https.
 *
 * A value too long for one cookie is split into numbered chunks
 * (`name.0`, `name.1`, …). Browsers keep at least 4096 bytes of name, value
 * and attributes per cookie (RFC 6265 §6.1); a chunk holds 3800, leaving room
 * for the rest.
 */

/** The most a single cookie value holds before the value is chunked. */
export const MAX_COOKIE_VALUE_LENGTH: number = 3800;
/** The most chunks read back; a longer run is not ours. */
const MAX_CHUNKS = 16;

/** How a cookie is written. */
export interface CookieAttributes {
  /** Seconds until the browser drops it; 0 deletes it. */
  readonly maxAge: number;
  /** Adds `Secure`. Off only when the app is served over plain http on this machine. */
  readonly secure: boolean;
}

/** The cookies of a request's `Cookie` header, by name. Of two with the same name, the first wins (RFC 6265 §5.4). */
export function parseCookies(header: string | null | undefined): Map<string, string> {
  const cookies = new Map<string, string>();
  if (!header) return cookies;
  for (const pair of header.split(";")) {
    const separator = pair.indexOf("=");
    if (separator < 0) continue;
    const name = pair.slice(0, separator).trim();
    let value = pair.slice(separator + 1).trim();
    if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
    if (name !== "" && !cookies.has(name)) cookies.set(name, value);
  }
  return cookies;
}

/** A `Set-Cookie` value. The value must already be cookie-safe (this package only writes base64url). */
export function serializeCookie(name: string, value: string, attributes: CookieAttributes): string {
  const parts = [`${name}=${value}`, "Path=/", `Max-Age=${Math.max(0, Math.floor(attributes.maxAge))}`, "HttpOnly", "SameSite=Lax"];
  if (attributes.secure) parts.push("Secure");
  return parts.join("; ");
}

/** A `Set-Cookie` value that deletes `name`. */
export function deleteCookie(name: string, secure: boolean): string {
  return serializeCookie(name, "", { maxAge: 0, secure });
}

/** The value of cookie `name`, joined back from its chunks when it was split. */
export function readChunked(cookies: ReadonlyMap<string, string>, name: string): string | undefined {
  const whole = cookies.get(name);
  if (whole !== undefined) return whole;
  const chunks: string[] = [];
  for (let index = 0; index < MAX_CHUNKS; index++) {
    const chunk = cookies.get(`${name}.${index}`);
    if (chunk === undefined) break;
    chunks.push(chunk);
  }
  return chunks.length > 0 ? chunks.join("") : undefined;
}

/**
 * The `Set-Cookie` values that store `value` as cookie `name`: one cookie when
 * it fits, numbered chunks when it doesn't, and deletions for whichever form,
 * or chunks, the request still carries from before.
 */
export function writeChunked(cookies: ReadonlyMap<string, string>, name: string, value: string, attributes: CookieAttributes): string[] {
  const headers: string[] = [];
  if (value.length <= MAX_COOKIE_VALUE_LENGTH) {
    headers.push(serializeCookie(name, value, attributes));
    for (const chunk of chunkNames(cookies, name)) headers.push(deleteCookie(chunk, attributes.secure));
    return headers;
  }
  const count = Math.ceil(value.length / MAX_COOKIE_VALUE_LENGTH);
  for (let index = 0; index < count; index++) {
    const part = value.slice(index * MAX_COOKIE_VALUE_LENGTH, (index + 1) * MAX_COOKIE_VALUE_LENGTH);
    headers.push(serializeCookie(`${name}.${index}`, part, attributes));
  }
  if (cookies.has(name)) headers.push(deleteCookie(name, attributes.secure));
  for (const chunk of chunkNames(cookies, name)) {
    if (Number(chunk.slice(name.length + 1)) >= count) headers.push(deleteCookie(chunk, attributes.secure));
  }
  return headers;
}

/** The `Set-Cookie` values that delete cookie `name` and any chunks of it the request carries. */
export function clearChunked(cookies: ReadonlyMap<string, string>, name: string, secure: boolean): string[] {
  return [deleteCookie(name, secure), ...chunkNames(cookies, name).map((chunk) => deleteCookie(chunk, secure))];
}

function chunkNames(cookies: ReadonlyMap<string, string>, name: string): string[] {
  const prefix = `${name}.`;
  return [...cookies.keys()].filter((key) => key.startsWith(prefix) && /^\d+$/.test(key.slice(prefix.length)));
}
