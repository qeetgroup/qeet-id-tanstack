# ADR-0002: One catch-all server route, and server functions shipped from the package

**Status:** Accepted

## Context

The contract has six routes under one base path. TanStack Start answers HTTP in two ways an app sets up:
server routes (files in `src/routes` with `server.handlers`) and global request middleware (which may return
a `Response` without calling `next`). Loaders and `beforeLoad` run on the server while rendering and in the
browser on navigation, so reading the session there needs a server function.

A package can't add files to the app's route tree. Server functions are found by the Start compiler; it
compiles a dependency only when the dependency lists `@tanstack/react-start` as a peer.

## Decision

- **Routes:** the app adds one catch-all server route at the base path, `src/routes/auth/$.ts`, with
  `server: { handlers: authRouteHandlers }`. `authRouteHandlers` is an `ANY` handler; the package answers 404
  and 405 itself, so every method gets the contract's error shape.
- **Server functions and middleware ship from the package** (`getSession`, `sessionMiddleware`,
  `requireSessionMiddleware`), with `@tanstack/react-start` as a peer. Their server bodies reach the server
  modules through dynamic imports, which the compiler removes from the client build.
- **Server-only helpers** (`getAccessToken`, `checkPermission`, `getQeetIDClient`) are `createServerOnlyFn`s in
  `@qeet-id/tanstack/server`: in the browser they throw instead of running.

## Why

A server route is TanStack Start's own place for HTTP endpoints, is visible in the route tree, and is how
Better Auth and WorkOS mount their callbacks; middleware answering routes would hide them. Shipping the server
functions (as WorkOS's `getAuth` does) saves every app writing the same wrapper, which Clerk's setup asks
for. A build of a Start app against the packed package confirmed that the client bundle holds the RPC stub
and none of the server modules.
