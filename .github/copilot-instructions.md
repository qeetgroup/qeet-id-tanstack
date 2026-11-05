# GitHub Copilot — qeet-id-tanstack

**Canonical instructions: [`AGENTS.md`](../AGENTS.md).** This file is a summary; it adds no
architecture.

## Repository

**Qeet ID for TanStack Start** — `@qeet-id/tanstack`. Node.js 22.12+, bun, Biome, TypeScript 7, ES modules
via tsdown. The server side of `@qeet-id/react`'s session contract, an encrypted cookie session, a
`beforeLoad` guard, request middleware and server helpers.

## Structure

`src/index.ts` (browser-safe entry) · `src/server.ts` (server-only entry) · `src/contract.ts` (the contract,
from `@qeet-id/react/contract`) · `src/core/` (framework-free: config, cookies, crypto, OpenID Connect,
session, routes) · `src/tanstack/` (server functions, middleware, guard, provider, server helpers).

## Rules

1. **Tokens never reach the browser.**
2. **Follow the session contract exactly.**
3. **One renewal per refresh token** (`OidcClient.renew`).
4. **Server code reaches the browser entry only through dynamic imports inside server bodies.**
5. **No runtime dependency of its own.**
6. **Never weaken** state, `iss`, PKCE, ID token, CSRF, return-path, cookie or caching checks.

## Commands

`bun install` · `bun run verify` · `bun run build` · `bun run test` · `bun run typecheck` · `bun run check`

## Do not

- return a token from a server function or put one in an error or log
- call the token endpoint for a refresh outside `OidcClient.renew`
- import `src/core/*` statically from `src/index.ts` or the modules it imports
- add a route, field or error code the contract doesn't have
- invent scripts — read `package.json`
