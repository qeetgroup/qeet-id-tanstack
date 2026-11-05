import { describe, expect, it } from "vitest";
import { QeetIDAuth } from "../../src/core/auth.js";
import { loadConfig } from "../../src/core/config.js";
import { ConfigurationError, NotSignedInError, SessionUnavailableError } from "../../src/core/errors.js";
import {
  API_KEY,
  BASE_URL,
  CLIENT_ID,
  CLIENT_SECRET,
  CookieJar,
  ISSUER,
  type MockQeetIdOptions,
  ORIGIN,
  PERSON,
  REDIRECT_URI,
  createMockQeetId,
  testEnv,
} from "../helpers/qeet-id.js";

const MINUTE = 60 * 1000;

async function setup(options: { env?: Record<string, string | undefined>; mock?: MockQeetIdOptions } = {}) {
  const mock = await createMockQeetId(options.mock);
  let offset = 0;
  const warnings: Array<[string, unknown]> = [];
  const auth = new QeetIDAuth(loadConfig(testEnv(options.env)), {
    fetch: mock.fetch,
    now: () => Date.now() + offset,
    logger: { warn: (message, context) => warnings.push([message, context]) },
  });
  const jar = new CookieJar();
  async function signIn(returnTo: unknown = "/invoices") {
    const start = await auth.startSignIn(returnTo);
    jar.apply(start.cookies);
    const done = await auth.finishSignIn(jar.request(mock.authorize(start.location)));
    jar.apply(done.cookies);
    return done;
  }
  return {
    mock,
    auth,
    jar,
    warnings,
    signIn,
    advance(ms: number) {
      offset += ms;
    },
  };
}

