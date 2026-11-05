# Contributing

## Setup

```bash
git clone https://github.com/qeetgroup/qeet-id-tanstack
cd qeet-id-tanstack
bun install
bun run verify   # typecheck + Biome + tests + build + publint + attw
```

Requires Node.js 22.12 or later and bun (`packageManager` in `package.json`).

## Conventions

- **The session contract is `@qeet-id/react`'s** (`docs/session-contract.md` there). Routes, bodies, statuses
  and error codes follow it; a change starts there.
- **The OAuth and OpenID behaviour is Qeet ID's.** Check `qeet-id-server`'s `api/openapi/federation.yaml` and
  `internal/federation/oidc/` before relying on a parameter or claim.
- **`src/core/` knows nothing of TanStack**: it takes a `Request` and answers locations, cookies or a
  `Response`. `src/tanstack/` adapts it.
- **Browser-safe entry.** `src/index.ts` and what it imports reach server code only through dynamic imports
  inside server function, middleware or server-only function bodies.
- **Names:** PascalCase types, camelCase functions, acronyms as words; `QeetID` keeps its brand spelling.
- **No credentials** in errors, logs, tests' output or the README's examples.

## Tests

```bash
bun run test           # vitest run
bun run test:coverage
```

`test/helpers/qeet-id.ts` stands in for Qeet ID (discovery, JWKS with a real ES256 key, the token endpoint
with refresh rotation and reuse detection, revocation, the management API); `CookieJar` plays the browser.
Every route change gets a request-in, response-out test in `test/core/routes.test.ts`.

## Reporting bugs

Open an issue with what you did, what you expected and what happened. Never paste a cookie, token or secret.
