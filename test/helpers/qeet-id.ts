/**
 * A stand-in for Qeet ID, as a `fetch` function: discovery, JWKS, the
 * token-code endpoint (authorization_code and refresh_token with rotation and
 * reuse detection, as the server does), revocation, and the management API
 * lookups. ID tokens are signed with a real ES256 key. Nothing leaves the
 * process.
 */

import { encodeBase64Url, utf8 } from "../../src/core/encoding.js";

export const BASE_URL = "https://api.id.qeet.test";
export const ISSUER = "qeet-id";
export const CLIENT_ID = "app_brightleaf_console";
export const CLIENT_SECRET = "cs_test_brightleaf_console_secret";
export const ORIGIN = "https://app.brightleaffoods.in";
export const REDIRECT_URI = `${ORIGIN}/auth/callback`;
export const API_KEY = "qk_test_brightleaf";

export const PERSON = Object.freeze({
  sub: "0b9a2c7e-5d41-4f1e-9a3b-6c2d8e7f1a90",
  tenant_id: "5f0c1d2e-3a4b-4c5d-8e9f-0a1b2c3d4e5f",
  email: "meera@brightleaffoods.in",
  email_verified: true,
  name: "Meera Iyer",
  picture: "https://cdn.brightleaffoods.in/people/meera.png",
});

export interface RecordedCall {
  method: string;
  path: string;
  form?: Record<string, string>;
  headers: Headers;
}

interface Authorization {
  challenge: string;
  nonce: string;
  redirectUri: string;
  used: boolean;
}

interface RefreshGrant {
  used: boolean;
  revoked: boolean;
}

export interface MockQeetIdOptions {
  /** Seconds an access token lives. Default 600, Qeet ID's default. */
  accessTtl?: number;
  /** Whether the application is registered for refresh_token. Default true. */
  refreshTokens?: boolean;
}

export type MockQeetId = Awaited<ReturnType<typeof createMockQeetId>>;

