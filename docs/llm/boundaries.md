# Boundaries — qeet-id-tanstack

**Level:** L2 · **Last verified:** 2026-11-05

## Owns

The server side of the session contract for TanStack Start: the six `{base}/*` routes, the sealed cookie
session, renewal, sign-out, the `beforeLoad` guard, the request middleware, the `getSession` server function,
the server-only helpers, and `QeetIDProvider`'s wiring to the router context.

## Does not own

| Not owned | Owner |
| --- | --- |
| **The session contract** (routes, JSON, error codes, CSRF header, `safeReturnTo`) | `qeet-id-react` — `docs/session-contract.md`, `src/contract.ts` |
| Hooks and components | `qeet-id-react` |
| **OAuth/OpenID behaviour**, token issuance and claims | `qeet-id-server` |
| The OAuth calls, `TokenVerifier`, the management API client | `qeet-id-node` |
| Next.js | `qeet-id-nextjs` |
| Documentation site | `qeet-id-docs` |

**The package never adds behaviour Qeet ID lacks.** Switching organisation answers 501 because Qeet ID can't
switch an application's organisation (ADR-0004); a missing server feature is server work.

## Consumes

Qeet ID over HTTPS through `@qeet-id/node`: discovery, JWKS, `/v1/oauth/token-code` (authorization_code,
refresh_token), `/oauth/revoke`; with `QEET_ID_API_KEY`, `/v1/tenants/{id}`,
`/v1/users/{id}/tenants/{id}/permissions` and `/v1/check`. The browser reaches Qeet ID only by navigating to
the authorization and end-session endpoints.

## Provides

An npm package whose **exports in `src/index.ts` and `src/server.ts`** are its contract, plus the cookie names
(`__Host-qeet-id-session`, `__Host-qeet-id-signin.<state>`) and the `QEET_ID_*` variables.

## Security boundaries

| Boundary | Enforcement |
| --- | --- |
| Tokens → browser | `src/core/session.ts` (`toSession` carries none), `src/core/crypto.ts` (sealed), `HttpOnly` |
| Callback → session | `src/core/auth.ts` — state, `iss`, PKCE, ID token signature/`iss`/`aud`/`exp`/`nonce` |
| POST → state change | `src/core/routes.ts` — `X-Qeet-ID-Request: 1`, `Sec-Fetch-Site`, `Origin` |
| `returnTo` → redirect | `safeReturnTo` from the contract, in `src/core/auth.ts` |
| Refresh token → Qeet ID | `src/core/oidc.ts` (`renew`, once per token) |
| Server code → client bundle | dynamic imports inside server bodies; `src/index.ts` browser-safe |

## Requires coordination

| Change | Why |
| --- | --- |
| **Any name in `src/index.ts` or `src/server.ts`** | The package's public contract |
| The session contract | Owned by `qeet-id-react`; the Next.js SDK implements it too |
| Cookie names or format | Every signed-in person is signed out |
| `QEET_ID_*` variable names | Every deployment's configuration |
| The TanStack Start peer range | Who can install |

## Hard limits

1. **Never send a token to the browser.**
2. **Never refresh outside `OidcClient.renew`.**
3. **Never skip a sign-in check**, even in tests.
4. **Never import server modules statically into the browser entry.**
5. **Never log or embed a credential.**
6. **Never change another repository** from a task scoped to this one.
