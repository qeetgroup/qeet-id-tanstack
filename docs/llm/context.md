# Repository Context — qeet-id-tanstack

**Level:** L2 · **Status:** active · **Evidence state:** verified · **Last verified:** 2026-11-05
**Verification scope:** exports, routes, cookies and flows read from source and tests; the server facts
checked against `qeet-id-server` (`fix/server-release-1.0`); a TanStack Start 1.169 app built against the
packed package and run end to end.

## Identity

`@qeet-id/tanstack` — Qeet ID for TanStack Start. Node.js 22.12 or later, bun and Biome, TypeScript 7, ES
modules only, built by tsdown (one file per module).

## Context inheritance

```text
qeet-context (L0)  →  qeet-id-context (L1)  →  qeet-id-react (the session contract)
                                            →  qeet-id-tanstack (L2 — this document)
```

## How it works

```text
browser ──GET /auth/sign-in──▶ QeetIDAuth.startSignIn ──302──▶ Qeet ID /v1/oauth/authorize
        ◀──302 + sign-in cookie (state, nonce, verifier sealed)
Qeet ID ──302 /auth/callback?code&state&iss──▶ QeetIDAuth.finishSignIn
        state + iss + code exchange (@qeet-id/node) + ID token + nonce ──▶ session cookie, 302 returnTo
page / server function / server route ──▶ getSession · middleware ──▶ QeetIDAuth.loadSession(request)
        unseal → renew in the last minute (once per refresh token) → directory lookup (API key) → Session
browser ──POST /auth/sign-out──▶ revoke refresh token, clear cookie, { redirectTo: end-session URL }
```

`src/core/` is framework-free; `src/tanstack/` binds it to TanStack Start: `getRequest()` for the request,
`setResponseHeader`/`appendResponseHeader` for `no-store` and cookies, `createServerFn`, `createMiddleware`,
`createServerOnlyFn`.

## Cookies

| Cookie | Holds | Life |
| --- | --- | --- |
| `__Host-qeet-id-session` (chunked `.0`, `.1`, … when long) | ID, access and refresh tokens; organisation name, roles, permissions; expiries | `QEET_ID_SESSION_MAX_AGE` (30 days), rolling at each renewal; the access token's life without a refresh token |
| `__Host-qeet-id-signin.<state>` | state, nonce, PKCE verifier, return path | 10 minutes, deleted at the callback |

Sealed as JWE `dir`/`A256GCM`; keys by HKDF per secret and purpose. Without https (localhost), no `__Host-`
and no `Secure`. A typical session is about 2.4 KB sealed.

## Server facts relied on (qeet-id-server, fix/server-release-1.0)

| Fact | Where |
| --- | --- |
| Discovery: authorize `/v1/oauth/authorize`, token `/v1/oauth/token-code`, revoke `/oauth/revoke`, end-session `/v1/oauth/logout`, JWKS; `authorization_response_iss_parameter_supported`, S256 only | `internal/federation/oidc/discovery.go` |
| PKCE S256 required; `nonce` echoed in the ID token; `iss` on the authorization response | `internal/federation/oidc/http_authorize.go`, `authorize.go` |
| ID token: ES256, `iss`, `sub`, `aud` = client id, `exp`, `iat`, `tenant_id`, `nonce`, `auth_time`, `sid`, scope claims | `internal/federation/oidc/token.go` (`signIDToken`), `userinfo.go` |
| Refresh rotates; a spent refresh token revokes the whole grant; a renewed ID token keeps `sid`/`auth_time`, no `nonce` | `internal/federation/oidc/token.go` (`RefreshToken`, `handleRefreshReuse`) |
| A refresh token comes only with the `refresh_token` grant; with `offline_access` registered, only when granted | `internal/federation/oidc/authorize.go` (`issuesRefreshToken`) |
| An application's code is always for its own organisation | `internal/federation/oidc/authorize.go` (`AuthorizeInLoginSession`) |
| Application tokens are refused everywhere but userinfo | `internal/bootstrap/router.go` (`RefuseApplicationTokens`), `permissions.go` (`ApplicationTokenRoutes`) |
| Logout needs `id_token_hint` (or a confirmation); an unregistered `post_logout_redirect_uri` lands on the hosted signed-out page | `internal/federation/oidc/logout.go` (`endSession`) |
| Access tokens 10 minutes, refresh tokens 720 hours by default | `internal/platform/config/config.go` |

## Testing

`test/` with vitest: crypto, cookies and config; the flows against `test/helpers/qeet-id.ts` (a mock Qeet ID
with a real ES256 key, refresh rotation and reuse detection); the routes request-in, response-out; the
TanStack layer with Start's request helpers mocked. No test calls a real server.

## Known constraints

- `@qeet-id/node` and `@qeet-id/react` aren't on npm yet: linked for development (AGENTS.md).
- Renewals are shared per process (ADR-0003).
- Back-channel logout isn't received: a cookie session has no server-side store to end. A Qeet ID sign-out
  revokes the grant, so the session ends at its next renewal.

## Documentation authority

Source > tests > README > this file. The **session contract** is owned by `qeet-id-react`.
