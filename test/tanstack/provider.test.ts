import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTestSession } from "../helpers/session.js";

const seen = vi.hoisted(() => ({ props: undefined as Record<string, unknown> | undefined, context: {} as unknown }));
vi.mock("@qeet-id/react", () => ({
  QeetIDProvider: (props: Record<string, unknown>) => {
    seen.props = props;
    return props.children ?? null;
  },
}));
vi.mock("@tanstack/react-router", () => ({ useRouteContext: () => seen.context }));
const { QeetIDProvider } = await import("../../src/tanstack/provider.js");

const render = (props: Record<string, unknown> = {}) => renderToString(createElement(QeetIDProvider, props, "app"));

beforeEach(() => {
  seen.props = undefined;
  seen.context = {};
});

describe("QeetIDProvider", () => {
  it("passes the session the root route's beforeLoad put in the router context", () => {
    const session = createTestSession();
    seen.context = { session, other: 1 };
    expect(render()).toBe("app");
    expect(seen.props).toMatchObject({ basePath: "/auth", initialSession: session });
  });

  it("passes null for a server render with nobody signed in", () => {
    seen.context = { session: null };
    render();
    expect(seen.props?.initialSession).toBeNull();
  });

  it("leaves initialSession out when the router context has no session, so the provider asks the server", () => {
    seen.context = {};
    render();
    expect(seen.props?.initialSession).toBeUndefined();
  });

  it("prefers the props it is given", () => {
    seen.context = { session: createTestSession() };
    render({ initialSession: null, basePath: "/account/auth", syncTabs: false });
    expect(seen.props).toMatchObject({ initialSession: null, basePath: "/account/auth", syncTabs: false });
  });
});
