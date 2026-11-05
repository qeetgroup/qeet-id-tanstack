/**
 * The `beforeLoad` guard for pages only signed-in people may see.
 */

import { QeetIDError } from "@qeet-id/react";
import { type ParsedLocation, redirect } from "@tanstack/react-router";
import { AUTH_ERROR_PARAMETER, DEFAULT_BASE_PATH, SIGN_IN_PARAMETERS, type Session, sessionRoutes } from "../contract.js";
import { getSession } from "./server-functions.js";

/** Options of `requireSession`. */
export interface RequireSessionOptions {
  /** Where the session routes live; the same as `QEET_ID_BASE_PATH`. Default `/auth`. */
  basePath?: string;
}

/** What the guard reads of the route's location. */
export type GuardLocation = Pick<ParsedLocation, "href" | "searchStr">;

/**
 * A `beforeLoad` that lets signed-in people through, adding `session` to the
 * route's context, and sends anyone else to sign in, coming back to the page
 * they asked for.
 *
 * When the page is the one a failed sign-in came back to (it carries
 * `?authError=`), the guard throws a `QeetIDError` with that code instead of
 * sending the browser to sign in again, which would loop. Show it with the
 * route's `errorComponent`.
 *
 * ```ts
 * export const Route = createFileRoute("/_signed-in")({
 *   beforeLoad: requireSession(),
 * });
 * ```
 *
 * It protects the page, not the data: protect server functions with
 * `requireSessionMiddleware` too.
 */
export function requireSession(
  options: RequireSessionOptions = {},
): (context: { location: GuardLocation }) => Promise<{ session: Session }> {
  const routes = sessionRoutes(options.basePath ?? DEFAULT_BASE_PATH);
  return async ({ location }) => {
    const session = await getSession();
    if (session) return { session };
    const failed = new URLSearchParams(location.searchStr).get(AUTH_ERROR_PARAMETER);
    if (failed) throw new QeetIDError(`Signing in didn't succeed (${failed}).`, { code: failed, status: 401 });
    const query = new URLSearchParams({ [SIGN_IN_PARAMETERS.returnTo]: location.href });
    // A full page load: the session routes are server routes, not pages of the router.
    throw redirect({ href: `${routes.signIn}?${query}`, reloadDocument: true });
  };
}
