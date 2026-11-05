# Architecture Map — qeet-id-tanstack

**Level:** L2 · **Last verified:** 2026-11-05
**Verification scope:** every path below was confirmed to exist.

| Need | Path |
| --- | --- |
| Repository identity | [`qeet-repo.yml`](../../qeet-repo.yml) |
| Agent instructions | [`AGENTS.md`](../../AGENTS.md) |
| **Browser-safe entry** (route files, components) | `src/index.ts` |
| **Server-only entry** | `src/server.ts` |
| The session contract, imported once | `src/contract.ts` (from `@qeet-id/react/contract`) |
| Version constant | `src/core/version.ts` (written in from package.json at build time) |

## Core — framework-free, `Request` in, locations, cookies or `Response` out

| Concern | Path |
| --- | --- |
| **Sign-in, callback, session, renewal, sign-out, `checkPermission`** (`QeetIDAuth`) | `src/core/auth.ts` |
| **The six routes, CSRF, body parsing, error envelope** | `src/core/routes.ts` |
| **OpenID Connect client** (discovery, authorize URL, code exchange, ID token, renewal, revoke, end-session) | `src/core/oidc.ts` |
| **Cookie sealing** (JWE dir/A256GCM, HKDF keys, rotation, PKCE challenge) | `src/core/crypto.ts` |
| Cookie parsing, `Set-Cookie`, chunking | `src/core/cookies.ts` |
| Stored session and sign-in shapes, `toSession` | `src/core/session.ts` |
| `QEET_ID_*` configuration | `src/core/config.ts` |
| Errors | `src/core/errors.ts` |
| base64url, random tokens, JWT payload decoding | `src/core/encoding.ts` |

## TanStack Start

| Concern | Path |
| --- | --- |
| `getSession` server function | `src/tanstack/server-functions.ts` |
| `sessionMiddleware`, `requireSessionMiddleware` | `src/tanstack/middleware.ts` |
| `requireSession` `beforeLoad` guard | `src/tanstack/guard.ts` |
| `QeetIDProvider` (initialSession from the router context) | `src/tanstack/provider.ts` |
| `authRouteHandlers`, `getAccessToken`, `checkPermission`, `getQeetIDClient` | `src/tanstack/server-helpers.ts` |
| **Server bodies** (request helpers, `no-store`, cookies on the response) — server-only | `src/tanstack/server-bodies.ts` |
| The process's `QeetIDAuth`, from the environment | `src/tanstack/runtime.ts` |

## Build, test, CI

| | |
| --- | --- |
| Scripts | `package.json` |
| Build config | `tsdown.config.ts` — ES modules, one file per module, declarations |
| Compiler config | `tsconfig.json` — `nodenext`, strict, `isolatedDeclarations` |
| Tests | `test/` — vitest |
| **Mock Qeet ID and cookie jar** | `test/helpers/qeet-id.ts` |
| CI | `.github/workflows/{ci,lint,security,codeql,release}.yml` |

## Decisions

| ADR | Decision |
| --- | --- |
| `docs/design-decisions/ADR-0001-sealed-cookie-session.md` | Seal the cookie ourselves, as a JWE |
| `docs/design-decisions/ADR-0002-routes-and-server-functions.md` | One catch-all server route; server functions shipped from the package |
| `docs/design-decisions/ADR-0003-renewal-once-per-refresh-token.md` | Renew once per refresh token |
| `docs/design-decisions/ADR-0004-organisation-switching.md` | Organisation switching answers 501 |

Also `docs/engineering-practices.md`.

## Upstream

The session contract: `qeet-id-react` (`docs/session-contract.md`, `src/contract.ts`). The OpenID provider:
`qeet-id-server` (`api/openapi/federation.yaml`, `internal/federation/oidc/`). The OAuth calls: `qeet-id-node`.