describe("signing in", () => {
  it("sends the browser to Qeet ID with PKCE S256, state and nonce", async () => {
    const { auth } = await setup();
    const { location, cookies } = await auth.startSignIn("/invoices?status=due");
    const url = new URL(location);
    expect(`${url.origin}${url.pathname}`).toBe(`${BASE_URL}/v1/oauth/authorize`);
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      response_type: "code",
      client_id: CLIENT_ID,
      redirect_uri: REDIRECT_URI,
      scope: "openid email profile",
      code_challenge_method: "S256",
    });
    expect(url.searchParams.get("state")).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(url.searchParams.get("nonce")).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(url.searchParams.get("code_challenge")).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(url.searchParams.has("client_secret")).toBe(false);
    expect(cookies).toHaveLength(1);
    expect(cookies[0]).toMatch(
      new RegExp(`^__Host-qeet-id-signin\\.${url.searchParams.get("state")}=[^;]+; Path=/; Max-Age=600; HttpOnly; SameSite=Lax; Secure$`),
    );
    // Nothing readable in the sign-in cookie.
    expect(cookies[0]).not.toContain(url.searchParams.get("nonce"));
  });

  it("completes at the callback and returns to the saved path", async () => {
    const { mock, jar, signIn, auth } = await setup();
    const done = await signIn("/invoices?status=due#top");
    expect(done.location).toBe("/invoices?status=due#top");
    expect([...jar.cookies.keys()]).toEqual(["__Host-qeet-id-session"]);
    expect(jar.setCookies.at(-2)).toMatch(/^__Host-qeet-id-signin\.[^=]+=; Path=\/; Max-Age=0/);
    expect(jar.setCookies.at(-1)).toMatch(/^__Host-qeet-id-session=[^;]+; Path=\/; Max-Age=2592000; HttpOnly; SameSite=Lax; Secure$/);

    const [exchange] = mock.callsTo("/v1/oauth/token-code");
    expect(exchange?.form).toMatchObject({
      grant_type: "authorization_code",
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      redirect_uri: REDIRECT_URI,
    });
    expect(exchange?.form?.code_verifier).toMatch(/^[A-Za-z0-9_-]{43}$/);

    const { session, tokens } = await auth.loadSession(jar.request("/"));
    expect(session).toEqual({
      user: { id: PERSON.sub, email: PERSON.email, emailVerified: true, name: PERSON.name, picture: PERSON.picture },
      organization: { id: PERSON.tenant_id, name: null },
      roles: [],
      permissions: [],
      expiresAt: expect.any(String),
    });
    expect(Date.parse(session!.expiresAt) - Date.now()).toBeGreaterThan(29 * 24 * 60 * MINUTE);
    expect(tokens?.accessToken).toMatch(/^ey/);
    // The session cookie holds no token in the clear.
    expect(jar.header()).not.toContain(tokens!.accessToken.slice(0, 40));
  });

  it("maps missing claims to null, as the contract says", async () => {
    const { mock, jar, signIn, auth } = await setup();
    mock.setPerson({ sub: PERSON.sub, tenant_id: PERSON.tenant_id });
    await signIn();
    const { session } = await auth.loadSession(jar.request("/"));
    expect(session?.user).toEqual({ id: PERSON.sub, email: null, emailVerified: false, name: null, picture: null });
  });

  it.each([
    "https://evil.example/",
    "//evil.example/",
    "/\\evil.example",
    "javascript:alert(1)",
    "https://user:pass@app.brightleaffoods.in/",
    "",
    null,
    42,
  ])("returns to / for an unsafe returnTo (%s)", async (returnTo) => {
    const { signIn } = await setup();
    expect((await signIn(returnTo)).location).toBe("/");
  });

  it("accepts a same-origin absolute URL as a return path", async () => {
    const { signIn } = await setup();
    expect((await signIn(`${ORIGIN}/reports?q=1`)).location).toBe("/reports?q=1");
  });

  it("lets sign-ins in two tabs both complete", async () => {
    const { mock, auth, jar } = await setup();
    const first = await auth.startSignIn("/first");
    const second = await auth.startSignIn("/second");
    jar.apply(first.cookies).apply(second.cookies);
    const firstDone = await auth.finishSignIn(jar.request(mock.authorize(first.location)));
    const secondDone = await auth.finishSignIn(jar.request(mock.authorize(second.location)));
    expect(firstDone.location).toBe("/first");
    expect(secondDone.location).toBe("/second");
  });

  it("refuses a callback this browser didn't start", async () => {
    const { mock, auth, jar } = await setup();
    const start = await auth.startSignIn("/invoices");
    const callback = mock.authorize(start.location);
    // No sign-in cookie: another browser's callback.
    expect((await auth.finishSignIn(jar.request(callback))).location).toBe("/?authError=invalid_state");
    // A sign-in cookie, but the state is another one.
    jar.apply(start.cookies);
    const forged = new URL(callback);
    forged.searchParams.set("state", "A".repeat(43));
    expect((await auth.finishSignIn(jar.request(forged.toString()))).location).toBe("/?authError=invalid_state");
    forged.searchParams.set("state", "not a state");
    expect((await auth.finishSignIn(jar.request(forged.toString()))).location).toBe("/?authError=invalid_state");
    expect(mock.callsTo("/v1/oauth/token-code")).toHaveLength(0);
  });

  it("refuses a sign-in that took longer than ten minutes", async () => {
    const { mock, auth, jar, advance } = await setup();
    const start = await auth.startSignIn("/invoices");
    jar.apply(start.cookies);
    advance(11 * MINUTE);
    const done = await auth.finishSignIn(jar.request(mock.authorize(start.location)));
    expect(done.location).toBe("/invoices?authError=invalid_state");
    expect(done.cookies[0]).toMatch(/Max-Age=0/);
  });

  it("passes Qeet ID's error on to the return path", async () => {
    const { auth, jar } = await setup();
    const start = await auth.startSignIn("/invoices?status=due");
    jar.apply(start.cookies);
    const state = new URL(start.location).searchParams.get("state");
    const denied = await auth.finishSignIn(jar.request(`/auth/callback?error=access_denied&state=${state}&iss=${ISSUER}`));
    expect(denied.location).toBe("/invoices?status=due&authError=access_denied");
    const odd = await auth.finishSignIn(jar.request(`/auth/callback?error=%3Cscript%3E&state=${state}`));
    expect(odd.location).toBe("/invoices?status=due&authError=server_error");
  });

  it("refuses an answer from another issuer (RFC 9207)", async () => {
    const { mock, auth, jar } = await setup();
    for (const iss of ["https://evil.example", null]) {
      const start = await auth.startSignIn("/invoices");
      jar.apply(start.cookies);
      const callback = new URL(mock.authorize(start.location));
      if (iss === null) callback.searchParams.delete("iss");
      else callback.searchParams.set("iss", iss);
      expect((await auth.finishSignIn(jar.request(callback.toString()))).location).toBe("/invoices?authError=invalid_state");
    }
    expect(mock.callsTo("/v1/oauth/token-code")).toHaveLength(0);
  });

  it("refuses an ID token whose nonce isn't this sign-in's", async () => {
    const { mock, signIn, jar } = await setup();
    mock.state.idTokenClaims = { nonce: "another-nonce" };
    expect((await signIn()).location).toBe("/invoices?authError=invalid_state");
    expect(jar.cookies.has("__Host-qeet-id-session")).toBe(false);
  });

  it.each([
    [
      "signed with another key",
      async (mock: Awaited<ReturnType<typeof createMockQeetId>>) => {
        mock.state.wrongKey = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
          "sign",
          "verify",
        ])) as CryptoKeyPair;
      },
    ],
    [
      "for another application",
      async (mock: Awaited<ReturnType<typeof createMockQeetId>>) => {
        mock.state.idTokenClaims = { aud: "app_someone_else" };
      },
    ],
    [
      "from another issuer",
      async (mock: Awaited<ReturnType<typeof createMockQeetId>>) => {
        mock.state.idTokenClaims = { iss: "https://evil.example" };
      },
    ],
    [
      "already expired",
      async (mock: Awaited<ReturnType<typeof createMockQeetId>>) => {
        mock.state.idTokenClaims = { exp: Math.floor(Date.now() / 1000) - 3600 };
      },
    ],
  ])("refuses an ID token %s", async (_, arrange) => {
    const { mock, signIn, jar } = await setup();
    await arrange(mock);
    expect((await signIn()).location).toBe("/invoices?authError=session_unavailable");
    expect(jar.cookies.has("__Host-qeet-id-session")).toBe(false);
  });

  it("redeems a code once: a replayed callback fails", async () => {
    const { mock, auth, jar } = await setup();
    const start = await auth.startSignIn("/invoices");
    jar.apply(start.cookies);
    const callback = mock.authorize(start.location);
    const replay = jar.request(callback);
    jar.apply((await auth.finishSignIn(jar.request(callback))).cookies);
    // The sign-in cookie is gone, so the replay is refused before Qeet ID is asked.
    expect((await auth.finishSignIn(jar.request(callback))).location).toBe("/?authError=invalid_state");
    // Even with the old cookie, Qeet ID refuses a spent code.
    expect((await auth.finishSignIn(replay)).location).toBe("/invoices?authError=session_unavailable");
  });

  it("reports a code Qeet ID won't exchange", async () => {
    const { mock, signIn, warnings } = await setup();
    mock.state.tokenError = "invalid_grant";
    expect((await signIn()).location).toBe("/invoices?authError=session_unavailable");
    expect(warnings[0]?.[1]).toEqual({ error: "OAuthError", code: "invalid_grant" });
  });

  it("returns with temporarily_unavailable when Qeet ID can't be reached", async () => {
    const { mock, auth } = await setup();
    mock.state.down = true;
    expect(await auth.startSignIn("/invoices")).toEqual({ location: "/invoices?authError=temporarily_unavailable", cookies: [] });
  });

  it("revokes the session this browser held before", async () => {
    const { mock, signIn, jar } = await setup();
    await signIn();
    const firstSessionCookie = jar.cookies.get("__Host-qeet-id-session");
    const [firstGrant] = [...mock.grants.keys()];
    await signIn();
    expect(jar.cookies.get("__Host-qeet-id-session")).not.toBe(firstSessionCookie);
    expect(mock.callsTo("/oauth/revoke").map((call) => call.form?.token)).toEqual([firstGrant]);
  });

  it("drops the __Host- prefix and Secure on plain http for local development", async () => {
    const { auth } = await setup({ env: { QEET_ID_REDIRECT_URI: "http://localhost:3000/auth/callback" } });
    const { cookies } = await auth.startSignIn("/");
    expect(cookies[0]).toMatch(/^qeet-id-signin\./);
    expect(cookies[0]).not.toMatch(/Secure/);
    expect(auth.sessionCookie).toBe("qeet-id-session");
  });
});

