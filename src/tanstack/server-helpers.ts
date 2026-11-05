/**
 * Helpers for server code. Each is a TanStack Start server-only function:
 * called in the browser, it throws instead of running.
 */

import type { QeetID } from "@qeet-id/node";
import { createServerOnlyFn } from "@tanstack/react-start";
import { answerSessionRoute, askPermission, readAccessToken } from "./server-bodies.js";
import { getQeetIDAuth } from "./runtime.js";

/**
 * The current session's access token, renewed when it is close to expiry, to
 * call an API that accepts Qeet ID tokens. Keep it on the server.
 *
 * @throws {NotSignedInError} when nobody is signed in.
 */
export const getAccessToken: () => Promise<string> = createServerOnlyFn(() => readAccessToken());

/**
 * Whether the signed-in person holds `permission` (such as `invoice.approve`)
 * in their organisation, asked of Qeet ID now: roles and attribute policies
 * together. The authoritative check for a server function to make before it
 * acts; the session's `permissions` are only hints for the UI. Needs
 * `QEET_ID_API_KEY`.
 *
 * @throws {NotSignedInError} when nobody is signed in.
 * @throws {ConfigurationError} without `QEET_ID_API_KEY`.
 */
export const checkPermission: (permission: string) => Promise<boolean> = createServerOnlyFn((permission: string) =>
  askPermission(permission),
);

/**
 * The `@qeet-id/node` client this package uses, with the configured base URL
 * and, when set, `QEET_ID_API_KEY`: for the management API.
 */
export const getQeetIDClient: () => QeetID = createServerOnlyFn(() => getQeetIDAuth().oidc.api);

/**
 * The session routes, for a catch-all server route at the base path:
 *
 * ```ts
 * // src/routes/auth/$.ts
 * export const Route = createFileRoute("/auth/$")({
 *   server: { handlers: authRouteHandlers },
 * });
 * ```
 */
export const authRouteHandlers: { readonly ANY: (context: { request: Request }) => Promise<Response> } = Object.freeze({
  ANY: ({ request }: { request: Request }) => answerSessionRoute(request),
});