export async function createMockQeetId(options: MockQeetIdOptions = {}) {
  const keys = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"])) as CryptoKeyPair;
  const publicJwk = await crypto.subtle.exportKey("jwk", keys.publicKey);
  const kid = "test-signing-key";
  const authorizations = new Map<string, Authorization>();
  const grants = new Map<string, RefreshGrant>();
  const calls: RecordedCall[] = [];
  let person: Record<string, unknown> = { ...PERSON };
  let codeCounter = 0;
  let refreshCounter = 0;

  const state = {
    accessTtl: options.accessTtl ?? 600,
    refreshTokens: options.refreshTokens ?? true,
    /** Every request fails as if the network were down. */
    down: false,
    /** The token endpoint answers this OAuth error. */
    tokenError: undefined as string | undefined,
    /** The token endpoint answers 503. */
    tokenUnavailable: false,
    /** The management API answers 503. */
    managementUnavailable: false,
    /** Holds token-endpoint answers until released, to test concurrency. */
    tokenGate: undefined as Promise<void> | undefined,
    /** Overrides the ID token's claims. */
    idTokenClaims: {} as Record<string, unknown>,
    /** Signs the next ID tokens with another key. */
    wrongKey: undefined as CryptoKeyPair | undefined,
    discovery: {} as Record<string, unknown>,
    organizationName: "Brightleaf Foods",
    permissions: ["invoice.approve", "invoice.read"],
    grants: [
      { permission: "invoice.approve", granted_by: "role", via: "direct", role_id: "r1", role_name: "Finance approver" },
      { permission: "invoice.read", granted_by: "role", via: "direct", role_id: "r1", role_name: "Finance approver" },
      { permission: "invoice.read", granted_by: "role", via: "group:finance", role_id: "r2", role_name: "Viewer" },
    ] as Array<Record<string, unknown>>,
    allowed: true,
  };

  async function signJwt(claims: Record<string, unknown>, signingKeys: CryptoKeyPair = keys): Promise<string> {
    const header = encodeBase64Url(utf8(JSON.stringify({ alg: "ES256", kid, typ: "JWT" })));
    const payload = encodeBase64Url(utf8(JSON.stringify(claims)));
    const signature = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, signingKeys.privateKey, utf8(`${header}.${payload}`));
    return `${header}.${payload}.${encodeBase64Url(new Uint8Array(signature))}`;
  }

  async function idToken(nonce?: string): Promise<string> {
    const now = Math.floor(Date.now() / 1000);
    return signJwt(
      {
        iss: ISSUER,
        aud: CLIENT_ID,
        iat: now,
        exp: now + state.accessTtl,
        auth_time: now,
        sid: "9d1c2b3a-0000-4000-8000-000000000001",
        ...person,
        ...(nonce === undefined ? {} : { nonce }),
        ...state.idTokenClaims,
      },
      state.wrongKey,
    );
  }

  async function accessToken(): Promise<string> {
    const now = Math.floor(Date.now() / 1000);
    return signJwt({
      iss: ISSUER,
      aud: "qeet-id",
      sub: person.sub,
      user_id: person.sub,
      tenant_id: person.tenant_id,
      sid: crypto.randomUUID(),
      scope: "openid email profile",
      client_id: CLIENT_ID,
      iat: now,
      nbf: now,
      exp: now + state.accessTtl,
      jti: crypto.randomUUID(),
    });
  }

  function newRefreshToken(): string | undefined {
    if (!state.refreshTokens) return undefined;
    const token = `rt_${++refreshCounter}_${crypto.randomUUID()}`;
    grants.set(token, { used: false, revoked: false });
    return token;
  }

  async function tokenAnswer(nonce?: string): Promise<Response> {
    const refresh = newRefreshToken();
    return Response.json({
      access_token: await accessToken(),
      id_token: await idToken(nonce),
      ...(refresh === undefined ? {} : { refresh_token: refresh }),
      token_type: "Bearer",
      expires_in: state.accessTtl,
      scope: "openid email profile",
    });
  }

  const oauthError = (error: string, status = 400) => Response.json({ error, error_description: error }, { status });

  async function tokenEndpoint(form: Record<string, string>): Promise<Response> {
    if (state.tokenGate) await state.tokenGate;
    if (state.tokenUnavailable) return Response.json({ error: { code: "server.unavailable", message: "Down" } }, { status: 503 });
    if (state.tokenError) return oauthError(state.tokenError);
    if (form.client_id !== CLIENT_ID || form.client_secret !== CLIENT_SECRET) return oauthError("invalid_client", 401);
    if (form.grant_type === "authorization_code") {
      const authorization = authorizations.get(form.code ?? "");
      if (!authorization || authorization.used) return oauthError("invalid_grant");
      authorization.used = true;
      if (authorization.redirectUri !== form.redirect_uri) return oauthError("invalid_grant");
      const digest = encodeBase64Url(new Uint8Array(await crypto.subtle.digest("SHA-256", utf8(form.code_verifier ?? ""))));
      if (digest !== authorization.challenge) return oauthError("invalid_grant");
      return tokenAnswer(authorization.nonce || undefined);
    }
    if (form.grant_type === "refresh_token") {
      const grant = grants.get(form.refresh_token ?? "");
      if (!grant || grant.revoked) return oauthError("invalid_grant");
      if (grant.used) {
        // Reuse: Qeet ID assumes theft and ends every token of the grant.
        for (const other of grants.values()) other.revoked = true;
        return oauthError("invalid_grant");
      }
      grant.used = true;
      return tokenAnswer();
    }
    return oauthError("unsupported_grant_type");
  }

  const fetchImpl = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    const call: RecordedCall = { method: request.method, path: url.pathname, headers: request.headers };
    if ((request.headers.get("content-type") ?? "").startsWith("application/x-www-form-urlencoded")) {
      call.form = Object.fromEntries(new URLSearchParams(await request.text()));
    }
    calls.push(call);
    if (state.down) throw new TypeError("fetch failed");
    if (url.origin !== BASE_URL) return new Response("not found", { status: 404 });
    const managementAuthorized = request.headers.get("authorization") === `ApiKey ${API_KEY}`;

    if (request.method === "GET" && url.pathname === "/.well-known/openid-configuration") {
      return Response.json({
        issuer: ISSUER,
        authorization_endpoint: `${BASE_URL}/v1/oauth/authorize`,
        token_endpoint: `${BASE_URL}/v1/oauth/token-code`,
        userinfo_endpoint: `${BASE_URL}/v1/oauth/userinfo`,
        jwks_uri: `${BASE_URL}/.well-known/jwks.json`,
        revocation_endpoint: `${BASE_URL}/oauth/revoke`,
        end_session_endpoint: `${BASE_URL}/v1/oauth/logout`,
        code_challenge_methods_supported: ["S256"],
        authorization_response_iss_parameter_supported: true,
        ...state.discovery,
      });
    }
    if (request.method === "GET" && url.pathname === "/.well-known/jwks.json") {
      return Response.json({ keys: [{ ...publicJwk, kid, use: "sig", alg: "ES256" }] });
    }
    if (request.method === "POST" && url.pathname === "/v1/oauth/token-code") return tokenEndpoint(call.form ?? {});
    if (request.method === "POST" && url.pathname === "/oauth/revoke") {
      const grant = grants.get(call.form?.token ?? "");
      if (grant) grant.revoked = true;
      return new Response(null, { status: 200 });
    }
    if (url.pathname.startsWith("/v1/") && !managementAuthorized) {
      return Response.json({ error: { code: "auth.unauthorized", message: "No API key." } }, { status: 401 });
    }
    if (state.managementUnavailable) return Response.json({ error: { code: "server.unavailable", message: "Down" } }, { status: 503 });
    if (request.method === "GET" && url.pathname === `/v1/tenants/${person.tenant_id}`) {
      return Response.json({ id: person.tenant_id, name: state.organizationName, slug: "brightleaf", status: "active" });
    }
    if (request.method === "GET" && url.pathname === `/v1/users/${person.sub}/tenants/${person.tenant_id}/permissions`) {
      return Response.json({ permissions: state.permissions, grants: state.grants });
    }
    if (request.method === "GET" && url.pathname === "/v1/check") {
      return Response.json({ allowed: state.allowed && url.searchParams.get("permission") === "invoice.approve" });
    }
    return new Response("not found", { status: 404 });
  };

  return {
    fetch: fetchImpl as typeof fetch,
    state,
    calls,
    grants,
    signJwt,
    idToken,
    /** Changes who signs in from now on. */
    setPerson(next: Record<string, unknown>) {
      person = { ...next };
    },
    /**
     * What Qeet ID's authorize endpoint does for a signed-in person who has
     * consented: checks the request and answers with the callback URL.
     */
    authorize(authorizationUrl: string): string {
      const url = new URL(authorizationUrl);
      const params = url.searchParams;
      if (`${url.origin}${url.pathname}` !== `${BASE_URL}/v1/oauth/authorize`) throw new Error(`Not the authorize endpoint: ${url}`);
      if (params.get("client_id") !== CLIENT_ID || params.get("response_type") !== "code") throw new Error("Bad authorization request");
      if (params.get("code_challenge_method") !== "S256" || (params.get("code_challenge") ?? "").length !== 43) throw new Error("No PKCE");
      const code = `ac_${++codeCounter}`;
      authorizations.set(code, {
        challenge: params.get("code_challenge") ?? "",
        nonce: params.get("nonce") ?? "",
        redirectUri: params.get("redirect_uri") ?? "",
        used: false,
      });
      const callback = new URL(params.get("redirect_uri") ?? "");
      callback.searchParams.set("code", code);
      callback.searchParams.set("state", params.get("state") ?? "");
      callback.searchParams.set("iss", ISSUER);
      return callback.toString();
    },
    /** Calls to `path`, in order. */
    callsTo(path: string): RecordedCall[] {
      return calls.filter((call) => call.path === path);
    },
  };
}

