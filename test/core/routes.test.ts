import { parseSession } from "@qeet-id/react/contract";
import { describe, expect, it } from "vitest";
import { QeetIDAuth } from "../../src/core/auth.js";
import { loadConfig } from "../../src/core/config.js";
import { handleAuthRequest } from "../../src/core/routes.js";
import { BASE_URL, CookieJar, ORIGIN, PERSON, createMockQeetId, testEnv } from "../helpers/qeet-id.js";

const POST_HEADERS = { "X-Qeet-ID-Request": "1", "Content-Type": "application/json", Origin: ORIGIN, "Sec-Fetch-Site": "same-origin" };

async function setup(env: Record<string, string | undefined> = {}) {
  const mock = await createMockQeetId();
  let offset = 0;
  const auth = new QeetIDAuth(loadConfig(testEnv(env)), { fetch: mock.fetch, now: () => Date.now() + offset, logger: {} });
  const jar = new CookieJar();
  const call = async (path: string, init: RequestInit = {}) => {
    const response = await handleAuthRequest(auth, jar.request(path, init));
    jar.applyResponse(response);
    return response;
  };
  const signIn = async (returnTo = "/invoices") => {
    const start = await call(`/auth/sign-in?returnTo=${encodeURIComponent(returnTo)}`);
    return call(mock.authorize(start.headers.get("location")!));
  };
  return { mock, auth, jar, call, signIn, advance: (ms: number) => (offset += ms) };
}

async function errorOf(response: Response) {
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(response.headers.get("content-type")).toBe("application/json");
  return ((await response.json()) as { error: { code: string; message: string } }).error;
}

describe("GET {base}/sign-in and {base}/sign-up", () => {
  it("redirect to Qeet ID's authorization endpoint with a sign-in cookie", async () => {
    const { call } = await setup();
    for (const route of ["sign-in", "sign-up"]) {
      const response = await call(`/auth/${route}?returnTo=%2Finvoices&organization=org_1&loginHint=meera%40brightleaffoods.in`);
      expect(response.status).toBe(302);
      expect(response.headers.get("location")).toMatch(new RegExp(`^${BASE_URL}/v1/oauth/authorize\\?`));
      // organization and loginHint are reserved: Qeet ID's authorize endpoint takes neither.
      expect(response.headers.get("location")).not.toMatch(/organization|login_hint/);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(response.headers.get("referrer-policy")).toBe("no-referrer");
      expect(response.headers.getSetCookie()[0]).toMatch(/^__Host-qeet-id-signin\./);
      expect(response.headers.get("access-control-allow-origin")).toBeNull();
    }
  });
});

describe("GET {base}/callback", () => {
  it("stores the session and redirects to the saved path", async () => {
    const { signIn, jar } = await setup();
    const response = await signIn("/invoices?status=due");
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("/invoices?status=due");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(jar.cookies.has("__Host-qeet-id-session")).toBe(true);
  });

  it("redirects with authError when the sign-in fails", async () => {
    const { call } = await setup();
    const response = await call("/auth/callback?code=x&state=y");
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("/?authError=invalid_state");
  });
});

