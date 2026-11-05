# Changelog

All notable changes to Qeet ID for TanStack Start are documented here. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the
project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.0] — 2026-11-05

### Added

- **The session routes**, from one catch-all server route (`authRouteHandlers`): `GET {base}/sign-in` and
  `{base}/sign-up` (302 to Qeet ID), `GET {base}/callback`, `GET {base}/session`, `POST {base}/sign-out` and
  `POST {base}/switch-organization`, as `@qeet-id/react`'s session contract defines them. Base path `/auth`,
  or `QEET_ID_BASE_PATH`.
- **Signing in** with the OpenID Connect code flow and PKCE S256: a fresh state, nonce and verifier per
  sign-in, in a sign-in cookie of its own; at the callback the state, the issuer (RFC 9207), the code
  exchange and the ID token (ES256, issuer, audience, expiry, nonce) are checked. A failed sign-in returns
  to the page with `?authError=<code>`.
- **An encrypted cookie session**: the tokens sealed as a JWE (`dir`, `A256GCM`) with HKDF-derived keys,
  `HttpOnly`, `Secure`, `SameSite=Lax`, `Path=/`, `__Host-`; secrets rotate through `QEET_ID_COOKIE_SECRET`
  (`new,old`); long values split into chunks.
- **Renewal** of the access token in its last minute, once per refresh token, shared by concurrent requests
  and reused for a minute, since Qeet ID ends the grant when a spent refresh token comes back. A refused
  renewal ends the session; an unreachable Qeet ID answers `503 session_unavailable` once the access token
  has expired.
- **Signing out** revokes the refresh token, clears the cookie and answers Qeet ID's end-session URL with the
  ID token as the hint, coming back to `returnTo` or `QEET_ID_POST_SIGN_OUT_REDIRECT_URI`.
- **`getSession()`**, a server function for loaders, `beforeLoad` and server code.
- **`requireSession()`**, a `beforeLoad` guard that sends signed-out visitors to sign in and back, and throws
  the failed sign-in's `QeetIDError` instead of looping.
- **`sessionMiddleware` and `requireSessionMiddleware`**, request middleware adding `context.session` to
  server functions and server routes; the second refuses signed-out requests.
- **`QeetIDProvider`**, `@qeet-id/react`'s provider taking `initialSession` from the router context, and
  everything else `@qeet-id/react` exports.
- **Server helpers** in `@qeet-id/tanstack/server`: `getAccessToken()`, `checkPermission(permission)`,
  `getQeetIDClient()`, `loadConfig()`.
- **The organisation's name and the person's roles and permissions** in the session with
  `QEET_ID_API_KEY`, looked up at sign-in and every five minutes.
- **Configuration** from `QEET_ID_*` variables, every problem reported at once by a `ConfigurationError`.
- **Typed errors**: `ConfigurationError`, `NotSignedInError` and `SessionUnavailableError`, extending
  `@qeet-id/node`'s `QeetIDError`.

### Not yet possible at Qeet ID

- Switching organisation answers `501 organization_switch_unavailable` for any organisation but the
  current one, and `organization` and `loginHint` on sign-in are accepted but not passed on: Qeet ID's
  authorization endpoint takes neither, and an application's sign-in is always for its own organisation.

[Unreleased]: https://github.com/qeetgroup/qeet-id-tanstack/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/qeetgroup/qeet-id-tanstack/releases/tag/v0.1.0