/** A browser's cookie jar, enough for these tests: name=value, Max-Age=0 deletes. */
export class CookieJar {
  readonly cookies = new Map<string, string>();
  /** Every Set-Cookie value seen, for checking attributes. */
  readonly setCookies: string[] = [];

  apply(setCookies: readonly string[]): this {
    for (const header of setCookies) {
      this.setCookies.push(header);
      const [pair = ""] = header.split(";");
      const separator = pair.indexOf("=");
      const name = pair.slice(0, separator);
      const value = pair.slice(separator + 1);
      if (/;\s*Max-Age=0(;|$)/.test(header)) this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
    return this;
  }

  applyResponse(response: Response): this {
    return this.apply(response.headers.getSetCookie());
  }

  header(): string {
    return [...this.cookies].map(([name, value]) => `${name}=${value}`).join("; ");
  }

  request(url: string, init: RequestInit = {}): Request {
    const headers = new Headers(init.headers);
    if (this.cookies.size > 0) headers.set("cookie", this.header());
    return new Request(new URL(url, ORIGIN), { ...init, headers });
  }
}

/** The environment of a configured app. */
export function testEnv(overrides: Record<string, string | undefined> = {}): Record<string, string | undefined> {
  return {
    QEET_ID_BASE_URL: BASE_URL,
    QEET_ID_CLIENT_ID: CLIENT_ID,
    QEET_ID_CLIENT_SECRET: CLIENT_SECRET,
    QEET_ID_REDIRECT_URI: REDIRECT_URI,
    QEET_ID_COOKIE_SECRET: "k1-0123456789abcdefghijklmnopqrstuvwxyz",
    ...overrides,
  };
}
