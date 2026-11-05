/**
 * Qeet ID for TanStack Start, server-only: the session routes' handlers,
 * helpers for server functions and server routes, the configuration and the
 * errors. Import it only from server code.
 *
 * ```ts
 * import { authRouteHandlers, checkPermission, getAccessToken } from "@qeet-id/tanstack/server";
 * ```
 *
 * @packageDocumentation
 */

export { authRouteHandlers, checkPermission, getAccessToken, getQeetIDClient } from "./tanstack/server-helpers.js";
export {
  DEFAULT_BASE_URL,
  DEFAULT_SCOPES,
  DEFAULT_SESSION_MAX_AGE_SECONDS,
  ENV,
  MIN_COOKIE_SECRET_LENGTH,
  loadConfig,
  type QeetIDConfig,
  type QeetIDEnv,
} from "./core/config.js";
export { ConfigurationError, NotSignedInError, SessionUnavailableError } from "./core/errors.js";
export { VERSION } from "./core/version.js";
