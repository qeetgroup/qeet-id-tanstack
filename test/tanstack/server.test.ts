import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QeetIDAuth } from "../../src/core/auth.js";
import { loadConfig } from "../../src/core/config.js";
import { ConfigurationError, NotSignedInError } from "../../src/core/errors.js";
import { getQeetIDAuth, setQeetIDAuth } from "../../src/tanstack/runtime.js";
import { API_KEY, CookieJar, PERSON, createMockQeetId, testEnv } from "../helpers/qeet-id.js";

// TanStack Start's request helpers, as the Start server provides them inside a request.
const start = vi.hoisted(() => ({
  request: undefined as Request | undefined,
  headers: [] as Array<[string, string | string[]]>,
}));
vi.mock("@tanstack/react-start/server", () => ({
  getRequest: () => {
    if (!start.request) throw new Error("outside a request");
    return start.request;
  },
  setResponseHeader: (name: string, value: string) => start.headers.push([`set:${name}`, value]),
  appendResponseHeader: (name: string, value: string | string[]) => start.headers.push([`append:${name}`, value]),
}));

const bodies = await import("../../src/tanstack/server-bodies.js");
const helpers = await import("../../src/tanstack/server-helpers.js");
const { sessionMiddleware, requireSessionMiddleware } = await import("../../src/tanstack/middleware.js");

async function setup(env: Record<string, string | undefined> = {}) {
  const mock = await createMockQeetId();
  let offset = 0;
  const auth = new QeetIDAuth(loadConfig(testEnv(env)), { fetch: mock.fetch, now: () => Date.now() + offset, logger: {} });
  setQeetIDAuth(auth);
  const jar = new CookieJar();
  const begin = await auth.startSignIn("/invoices");
  jar.apply(begin.cookies);
  const signIn = async () => jar.apply((await auth.finishSignIn(jar.request(mock.authorize(begin.location)))).cookies);
  return { mock, auth, jar, signIn, advance: (ms: number) => (offset += ms) };
}

beforeEach(() => {
  start.request = undefined;
  start.headers = [];
});
afterEach(() => {
  setQeetIDAuth(undefined);
  vi.unstubAllEnvs();
});

describe("the runtime", () => {
  it("is made from the environment once, and reports a bad configuration every time", () => {
    for (const [name, value] of Object.entries(testEnv())) vi.stubEnv(name, value);
    const first = getQeetIDAuth();
    expect(getQeetIDAuth()).toBe(first);
    expect(first.config.clientId).toBe("app_brightleaf_console");
    setQeetIDAuth(undefined);
    vi.stubEnv("QEET_ID_CLIENT_SECRET", "");
    expect(() => getQeetIDAuth()).toThrow(ConfigurationError);
    expect(() => getQeetIDAuth()).toThrow(/QEET_ID_CLIENT_SECRET is required/);
  });
});

describe("reading the session in a request", () => {
  it("answers null when signed out, and marks the response no-store", async () => {
    const { jar } = await setup();
    start.request = jar.request("/");
    expect(await bodies.readSession()).toBeNull();
    expect(start.headers).toEqual([["set:Cache-Control", "no-store"]]);
  });

  it("doesn't read the session on the session routes, which set their own cookies", async () => {
    const { jar, signIn, advance, mock } = await setup();
    await signIn();
    advance(9.5 * 60 * 1000);
    for (const path of ["/auth/sign-out", "/auth"]) {
      start.request = jar.request(path, { method: "POST" });
      expect(await bodies.readSession()).toBeNull();
    }
    expect(start.headers).toEqual([]);
    expect(mock.callsTo("/v1/oauth/token-code")).toHaveLength(1);
    start.request = jar.request("/authors");
    expect((await bodies.readSession())?.user.id).toBe(PERSON.sub);
  });

  it("answers the session, and sets a renewed cookie on the response once", async () => {
    const { jar, signIn, advance } = await setup();
    await signIn();
    advance(9.5 * 60 * 1000);
    start.request = jar.request("/invoices");
    const session = await bodies.readSession();
    expect(session?.user.id).toBe(PERSON.sub);
    await bodies.readSession();
    expect(start.headers).toEqual([
      ["set:Cache-Control", "no-store"],
      ["append:Set-Cookie", [expect.stringMatching(/^__Host-qeet-id-session=/)]],
    ]);
  });
});

describe("server helpers", () => {
  it("getAccessToken answers the session's access token, or throws NotSignedInError", async () => {
    const { jar, signIn } = await setup();
    start.request = jar.request("/");
    await expect(helpers.getAccessToken()).rejects.toBeInstanceOf(NotSignedInError);
    await signIn();
    start.request = jar.request("/");
    expect(await helpers.getAccessToken()).toMatch(/^eyJ/);
  });

  it("checkPermission asks Qeet ID with the API key", async () => {
    const { jar, signIn } = await setup({ QEET_ID_API_KEY: API_KEY });
    await signIn();
    start.request = jar.request("/");
    expect(await helpers.checkPermission("invoice.approve")).toBe(true);
    expect(await helpers.checkPermission("invoice.void")).toBe(false);
  });

  it("getQeetIDClient answers the configured @qeet-id/node client", async () => {
    const { auth } = await setup();
    expect(helpers.getQeetIDClient()).toBe(auth.oidc.api);
  });

  it("authRouteHandlers answers every method through the session routes", async () => {
    const { jar } = await setup();
    const session = await helpers.authRouteHandlers.ANY({ request: jar.request("/auth/session") });
    expect(await session.json()).toEqual({ session: null });
    const wrong = await helpers.authRouteHandlers.ANY({ request: jar.request("/auth/session", { method: "PUT" }) });
    expect(wrong.status).toBe(405);
  });
});

describe("the middleware", () => {
  const run = async (middleware: { options: { server?: unknown } }, handlerType: "serverFn" | "router") => {
    const next = vi.fn(async (options?: { context?: unknown }) => ({ response: new Response("ok"), context: options?.context }));
    const server = middleware.options.server as (options: unknown) => Promise<unknown>;
    return { result: await server({ next, handlerType, request: start.request, pathname: "/", context: {} }), next };
  };

  it("sessionMiddleware adds the session, or null, to the context", async () => {
    const { jar, signIn } = await setup();
    start.request = jar.request("/");
    expect((await run(sessionMiddleware, "router")).next).toHaveBeenCalledWith({ context: { session: null } });
    await signIn();
    start.request = jar.request("/");
    const { next } = await run(sessionMiddleware, "serverFn");
    expect(next.mock.calls[0]?.[0]?.context).toMatchObject({ session: { user: { id: PERSON.sub } } });
  });

  it("requireSessionMiddleware refuses a signed-out server route with 401 and a server function with NotSignedInError", async () => {
    const { jar, signIn } = await setup();
    start.request = jar.request("/api/invoices");
    const { result, next } = await run(requireSessionMiddleware, "router");
    expect(next).not.toHaveBeenCalled();
    const response = result as Response;
    expect(response.status).toBe(401);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(((await response.json()) as { error: { code: string } }).error.code).toBe("not_signed_in");
    await expect(run(requireSessionMiddleware, "serverFn")).rejects.toBeInstanceOf(NotSignedInError);
    await signIn();
    start.request = jar.request("/api/invoices");
    const signedIn = await run(requireSessionMiddleware, "serverFn");
    expect(signedIn.next.mock.calls[0]?.[0]?.context).toMatchObject({ session: { organization: { id: PERSON.tenant_id } } });
  });
});
