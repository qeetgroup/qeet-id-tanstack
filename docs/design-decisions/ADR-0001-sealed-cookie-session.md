# ADR-0001: Seal the session cookie ourselves, as a JWE

**Status:** Accepted

## Context

The session keeps the access, ID and refresh tokens on the app's side, in a cookie the browser can't read
(RFC 10017 §6.1.3.2: the BFF SHOULD encrypt its cookie contents). Several instances must read each
other's cookies with nothing shared but a secret, and the secret must rotate without signing everyone out.

TanStack Start used to export h3's sealed sessions (`useSession`, `sealSession`); 1.169 no longer does,
and its authentication guide now uses iron-session. iron-session (iron's AES-256-CBC with HMAC-SHA-256 and
password-derived keys) would work, but it is a runtime dependency, and with it a second cookie format to
explain.

## Decision

Seal with Web Crypto alone, as a JWE (RFC 7516) in compact serialization: direct encryption (`alg: "dir"`)
with AES-256-GCM (`enc: "A256GCM"`), the protected header as the additional data.

- **Keys:** one per secret and purpose (`session`, `sign-in`), by HKDF-SHA-256 (RFC 5869). A sign-in cookie
  can't be replayed as a session cookie.
- **Rotation:** `QEET_ID_COOKIE_SECRET` lists secrets, newest first. The first seals; every one unseals. The
  header's `kid` (a hash of the derived key) picks the key.
- **Expiry** is inside the sealed value and checked on every read, not only by `Max-Age`.
- **Strict parsing:** exactly the header this package writes; anything else, or any changed bit, reads as
  no cookie, never an exception.
- **Chunking** only when a value is longer than one cookie holds (`name.0`, `name.1`, …).

## Why

AES-GCM is authenticated encryption in one primitive, available everywhere TanStack Start runs; HKDF
separates purposes without a second secret; JWE is a published format any JOSE library can open, which helps
when debugging. It keeps the package free of a runtime dependency of its own, as `@qeet-id/node` is. About 130
lines, all covered by tests (tampering, wrong key, wrong purpose, rotation, junk).
