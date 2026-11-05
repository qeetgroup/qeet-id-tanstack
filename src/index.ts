/**
 * Qeet ID for TanStack Start: what route files and components import. Safe on
 * the server and in the browser.
 *
 * Everything from `@qeet-id/react` (hooks, components, `QeetIDError`), its
 * `QeetIDProvider` wired to the session the server rendered with, the
 * `getSession` server function, the `requireSession` guard, and the session
 * middleware. Server-only helpers are in `@qeet-id/tanstack/server`.
 *
 * ```tsx
 * import { QeetIDProvider, SignedIn, SignedOut, SignInButton, UserButton, getSession } from "@qeet-id/tanstack";
 * ```
 *
 * @packageDocumentation
 */

export * from "@qeet-id/react";
export { QeetIDProvider, type QeetIDProviderProps } from "./tanstack/provider.js";
export { getSession } from "./tanstack/server-functions.js";
export { requireSession, type GuardLocation, type RequireSessionOptions } from "./tanstack/guard.js";
export { requireSessionMiddleware, sessionMiddleware } from "./tanstack/middleware.js";
export { VERSION } from "./core/version.js";
