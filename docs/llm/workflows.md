# Workflows — qeet-id-tanstack

**Level:** L2 · **Last verified:** 2026-11-05
**Verification scope:** every command checked against `package.json` and `.github/workflows/`.

## Set up

```bash
bun install
bun run verify   # typecheck + Biome + tests + build + publint + attw
```

No services required — tests use `test/helpers/qeet-id.ts`.

## The session contract changed in qeet-id-react

```text
1  read the change in qeet-id-react's docs/session-contract.md and src/contract.ts
2  raise @qeet-id/react to the version with the change
3  src/contract.ts      re-export any new name
4  src/core/routes.ts   the route, status and error code, exactly as the contract says
5  src/core/auth.ts     if the session's fields or the flow changed
6  test/core/routes.test.ts   a request-in, response-out test per change
7  README (the routes table), CHANGELOG
8  bun run verify
```

## Add a QEET_ID_* variable

```text
1  src/core/config.ts   ENV, QeetIDConfig, the check (naming the variable, never its value)
2  test/core/config.test.ts   the default and each refusal
3  README's environment table, CHANGELOG
4  bun run verify
```

## Add a server helper

```text
1  src/tanstack/server-bodies.ts   the body (server-only; may use getRequest and the response helpers)
2  src/tanstack/server-helpers.ts  wrap it in createServerOnlyFn; export it from src/server.ts
   — or, for something the browser calls: a createServerFn in a browser-safe module whose handler
     dynamic-imports the body, exported from src/index.ts
3  test/tanstack/server.test.ts, test/exports.test.ts
4  README, CHANGELOG; bun run verify
```

## Change cookies, sealing or a sign-in check

**Security review required.** `src/core/crypto.ts`, `src/core/cookies.ts`, `src/core/auth.ts`,
`src/core/routes.ts`. Cite the RFC or the server code; negative tests (tampered, wrong key, wrong state,
wrong issuer, wrong nonce, cross-site). A change to the cookie format or names signs everyone out: escalate.

## Release

```text
1  CHANGELOG.md: move [Unreleased] under the version being released
2  bun run verify
3  open a pull request from develop into main: version.yml bumps the patch in package.json on the
   PR branch (to release a minor or major, set the version in package.json yourself)
4  merge it: release.yml sees a version npm does not have, runs the gate, publishes to npm with
   provenance, then tags vX.Y.Z and opens a GitHub Release
```

A push to `main` whose version is already on npm releases nothing, so re-running is safe. A bad release
is not unpublished: run `rollback.yml` to point `latest` back at a good version, then release a fix.
`scripts/npm-versions.mjs` knows every version npm has ever accepted, including unpublished ones, so a
version number is never reused.

`VERSION` is written in from package.json at build time.

## Finish any task

```bash
bun run verify
git diff
```
