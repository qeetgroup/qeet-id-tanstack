/**
 * Request middleware for server routes and server functions.
 *
 * ```ts
 * export const listInvoices = createServerFn()
 *   .middleware([requireSessionMiddleware])
 *   .handler(async ({ context }) => invoicesFor(context.session.organization?.id));
 * ```
 */

import type { Register } from "@tanstack/react-router";
import { createMiddleware, type RequestMiddlewareAfterServer } from "@tanstack/react-start";
import type { Session } from "../contract.js";

/**
 * Adds `context.session`: the signed-in person, or `null`. Renews the access
 * token when it is close to expiry. Also fits `requestMiddleware` in
 * `src/start.ts`, to read the session once for every request.
 */
export const sessionMiddleware: RequestMiddlewareAfterServer<Register, undefined, { session: Session | null }> = createMiddleware().server(
  async ({ next }) => {
    const { readSession } = await import("./server-bodies.js");
    return next({ context: { session: await readSession() } });
  },
);

/**
 * Adds `context.session`, never `null`: a signed-out request is refused, a
 * server function with `NotSignedInError` and a server route with a 401
 * `{ "error": { "code": "not_signed_in" } }`. Protect every server function
 * and server route that reads or changes private data with it: a
 * `beforeLoad` guard protects the page, not the data.
 */
export const requireSessionMiddleware: RequestMiddlewareAfterServer<Register, undefined, { session: Session }> = createMiddleware().server(
  async ({ next, handlerType }) => {
    const { readSession, signedOutAnswer } = await import("./server-bodies.js");
    const session = await readSession();
    if (session === null) return signedOutAnswer(handlerType);
    return next({ context: { session } });
  },
);
