# AGENTS.md — qeet-id-tanstack

**The model-neutral instruction file for coding agents.** [CLAUDE.md](CLAUDE.md),
[GEMINI.md](GEMINI.md) and [.github/copilot-instructions.md](.github/copilot-instructions.md) point
here and add nothing architectural.

## What this repository is

**Qeet ID for TanStack Start**, `@qeet-id/tanstack`: the server side of Qeet ID's session contract for
TanStack Start apps, and the wiring of `@qeet-id/react` into them. Node.js 22.12 or later, bun and Biome,
TypeScript 7, ES modules only, built by tsdown.

People sign in on Qeet ID's hosted pages (OpenID Connect code flow with PKCE). The app's server is the
OAuth client: it keeps the tokens in an encrypted, HttpOnly cookie and answers the browser's `{base}/*`
routes (a backend for frontend, RFC 10017 §6.1).

It implements **contracts it does not own**:

| Contract | Owner |
| --- | --- |
| The session routes, their JSON, errors and CSRF header | `qeet-id-react`: `docs/session-contract.md` and `src/contract.ts` (`@qeet-id/react/contract`) |
| The OAuth/OpenID endpoints and token claims | `qeet-id-server`: `api/openapi/federation.yaml`, `internal/federation/oidc/` |
| The code exchange, refresh, revocation, ID token verification, management API | `qeet-id-node` (`@qeet-id/node`) |

## Read before changing code

| File | For |
| --- | --- |
| [qeet-repo.yml](qeet-repo.yml) | Machine-readable identity |
| [docs/llm/architecture-map.md](docs/llm/architecture-map.md) | "Where is X?" |
| [docs/llm/context.md](docs/llm/context.md) | How this package works |
| [docs/llm/boundaries.md](docs/llm/boundaries.md) | What it owns, and what it must not touch |
| [docs/llm/workflows.md](docs/llm/workflows.md) | Common changes; releasing |
| [docs/engineering-practices.md](docs/engineering-practices.md) | The practices followed, with sources |

Decisions: `docs/design-decisions/` (ADR-0001 to ADR-0004), all binding.

## Rules

1. **Tokens never reach the browser.** Not in the session JSON, a server function's result, an error, a log
   or a test snapshot. `Session` (the contract's type) carries none.
2. **Follow the contract exactly.** Routes, methods, bodies, status codes and error codes come from
   `@qeet-id/react/contract`; import it only through `src/contract.ts`. A change to the contract is made in
   `qeet-id-react` first.
3. **Never weaken a check:** state, `iss` (RFC 9207), PKCE, the ID token (signature, `iss`, `aud`, `exp`,
   `nonce`, `sub` at renewal), the CSRF header, `Sec-Fetch-Site` and `Origin`, `safeReturnTo`, cookie
   attributes, `Cache-Control: no-store`.
4. **One renewal per refresh token** (ADR-0003). Never call the token endpoint for a refresh token outside
   `OidcClient.renew`: Qeet ID ends the grant when a spent refresh token comes back.
5. **Server code stays out of the browser.** Modules under `src/core/` and `src/tanstack/server-bodies.ts` are
   reached from browser-safe modules only through dynamic imports inside `createServerFn`,
   `createMiddleware().server` or `createServerOnlyFn` bodies. `src/index.ts` must stay browser-safe.
6. **No runtime dependency of its own.** Web Crypto, `fetch`, and the peers (`@qeet-id/node`,
   `@qeet-id/react`, TanStack Start, TanStack Router, React) only.
7. **Configuration comes from `QEET_ID_*` variables** (`src/core/config.ts`). A new one gets a check that
   names it in `ConfigurationError.problems`, never its value, and a row in the README.
8. **Errors extend `@qeet-id/node`'s `QeetIDError`** with a stable `code`; never put a credential in one.
9. **Tests never call a real server.** Use `test/helpers/qeet-id.ts`, which stands in for Qeet ID.

## Commands

```bash
bun install
bun run verify          # typecheck + Biome + tests + build + publint + attw — the gate
bun run build           # tsdown
bun run test            # vitest run
bun run typecheck       # tsc --noEmit (TypeScript 7)
bun run check           # Biome lint and format check
bun run check:package   # publint --strict && attw --pack . --profile esm-only
```

Also `bun run dev`, `bun run test:watch`, `bun run test:coverage`, `bun run lint`, `bun run lint:fix`,
`bun run format`.

### The unpublished Qeet ID packages

`@qeet-id/node` and `@qeet-id/react` are linked for development until they are published
(`"link:@qeet-id/node"` in devDependencies; optional in `peerDependenciesMeta` so bun doesn't look for them on
npm). Before `bun install`, build and register each:

```bash
git clone --branch develop https://github.com/qeetgroup/qeet-id-node ../qeet-id-node
(cd ../qeet-id-node && bun install && bun run build && bun link)
# The branch holding the session contract: feat/sdk-1.0 today, develop once it is merged.
git clone --branch feat/sdk-1.0 https://github.com/qeetgroup/qeet-id-react ../qeet-id-react
(cd ../qeet-id-react && bun install && bun run build && bun link)
```

Once both are on npm: replace the `link:` devDependencies with their versions, drop `peerDependenciesMeta`,
and remove the matching steps from the workflows.

## What CI enforces

`ci.yml` on Node.js 22, 24 and 26: install, typecheck, build, tests with coverage, package checks.
`lint.yml`: `bun run check`. `security.yml`: `bun audit --audit-level=high` and gitleaks. `codeql.yml`.
`version.yml` bumps the patch in `package.json` on every pull request into `main` (raise minor or major by
hand). `release.yml` runs on every push to `main`: when that version is not on npm yet, it runs the gate,
publishes with provenance, then tags `vX.Y.Z` and opens a GitHub Release; otherwise it does nothing.
`rollback.yml` points the npm `latest` dist-tag back at an earlier version.

## Branches

Two long-lived branches: `develop`, where work lands, and `main`, what is released. Changes reach `main`
only by a pull request from `develop`. There are no release branches: a version is a `vX.Y.Z` tag, made by
`release.yml` when a pull request is merged into `main`.

## Before you finish

```bash
bun run verify
git diff
```

## Escalate rather than proceed

A change to the session contract · weakening a check · a runtime dependency · renaming or removing an export ·
a new `QEET_ID_*` variable's name · the cookie format or names (it signs everyone out) · anything requiring
another repository · the package name or first published version.