describe("GET {base}/session", () => {
  it("answers { session: null } when signed out, never 401", async () => {
    const { call } = await setup();
    const response = await call("/auth/session", { headers: { "X-Qeet-ID-Request": "1" } });
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ session: null });
  });

  it("answers the contract's Session, without a token", async () => {
    const { call, signIn } = await setup();
    await signIn();
    const response = await call("/auth/session");
    const body = (await response.json()) as { session: unknown };
    expect(parseSession(body.session)).toEqual(body.session);
    expect(body.session).toMatchObject({ user: { id: PERSON.sub, email: PERSON.email }, organization: { id: PERSON.tenant_id } });
    expect(JSON.stringify(body)).not.toMatch(/eyJ|rt_/);
  });

  it("renews near expiry and sets the new cookie", async () => {
    const { call, signIn, advance } = await setup();
    await signIn();
    advance(9.5 * 60 * 1000);
    const response = await call("/auth/session");
    expect(response.status).toBe(200);
    expect(response.headers.getSetCookie()[0]).toMatch(/^__Host-qeet-id-session=/);
  });

  it("clears an ended session and answers null", async () => {
    const { call, signIn, advance, mock, jar } = await setup();
    await signIn();
    for (const grant of mock.grants.values()) grant.revoked = true;
    advance(9.5 * 60 * 1000);
    const response = await call("/auth/session");
    expect(await response.json()).toEqual({ session: null });
    expect(jar.cookies.size).toBe(0);
  });

  it("answers 503 session_unavailable when Qeet ID can't be reached to renew", async () => {
    const { call, signIn, advance, mock } = await setup();
    await signIn();
    advance(11 * 60 * 1000);
    mock.state.down = true;
    const response = await call("/auth/session");
    expect(response.status).toBe(503);
    expect((await errorOf(response)).code).toBe("session_unavailable");
  });
});

