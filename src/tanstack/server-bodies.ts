/**
 * What the server functions, middleware and helpers do on the server. Loaded
 * only through dynamic imports inside their server-side bodies, which the
 * TanStack Start compiler removes from the client build, so none of this (or
 * `@qeet-id/node`) reaches the browser.
 */

import { appendResponseHeader, getRequest, setResponseHeader } from "@tanstack/react-start/server";
import { CSRF_HEADER, type Session } from "../contract.js";
import type { LoadedSession } from "../core/auth.js";
import { NotSignedInError } from "../core/errors.js";
import { handleAuthRequest } from "../core/routes.js";
import { getQeetIDAuth } from "./runtime.js";

/** What middleware sees on a session route. */
const NOT_READ: LoadedSession = Object.freeze({ session: null, tokens: null, cookies: Object.freeze([]) });

/** Requests whose response already carries the session's cookies. */
const applied = new WeakSet<Request>();

/**
 * The current request's session. The first read in a request marks the
 * response `Cache-Control: no-store` (it shows one person's data) and sets the
 * cookies a renewal or an ended session needs.
 */
export async function loadCurrentSession(): Promise<LoadedSession> {
  const request = getRequest();
  const auth = getQeetIDAuth();
  // The session routes manage the cookies themselves: a renewal here could undo a sign-out's.
  if (auth.isSessionRoute(request)) return NOT_READ;
  const loaded = await auth.loadSession(request);
  if (!applied.has(request)) {
    applied.add(request);
    setResponseHeader("Cache-Control", "no-store");
    if (loaded.cookies.length > 0) appendResponseHeader("Set-Cookie", [...loaded.cookies]);
  }
  return loaded;
}

/** The current request's `Session`, or `null`. */
export async function readSession(): Promise<Session | null> {
  return (await loadCurrentSession()).session;
}

/** The current session's access token. */
export async function readAccessToken(): Promise<string> {
  const { tokens } = await loadCurrentSession();
  if (!tokens) throw new NotSignedInError();
  return tokens.accessToken;
}

/** Whether the signed-in person holds `permission`, asked of Qeet ID now. */
export async function askPermission(permission: string): Promise<boolean> {
  await loadCurrentSession();
  return getQeetIDAuth().checkPermission(getRequest(), permission);
}

/** Answers a request to a session route. */
export function answerSessionRoute(request: Request): Promise<Response> {
  return handleAuthRequest(getQeetIDAuth(), request);
}

/** The answer to a signed-out request: `NotSignedInError` for a server function, a 401 for anything else. */
export function signedOutAnswer(handlerType: "serverFn" | "router"): Response {
  if (handlerType === "serverFn") throw new NotSignedInError();
  return Response.json(
    { error: { code: "not_signed_in", message: `Nobody is signed in. Sign in, then call this with ${CSRF_HEADER} as before.` } },
    { status: 401, headers: { "Cache-Control": "no-store" } },
  );
}