describe("the session", () => {
  it("is null without a cookie, and a tampered cookie is cleared", async () => {
    const { auth, jar, signIn } = await setup();
    expect(await auth.loadSession(jar.request("/"))).toEqual({ session: null, tokens: null, cookies: [] });
    await signIn();
    const sealed = jar.cookies.get("__Host-qeet-id-session")!;
    jar.cookies.set("__Host-qeet-id-session", `${sealed.slice(0, -4)}AAAA`);
    const loaded = await auth.loadSession(jar.request("/"));
    expect(loaded.session).toBeNull();
    expect(loaded.cookies).toEqual(["__Host-qeet-id-session=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax; Secure"]);
  });

  it("is read once per request", async () => {
    const { auth, jar, signIn, advance, mock } = await setup();
    await signIn();
    advance(9.5 * MINUTE);
    const request = jar.request("/");
    const [a, b] = await Promise.all([auth.loadSession(request), auth.loadSession(request)]);
    expect(a).toBe(b);
    expect(mock.callsTo("/v1/oauth/token-code")).toHaveLength(2);
  });

  it("renews the access token in its last minute, and rolls the session forward", async () => {
    const { auth, jar, signIn, advance, mock } = await setup();
    await signIn();
    const before = await auth.loadSession(jar.request("/"));
    expect(before.cookies).toEqual([]);
    advance(9.5 * MINUTE);
    const renewed = await auth.loadSession(jar.request("/"));
    expect(renewed.session?.user.id).toBe(PERSON.sub);
    expect(renewed.tokens?.accessToken).not.toBe(before.tokens?.accessToken);
    expect(renewed.cookies).toHaveLength(1);
    expect(Date.parse(renewed.session!.expiresAt)).toBeGreaterThan(Date.parse(before.session!.expiresAt));
    const refresh = mock.callsTo("/v1/oauth/token-code")[1];
    expect(refresh?.form).toMatchObject({ grant_type: "refresh_token", client_id: CLIENT_ID, client_secret: CLIENT_SECRET });
    jar.apply(renewed.cookies);
    expect((await auth.loadSession(jar.request("/"))).cookies).toEqual([]);
  });

  it("renews once for every request carrying the old refresh token, so Qeet ID never sees it twice", async () => {
    const { auth, jar, signIn, advance, mock } = await setup();
    await signIn();
    advance(9.5 * MINUTE);
    let release!: () => void;
    mock.state.tokenGate = new Promise((resolve) => {
      release = resolve;
    });
    const parallel = [auth.loadSession(jar.request("/a")), auth.loadSession(jar.request("/b")), auth.loadSession(jar.request("/c"))];
    release();
    const results = await Promise.all(parallel);
    mock.state.tokenGate = undefined;
    // A request that left the browser before the new cookie arrived, a little later.
    advance(20 * 1000);
    const late = await auth.loadSession(jar.request("/d"));
    expect(mock.callsTo("/v1/oauth/token-code")).toHaveLength(2);
    const tokens = new Set([...results, late].map((result) => result.tokens?.accessToken));
    expect(tokens.size).toBe(1);
    expect([...mock.grants.values()].some((grant) => grant.revoked)).toBe(false);
  });

  it("ends when Qeet ID refuses the renewal", async () => {
    const { auth, jar, signIn, advance, mock } = await setup();
    await signIn();
    for (const grant of mock.grants.values()) grant.revoked = true;
    advance(9.5 * MINUTE);
    const loaded = await auth.loadSession(jar.request("/"));
    expect(loaded.session).toBeNull();
    expect(loaded.cookies[0]).toMatch(/^__Host-qeet-id-session=; .*Max-Age=0/);
  });

  it("keeps a session whose access token still works when Qeet ID can't renew it yet", async () => {
    const { auth, jar, signIn, advance, mock, warnings } = await setup();
    await signIn();
    advance(9.5 * MINUTE);
    mock.state.tokenUnavailable = true;
    const loaded = await auth.loadSession(jar.request("/"));
    expect(loaded.session?.user.id).toBe(PERSON.sub);
    expect(loaded.cookies).toEqual([]);
    expect(warnings.at(-1)?.[0]).toMatch(/couldn't be renewed yet/);
    mock.state.tokenUnavailable = false;
    expect((await auth.loadSession(jar.request("/"))).cookies).toHaveLength(1);
  });

  it("throws SessionUnavailableError when the access token has expired and Qeet ID can't be reached", async () => {
    const { auth, jar, signIn, advance, mock } = await setup();
    await signIn();
    advance(11 * MINUTE);
    mock.state.down = true;
    await expect(auth.loadSession(jar.request("/"))).rejects.toBeInstanceOf(SessionUnavailableError);
  });

  it("ends with the access token when the application gets no refresh token", async () => {
    const { auth, jar, signIn, advance } = await setup({ mock: { refreshTokens: false } });
    await signIn();
    const { session } = await auth.loadSession(jar.request("/"));
    expect(Date.parse(session!.expiresAt) - Date.now()).toBeLessThanOrEqual(10 * MINUTE);
    advance(9.5 * MINUTE);
    expect((await auth.loadSession(jar.request("/"))).session).not.toBeNull();
    advance(MINUTE);
    expect((await auth.loadSession(jar.request("/"))).session).toBeNull();
  });

  it("ends after QEET_ID_SESSION_MAX_AGE without a renewal", async () => {
    const { auth, jar, signIn, advance } = await setup({ env: { QEET_ID_SESSION_MAX_AGE: "300" }, mock: { accessTtl: 3600 } });
    await signIn();
    advance(4 * MINUTE);
    expect((await auth.loadSession(jar.request("/"))).session).not.toBeNull();
    advance(2 * MINUTE);
    expect((await auth.loadSession(jar.request("/"))).session).toBeNull();
  });

  it("ends, and revokes the new grant, when a renewal names another person", async () => {
    const { auth, jar, signIn, advance, mock } = await setup();
    await signIn();
    mock.setPerson({ ...PERSON, sub: "11111111-2222-4333-8444-555555555555" });
    advance(9.5 * MINUTE);
    expect((await auth.loadSession(jar.request("/"))).session).toBeNull();
    expect(mock.callsTo("/oauth/revoke")).toHaveLength(1);
  });

  it("keeps the previous ID token when Qeet ID's keys can't be fetched at renewal", async () => {
    const { auth, jar, signIn, advance, mock } = await setup();
    await signIn();
    const original = (await auth.loadSession(jar.request("/"))).tokens?.idToken;
    advance(9.5 * MINUTE);
    // The verifier has the keys cached; a token naming an unknown key makes it fetch again, and that fails.
    const realFetch = mock.fetch;
    const failingJwks: typeof fetch = async (input, init) => {
      if (new Request(input, init).url.endsWith("/.well-known/jwks.json")) throw new TypeError("fetch failed");
      return realFetch(input, init);
    };
    const auth2 = new QeetIDAuth(auth.config, { fetch: failingJwks, now: () => Date.now() + 9.5 * MINUTE, logger: {} });
    const renewed = await auth2.loadSession(jar.request("/"));
    expect(renewed.session?.user.id).toBe(PERSON.sub);
    expect(renewed.tokens?.idToken).toBe(original);
  });
});

describe("the organisation's name, roles and permissions", () => {
  it("are looked up with the API key and cached for five minutes", async () => {
    const { auth, jar, signIn, advance, mock } = await setup({ env: { QEET_ID_API_KEY: API_KEY } });
    await signIn();
    const { session } = await auth.loadSession(jar.request("/"));
    expect(session?.organization).toEqual({ id: PERSON.tenant_id, name: "Brightleaf Foods" });
    expect(session?.roles).toEqual(["Finance approver", "Viewer"]);
    expect(session?.permissions).toEqual(["invoice.approve", "invoice.read"]);
    const lookups = () => mock.callsTo(`/v1/tenants/${PERSON.tenant_id}`).length;
    expect(lookups()).toBe(1);
    expect(mock.callsTo(`/v1/tenants/${PERSON.tenant_id}`)[0]?.headers.get("authorization")).toBe(`ApiKey ${API_KEY}`);
    advance(4 * MINUTE);
    await auth.loadSession(jar.request("/"));
    expect(lookups()).toBe(1);
    mock.state.permissions = ["invoice.read"];
    advance(2 * MINUTE);
    const later = await auth.loadSession(jar.request("/"));
    expect(lookups()).toBe(2);
    expect(later.session?.permissions).toEqual(["invoice.read"]);
    expect(later.cookies).toHaveLength(1);
  });

  it("keep their last values when the lookup fails", async () => {
    const { auth, jar, signIn, advance, mock, warnings } = await setup({ env: { QEET_ID_API_KEY: API_KEY } });
    await signIn();
    jar.apply((await auth.loadSession(jar.request("/"))).cookies);
    mock.state.managementUnavailable = true;
    advance(6 * MINUTE);
    const { session } = await auth.loadSession(jar.request("/"));
    expect(session?.roles).toEqual(["Finance approver", "Viewer"]);
    expect(warnings.some(([message]) => /couldn't be looked up/.test(message))).toBe(true);
  });

  it("are empty and null without an API key, and nothing is looked up", async () => {
    const { auth, jar, signIn, mock } = await setup();
    await signIn();
    const { session } = await auth.loadSession(jar.request("/"));
    expect(session?.organization?.name).toBeNull();
    expect(mock.calls.some((call) => call.path.startsWith("/v1/tenants"))).toBe(false);
  });

  it("chunk the cookie when there are many permissions", async () => {
    const { auth, jar, signIn, mock } = await setup({ env: { QEET_ID_API_KEY: API_KEY } });
    mock.state.permissions = Array.from({ length: 300 }, (_, index) => `resource${index}.manage`);
    await signIn();
    const names = [...jar.cookies.keys()].sort();
    expect(names.length).toBeGreaterThan(1);
    expect(names.every((name, index) => name === `__Host-qeet-id-session.${index}`)).toBe(true);
    expect(jar.setCookies.every((header) => header.length < 4096)).toBe(true);
    expect((await auth.loadSession(jar.request("/"))).session?.permissions).toHaveLength(300);
  });
});

describe("checkPermission", () => {
  it("asks Qeet ID about the signed-in person", async () => {
    const { auth, jar, signIn, mock } = await setup({ env: { QEET_ID_API_KEY: API_KEY } });
    await signIn();
    expect(await auth.checkPermission(jar.request("/"), "invoice.approve")).toBe(true);
    expect(await auth.checkPermission(jar.request("/"), "invoice.delete")).toBe(false);
    const check = new URL(`${BASE_URL}${mock.callsTo("/v1/check")[0]?.path}`);
    expect(check.pathname).toBe("/v1/check");
  });

  it("needs an API key and a session", async () => {
    const withoutKey = await setup();
    await withoutKey.signIn();
    await expect(withoutKey.auth.checkPermission(withoutKey.jar.request("/"), "invoice.read")).rejects.toBeInstanceOf(ConfigurationError);
    const withKey = await setup({ env: { QEET_ID_API_KEY: API_KEY } });
    await expect(withKey.auth.checkPermission(withKey.jar.request("/"), "invoice.read")).rejects.toBeInstanceOf(NotSignedInError);
  });
});

describe("signing out", () => {
  it("revokes the refresh token, clears the cookie and ends the hosted-login session", async () => {
    const { auth, jar, signIn, mock } = await setup();
    await signIn();
    const idToken = (await auth.loadSession(jar.request("/"))).tokens?.idToken;
    const [grant] = [...mock.grants.keys()];
    const { redirectTo, cookies } = await auth.signOut(jar.request("/auth/sign-out", { method: "POST" }), undefined);
    const url = new URL(redirectTo);
    expect(`${url.origin}${url.pathname}`).toBe(`${BASE_URL}/v1/oauth/logout`);
    expect(Object.fromEntries(url.searchParams)).toEqual({
      id_token_hint: idToken,
      client_id: CLIENT_ID,
      post_logout_redirect_uri: `${ORIGIN}/`,
    });
    expect(mock.callsTo("/oauth/revoke")[0]?.form).toEqual({
      token: grant,
      token_type_hint: "refresh_token",
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
    });
    expect(cookies).toEqual(["__Host-qeet-id-session=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax; Secure"]);
    jar.apply(cookies);
    expect((await auth.loadSession(jar.request("/"))).session).toBeNull();
  });

  it("comes back to a safe returnTo on this site", async () => {
    const { auth, jar, signIn } = await setup({ env: { QEET_ID_POST_SIGN_OUT_REDIRECT_URI: "https://brightleaffoods.in/" } });
    await signIn();
    const goodbye = await auth.signOut(jar.request("/auth/sign-out", { method: "POST" }), "/goodbye");
    expect(new URL(goodbye.redirectTo).searchParams.get("post_logout_redirect_uri")).toBe(`${ORIGIN}/goodbye`);
    await signIn();
    const unsafe = await auth.signOut(jar.request("/auth/sign-out", { method: "POST" }), "https://evil.example/");
    expect(new URL(unsafe.redirectTo).searchParams.get("post_logout_redirect_uri")).toBe("https://brightleaffoods.in/");
  });

  it("answers the return path when there is no session", async () => {
    const { auth, jar, mock } = await setup();
    expect(await auth.signOut(jar.request("/auth/sign-out"), "/goodbye")).toEqual({ redirectTo: "/goodbye", cookies: [] });
    expect(await auth.signOut(jar.request("/auth/sign-out"), "//evil.example")).toEqual({ redirectTo: "/", cookies: [] });
    expect(mock.calls).toHaveLength(0);
  });

  it("still ends this app's session when Qeet ID can't be reached", async () => {
    const { auth, jar, signIn, mock, warnings } = await setup();
    await signIn();
    const fresh = new QeetIDAuth(auth.config, { fetch: mock.fetch, logger: { warn: (m, c) => warnings.push([m, c]) } });
    mock.state.down = true;
    const { redirectTo, cookies } = await fresh.signOut(jar.request("/auth/sign-out"), "/goodbye");
    expect(redirectTo).toBe("/goodbye");
    expect(cookies[0]).toMatch(/Max-Age=0/);
    expect(warnings.map(([message]) => message)).toEqual([
      expect.stringMatching(/couldn't be revoked/),
      expect.stringMatching(/only this app's session ended/),
    ]);
  });
});