describe("POST {base}/sign-out", () => {
  it("answers { redirectTo } and clears the session", async () => {
    const { call, signIn, jar } = await setup();
    await signIn();
    const response = await call("/auth/sign-out", {
      method: "POST",
      headers: POST_HEADERS,
      body: JSON.stringify({ returnTo: "/goodbye" }),
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const { redirectTo } = (await response.json()) as { redirectTo: string };
    expect(redirectTo).toMatch(new RegExp(`^${BASE_URL}/v1/oauth/logout\\?id_token_hint=`));
    expect(new URL(redirectTo).searchParams.get("post_logout_redirect_uri")).toBe(`${ORIGIN}/goodbye`);
    expect(jar.cookies.size).toBe(0);
  });

  it("is idempotent: with no session it still answers 200", async () => {
    const { call } = await setup();
    const empty = await call("/auth/sign-out", { method: "POST", headers: { "X-Qeet-ID-Request": "1" } });
    expect(await empty.json()).toEqual({ redirectTo: "/" });
  });

  it("refuses a body that isn't the route's JSON", async () => {
    const { call } = await setup();
    for (const [body, contentType] of [
      ["returnTo=/x", "application/x-www-form-urlencoded"],
      ["{not json", "application/json"],
      ['["/x"]', "application/json"],
      ['{"returnTo": 5}', "application/json"],
      [JSON.stringify({ returnTo: "x".repeat(20_000) }), "application/json"],
    ] as const) {
      const response = await call("/auth/sign-out", { method: "POST", headers: { ...POST_HEADERS, "Content-Type": contentType }, body });
      expect(response.status).toBe(400);
      expect((await errorOf(response)).code).toBe("invalid_request");
    }
  });
});

describe("POST {base}/switch-organization", () => {
  const body = (organizationId: unknown) => JSON.stringify({ organizationId });

  it("answers 401 not_signed_in without a session", async () => {
    const { call } = await setup();
    const response = await call("/auth/switch-organization", { method: "POST", headers: POST_HEADERS, body: body("org_1") });
    expect(response.status).toBe(401);
    expect((await errorOf(response)).code).toBe("not_signed_in");
  });

  it("answers the session for the organisation it is already in", async () => {
    const { call, signIn } = await setup();
    await signIn();
    const response = await call("/auth/switch-organization", { method: "POST", headers: POST_HEADERS, body: body(PERSON.tenant_id) });
    expect(response.status).toBe(200);
    expect(((await response.json()) as { session: { organization: { id: string } } }).session.organization.id).toBe(PERSON.tenant_id);
  });

  it("answers 501 organization_switch_unavailable for any other: Qeet ID can't switch an application's organisation", async () => {
    const { call, signIn } = await setup();
    await signIn();
    const response = await call("/auth/switch-organization", { method: "POST", headers: POST_HEADERS, body: body("another-org") });
    expect(response.status).toBe(501);
    expect((await errorOf(response)).code).toBe("organization_switch_unavailable");
  });

  it("refuses a missing or malformed organizationId", async () => {
    const { call, signIn } = await setup();
    await signIn();
    for (const bad of [body(""), body(7), body("x".repeat(300)), "", "{}"]) {
      const response = await call("/auth/switch-organization", { method: "POST", headers: POST_HEADERS, body: bad });
      expect(response.status).toBe(400);
    }
  });
});

describe("the CSRF defence on POST routes", () => {
  it.each([
    ["no X-Qeet-ID-Request header", { "Content-Type": "application/json" }],
    ["the wrong header value", { "X-Qeet-ID-Request": "true" }],
    ["Sec-Fetch-Site: cross-site", { "X-Qeet-ID-Request": "1", "Sec-Fetch-Site": "cross-site" }],
    ["another Origin", { "X-Qeet-ID-Request": "1", Origin: "https://evil.example" }],
    ["Origin: null", { "X-Qeet-ID-Request": "1", Origin: "null" }],
  ])("answers 403 csrf_rejected with %s, and changes nothing", async (_, headers) => {
    const { call, signIn, jar, mock } = await setup();
    await signIn();
    for (const route of ["/auth/sign-out", "/auth/switch-organization"]) {
      const response = await call(route, { method: "POST", headers, body: JSON.stringify({ organizationId: "x" }) });
      expect(response.status).toBe(403);
      expect((await errorOf(response)).code).toBe("csrf_rejected");
    }
    expect(jar.cookies.has("__Host-qeet-id-session")).toBe(true);
    expect(mock.callsTo("/oauth/revoke")).toHaveLength(0);
  });

  it("accepts same-site requests and requests without Origin or Sec-Fetch-Site", async () => {
    const { call } = await setup();
    for (const headers of [{ "X-Qeet-ID-Request": "1", "Sec-Fetch-Site": "same-site" }, { "X-Qeet-ID-Request": "1" }] as Record<
      string,
      string
    >[]) {
      expect((await call("/auth/sign-out", { method: "POST", headers })).status).toBe(200);
    }
  });
});

describe("methods and paths", () => {
  it.each([
    ["/auth/sign-in", "POST", "GET"],
    ["/auth/sign-up", "DELETE", "GET"],
    ["/auth/callback", "POST", "GET"],
    ["/auth/session", "POST", "GET"],
    ["/auth/sign-out", "GET", "POST"],
    ["/auth/switch-organization", "GET", "POST"],
    ["/auth/sign-out", "OPTIONS", "POST"],
  ])("%s answers %s with 405 and Allow: %s", async (path, method, allow) => {
    const { call } = await setup();
    const response = await call(path, { method, headers: { "X-Qeet-ID-Request": "1" } });
    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe(allow);
    expect(response.headers.get("access-control-allow-origin")).toBeNull();
    expect((await errorOf(response)).code).toBe("method_not_allowed");
  });

  it("answers 404 for any other path under the base path", async () => {
    const { call } = await setup();
    expect((await call("/auth/nothing")).status).toBe(404);
  });

  it("serves a custom base path, with or without a trailing slash", async () => {
    const { call } = await setup({ QEET_ID_BASE_PATH: "/account/auth", QEET_ID_REDIRECT_URI: `${ORIGIN}/account/auth/callback` });
    expect((await call("/account/auth/session/")).status).toBe(200);
    expect((await call("/auth/session")).status).toBe(404);
  });

  it("answers 500 internal_error without detail when something unexpected fails", async () => {
    const { auth } = await setup();
    const broken = Object.create(auth, { loadSession: { value: () => Promise.reject(new Error("secret detail")) } }) as QeetIDAuth;
    const response = await handleAuthRequest(broken, new Request(`${ORIGIN}/auth/session`));
    expect(response.status).toBe(500);
    const error = await errorOf(response);
    expect(error.code).toBe("internal_error");
    expect(error.message).not.toContain("secret detail");
  });
});
