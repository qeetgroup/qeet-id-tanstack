/**
 * The session contract between `@qeet-id/react` in the browser and this
 * package's routes, as `@qeet-id/react/contract` publishes it. The one place
 * this package imports it from, so every route answers the same shapes.
 */
export {
  AUTH_ERROR_PARAMETER,
  CSRF_HEADER,
  CSRF_HEADER_VALUE,
  DEFAULT_BASE_PATH,
  MAX_RETURN_TO_LENGTH,
  SIGN_IN_PARAMETERS,
  parseSession,
  safeReturnTo,
  sessionRoutes,
} from "@qeet-id/react/contract";
export type {
  ErrorResponse,
  Session,
  SessionErrorCode,
  SessionOrganization,
  SessionResponse,
  SessionRoutes,
  SessionUser,
  SignInErrorCode,
  SignOutRequest,
  SignOutResponse,
  SwitchOrganizationRequest,
  SwitchOrganizationResponse,
} from "@qeet-id/react/contract";
