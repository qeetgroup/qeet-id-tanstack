/**
 * `@qeet-id/react`'s provider, wired to this package's routes and to the
 * session the server rendered with.
 */

import { QeetIDProvider as BaseQeetIDProvider, type QeetIDProviderProps } from "@qeet-id/react";
import { useRouteContext } from "@tanstack/react-router";
import { createElement, type ReactElement } from "react";
import { DEFAULT_BASE_PATH, type Session } from "../contract.js";

export type { QeetIDProviderProps };

/**
 * `@qeet-id/react`'s `QeetIDProvider` for a TanStack Start app. Put it in the
 * root route's component.
 *
 * Without an `initialSession` prop it uses the router context's `session`,
 * which the root route's `beforeLoad` puts there, so the server-rendered page
 * and the first client render already know who is signed in: no flash, no
 * hydration mismatch, no extra request.
 *
 * ```tsx
 * export const Route = createRootRoute({
 *   beforeLoad: async () => ({ session: await getSession() }),
 *   component: () => (
 *     <QeetIDProvider>
 *       <Outlet />
 *     </QeetIDProvider>
 *   ),
 * });
 * ```
 */
export function QeetIDProvider(props: QeetIDProviderProps): ReactElement {
  const context: unknown = useRouteContext({ strict: false });
  const fromRouter =
    typeof context === "object" && context !== null && "session" in context
      ? (context as { session: Session | null | undefined }).session
      : undefined;
  return createElement(BaseQeetIDProvider, {
    ...props,
    basePath: props.basePath ?? DEFAULT_BASE_PATH,
    initialSession: props.initialSession !== undefined ? props.initialSession : fromRouter,
  });
}
