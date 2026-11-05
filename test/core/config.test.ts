import { inspect } from "node:util";
import { QeetIDError } from "@qeet-id/node";
import { describe, expect, it } from "vitest";
import { DEFAULT_SESSION_MAX_AGE_SECONDS, loadConfig } from "../../src/core/config.js";
import { ConfigurationError } from "../../src/core/errors.js";
import { API_KEY, CLIENT_SECRET, testEnv } from "../helpers/qeet-id.js";

function problemsOf(env: Record<string, string | undefined>): readonly string[] {
  try {
    loadConfig(env);
  } catch (error) {
    expect(error).toBeInstanceOf(ConfigurationError);
    expect(error).toBeInstanceOf(QeetIDError);
    return (error as ConfigurationError).problems;
  }
  throw new Error("expected a ConfigurationError");
}

describe("loadConfig", () => {
  it("reads a complete configuration with the defaults", () => {
    const config = loadConfig(testEnv());
    expect(config).toMatchObject({
      baseUrl: "https://api.id.qeet.test",
      clientId: "app_brightleaf_console",
      redirectUri: "https://app.brightleaffoods.in/auth/callback",
      origin: "https://app.brightleaffoods.in",
      basePath: "/auth",
      scopes: ["openid", "email", "profile"],
      postSignOutRedirectUri: "https://app.brightleaffoods.in/",
      sessionMaxAgeSeconds: DEFAULT_SESSION_MAX_AGE_SECONDS,
      secureCookies: true,
      apiKey: undefined,
    });
    expect(config.routes.session).toBe("/auth/session");
    expect(config.clientSecret).toBe(CLIENT_SECRET);
    expect(Object.isFrozen(config)).toBe(true);
  });

  it("defaults the base URL to Qeet ID's production API", () => {
    expect(loadConfig(testEnv({ QEET_ID_BASE_URL: undefined })).baseUrl).toBe("https://api.id.qeet.in");
    expect(loadConfig(testEnv({ QEET_ID_BASE_URL: "https://api.id.qeet.test/" })).baseUrl).toBe("https://api.id.qeet.test");
  });

  it("keeps the secrets out of logs and JSON", () => {
    const config = loadConfig(testEnv({ QEET_ID_API_KEY: API_KEY }));
    const shown = `${JSON.stringify(config)} ${inspect(config)} ${Object.keys(config).join(",")}`;
    expect(shown).not.toContain(CLIENT_SECRET);
    expect(shown).not.toContain(API_KEY);
    expect(shown).not.toContain("k1-0123456789");
    expect(config.apiKey).toBe(API_KEY);
  });

  it("reads every optional variable", () => {
    const config = loadConfig(
      testEnv({
        QEET_ID_BASE_PATH: "/account/auth/",
        QEET_ID_REDIRECT_URI: "https://app.brightleaffoods.in/account/auth/callback",
        QEET_ID_SCOPES: "openid email profile offline_access",
        QEET_ID_POST_SIGN_OUT_REDIRECT_URI: "https://brightleaffoods.in/signed-out?from=app",
        QEET_ID_SESSION_MAX_AGE: "28800",
        QEET_ID_COOKIE_SECRET: "new-0123456789abcdefghijklmnopqrstuvwxyz, old-0123456789abcdefghijklmnopqrstuvwxyz",
      }),
    );
    expect(config.basePath).toBe("/account/auth");
    expect(config.routes.signIn).toBe("/account/auth/sign-in");
    expect(config.scopes).toContain("offline_access");
    expect(config.postSignOutRedirectUri).toBe("https://brightleaffoods.in/signed-out?from=app");
    expect(config.sessionMaxAgeSeconds).toBe(28_800);
    expect(config.cookieSecrets).toEqual(["new-0123456789abcdefghijklmnopqrstuvwxyz", "old-0123456789abcdefghijklmnopqrstuvwxyz"]);
  });

  it("allows plain http on this machine, without Secure cookies", () => {
    const config = loadConfig(
      testEnv({ QEET_ID_REDIRECT_URI: "http://localhost:3000/auth/callback", QEET_ID_BASE_URL: "http://id.localhost:8080" }),
    );
    expect(config.secureCookies).toBe(false);
    expect(config.origin).toBe("http://localhost:3000");
  });

  it("lists every problem at once, naming the variable and never its value", () => {
    const problems = problemsOf({ QEET_ID_COOKIE_SECRET: "too-short" });
    expect(problems.join("\n")).toMatch(/QEET_ID_CLIENT_ID is required/);
    expect(problems.join("\n")).toMatch(/QEET_ID_CLIENT_SECRET is required/);
    expect(problems.join("\n")).toMatch(/QEET_ID_REDIRECT_URI is required/);
    expect(problems.join("\n")).toMatch(/QEET_ID_COOKIE_SECRET must hold secrets of at least 32 characters/);
    expect(problems.join("\n")).not.toContain("too-short");
  });

  it.each([
    [{ QEET_ID_REDIRECT_URI: "http://app.brightleaffoods.in/auth/callback" }, /QEET_ID_REDIRECT_URI must use https/],
    [{ QEET_ID_REDIRECT_URI: "https://app.brightleaffoods.in/callback" }, /QEET_ID_REDIRECT_URI must point at \/auth\/callback/],
    [{ QEET_ID_REDIRECT_URI: "https://app.brightleaffoods.in/auth/callback?x=1" }, /must not carry credentials, a fragment or a query/],
    [{ QEET_ID_REDIRECT_URI: "/auth/callback" }, /QEET_ID_REDIRECT_URI must be an absolute URL/],
    [{ QEET_ID_BASE_URL: "ftp://api.id.qeet.in" }, /QEET_ID_BASE_URL must use https/],
    [{ QEET_ID_BASE_PATH: "auth" }, /QEET_ID_BASE_PATH must be a path on this site/],
    [{ QEET_ID_BASE_PATH: "//evil.example" }, /QEET_ID_BASE_PATH must be a path on this site/],
    [{ QEET_ID_SCOPES: "email profile" }, /QEET_ID_SCOPES must include openid/],
    [{ QEET_ID_SCOPES: 'openid "quoted"' }, /QEET_ID_SCOPES has a scope that isn't valid/],
    [{ QEET_ID_SESSION_MAX_AGE: "60" }, /QEET_ID_SESSION_MAX_AGE must be a whole number of seconds/],
    [{ QEET_ID_SESSION_MAX_AGE: "1.5" }, /QEET_ID_SESSION_MAX_AGE must be a whole number of seconds/],
    [{ QEET_ID_COOKIE_SECRET: "" }, /QEET_ID_COOKIE_SECRET is required/],
    [
      { QEET_ID_COOKIE_SECRET: "same-0123456789abcdefghijklmnopqrstuvw,same-0123456789abcdefghijklmnopqrstuvw" },
      /lists the same secret twice/,
    ],
    [{ QEET_ID_POST_SIGN_OUT_REDIRECT_URI: "javascript:alert(1)" }, /QEET_ID_POST_SIGN_OUT_REDIRECT_URI must use https/],
  ])("refuses %o", (overrides, problem) => {
    expect(problemsOf(testEnv(overrides)).join("\n")).toMatch(problem);
  });

  it("explains itself in the error message", () => {
    expect(() => loadConfig({})).toThrow(/Qeet ID isn't configured correctly:\n {2}- QEET_ID_CLIENT_ID is required/);
  });
});
