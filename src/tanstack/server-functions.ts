/**
 * The session as a TanStack Start server function: in a loader or
 * `beforeLoad` it runs directly on the server while rendering, and through
 * an RPC on a client-side navigation.
 */

import { createServerFn } from "@tanstack/react-start";
import type { Session } from "../contract.js";

/**
 * The signed-in person, or `null`. Renews the access token when it is close
 * to expiry. Use it in loaders, `beforeLoad` and server code; never a source
 * of truth for what someone may do (see `checkPermission`).
 *
 * ```ts
 * export const Route = createRootRoute({
 *   beforeLoad: async () => ({ session: await getSession() }),
 * });
 * ```
 *
 * @throws {SessionUnavailableError} when the access token has expired and Qeet ID can't be reached to renew it.
 */
export const getSession: (options?: { signal?: AbortSignal }) => Promise<Session | null> = createServerFn({ method: "GET" }).handler(
  async () => {
    const { readSession } = await import("./server-bodies.js");
    return readSession();
  },
);
