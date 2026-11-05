/**
 * The session routes of the contract (docs/session-contract.md in
 * `@qeet-id/react`), answering a standard `Request` with a `Response`:
 *
 * | Route | Method | Answers |
 * | --- | --- | --- |
 * | `{base}/sign-in` | GET | 302 to Qeet ID's authorization endpoint |
 * | `{base}/sign-up` | GET | the same: Qeet ID has no sign-up hint yet |
 * | `{base}/callback` | GET | 302 to the saved return path |
 * | `{base}/session` | GET | 200 `{ session }` |
 * | `{base}/sign-out` | POST | 200 `{ redirectTo }` |
 * | `{base}/switch-organization` | POST | 200 `{ session }`, or 501 while Qeet ID can't switch |
 *
 * Every answer carries `Cache-Control: no-store`; errors are
 * `{ "error": { "code", "message" } }`; no answer carries a CORS header.
 */

import { CSRF_HEADER, CSRF_HEADER_VALUE, type SessionErrorCode, type SessionRoutes } from "../contract.js";
import type { AuthRedirect, QeetIDAuth } from "./auth.js";
import { SessionUnavailableError } from "./errors.js";

type RouteName = keyof SessionRoutes;

/** Bodies larger than this aren't read: no session route needs more. */
const MAX_BODY_LENGTH = 16 * 1024;
const NO_STORE = "no-store";

/** Answers a request to one of the session routes; any other path under the base path is a 404. */
export async function handleAuthRequest(auth: QeetIDAuth, request: Request): Promise<Response> {
  const url = new URL(request.url);
  const route = routeOf(url.pathname, auth.config.routes);
  if (route === undefined) return errorResponse(404, "not_found", "There is no such session route.");
  const allowed = route === "signOut" || route === "switchOrganization" ? "POST" : "GET";
  if (request.method.toUpperCase() !== allowed) {
    return errorResponse(405, "method_not_allowed", `This route answers ${allowed} only.`, { Allow: allowed });
  }
  try {
    switch (route) {
      case "signIn":
      case "signUp":
        // The organization and loginHint parameters are reserved: Qeet ID's
        // authorization endpoint takes neither yet, nor a sign-up hint.
        return redirectResponse(await auth.startSignIn(url.searchParams.get("returnTo")));
      case "callback":
        return redirectResponse(await auth.finishSignIn(request));
      case "session": {
        const { session, cookies } = await auth.loadSession(request);
        return jsonResponse(200, { session }, cookies);
      }
      case "signOut": {
        if (csrfRejected(request, auth.config.origin)) return csrfResponse();
        const body = await readJson(request, false);
        if (body === undefined || (body.returnTo !== undefined && typeof body.returnTo !== "string")) {
          return errorResponse(400, "invalid_request", 'The body must be empty, or JSON such as { "returnTo": "/" }.');
        }
        const { redirectTo, cookies } = await auth.signOut(request, body.returnTo);
        return jsonResponse(200, { redirectTo }, cookies);
      }
      case "switchOrganization": {
        if (csrfRejected(request, auth.config.origin)) return csrfResponse();
        const body = await readJson(request, true);
        const organizationId = body?.organizationId;
        if (typeof organizationId !== "string" || organizationId === "" || organizationId.length > 256) {
          return errorResponse(400, "invalid_request", 'The body must be JSON such as { "organizationId": "…" }.');
        }
        const { session, cookies } = await auth.loadSession(request);
        if (!session) return errorResponse(401, "not_signed_in", "Nobody is signed in.", {}, cookies);
        if (session.organization?.id === organizationId) return jsonResponse(200, { session }, cookies);
        return errorResponse(
          501,
          "organization_switch_unavailable",
          "Qeet ID can't switch an application's organisation: an application's sign-in is always for its own organisation.",
          {},
          cookies,
        );
      }
    }
  } catch (error) {
    if (error instanceof SessionUnavailableError) return errorResponse(503, "session_unavailable", error.message);
    return errorResponse(500, "internal_error", "The session route failed.");
  }
}

/** The session route `pathname` names, or `undefined`. */
function routeOf(pathname: string, routes: SessionRoutes): RouteName | undefined {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  return (Object.keys(routes) as RouteName[]).find((name) => routes[name] === path);
}

/**
 * The CSRF defence for the POST routes (RFC 10017 §6.1.3.3.2): the custom
 * header a cross-site page can't send without a CORS preflight, which these
 * routes never allow; and, where the browser says, a same-site origin.
 */
function csrfRejected(request: Request, origin: string): boolean {
  if (request.headers.get(CSRF_HEADER) !== CSRF_HEADER_VALUE) return true;
  if (request.headers.get("sec-fetch-site") === "cross-site") return true;
  const requestOrigin = request.headers.get("origin");
  return requestOrigin !== null && requestOrigin !== origin;
}

/**
 * The JSON object in the body; `{}` for an empty body unless `required`, and
 * `undefined` for anything that isn't a JSON object sent as `application/json`.
 */
async function readJson(request: Request, required: boolean): Promise<Record<string, unknown> | undefined> {
  const text = await request.text();
  if (text.length > MAX_BODY_LENGTH) return undefined;
  if (text.trim() === "") return required ? undefined : {};
  if (!/^application\/json\s*(;|$)/i.test(request.headers.get("content-type") ?? "")) return undefined;
  try {
    const value: unknown = JSON.parse(text);
    return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
}

function redirectResponse(redirect: AuthRedirect): Response {
  const headers = new Headers({ Location: redirect.location, "Cache-Control": NO_STORE, "Referrer-Policy": "no-referrer" });
  for (const cookie of redirect.cookies) headers.append("Set-Cookie", cookie);
  return new Response(null, { status: 302, headers });
}

function jsonResponse(status: number, body: unknown, cookies: readonly string[] = [], extra: Record<string, string> = {}): Response {
  const headers = new Headers({ "Content-Type": "application/json", "Cache-Control": NO_STORE, ...extra });
  for (const cookie of cookies) headers.append("Set-Cookie", cookie);
  return new Response(JSON.stringify(body), { status, headers });
}

function errorResponse(
  status: number,
  code: SessionErrorCode | "not_found",
  message: string,
  extra: Record<string, string> = {},
  cookies: readonly string[] = [],
): Response {
  return jsonResponse(status, { error: { code, message } }, cookies, extra);
}

function csrfResponse(): Response {
  return errorResponse(
    403,
    "csrf_rejected",
    `A POST to a session route must carry ${CSRF_HEADER}: ${CSRF_HEADER_VALUE} and come from this site.`,
  );
}
