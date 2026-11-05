/**
 * Configuration, from environment variables. Every problem is collected and
 * reported at once, naming the variable and never its value.
 */

import { DEFAULT_BASE_PATH, type SessionRoutes, sessionRoutes } from "../contract.js";
import { trimTrailingSlashes } from "./encoding.js";
import { ConfigurationError } from "./errors.js";

/** The production Qeet ID API. */
export const DEFAULT_BASE_URL: string = "https://api.id.qeet.in";
/** The scopes asked for unless `QEET_ID_SCOPES` says otherwise: the session's fields come from them. */
export const DEFAULT_SCOPES: readonly string[] = Object.freeze(["openid", "email", "profile"]);
/** How long a session lasts without being renewed, unless `QEET_ID_SESSION_MAX_AGE` says otherwise: 30 days, Qeet ID's refresh token lifetime. */
export const DEFAULT_SESSION_MAX_AGE_SECONDS: number = 30 * 24 * 60 * 60;
/** The shortest secret accepted in `QEET_ID_COOKIE_SECRET`. */
export const MIN_COOKIE_SECRET_LENGTH: number = 32;

const MIN_SESSION_MAX_AGE_SECONDS = 5 * 60;
/** Browsers cap a cookie's lifetime at 400 days (RFC 6265bis). */
const MAX_SESSION_MAX_AGE_SECONDS = 400 * 24 * 60 * 60;

/** The environment variables this package reads. */
export const ENV = {
  baseUrl: "QEET_ID_BASE_URL",
  clientId: "QEET_ID_CLIENT_ID",
  clientSecret: "QEET_ID_CLIENT_SECRET",
  redirectUri: "QEET_ID_REDIRECT_URI",
  cookieSecret: "QEET_ID_COOKIE_SECRET",
  basePath: "QEET_ID_BASE_PATH",
  scopes: "QEET_ID_SCOPES",
  postSignOutRedirectUri: "QEET_ID_POST_SIGN_OUT_REDIRECT_URI",
  sessionMaxAge: "QEET_ID_SESSION_MAX_AGE",
  apiKey: "QEET_ID_API_KEY",
} as const;

/**
 * The checked configuration. The client secret, cookie secrets and API key
 * are not enumerable: logging or serialising the object leaves them out.
 */
export interface QeetIDConfig {
  /** Qeet ID's API, where discovery, the token endpoint and the management API live. */
  readonly baseUrl: string;
  /** The application's client id. */
  readonly clientId: string;
  /** The application's client secret: this server is a confidential client. */
  readonly clientSecret: string;
  /** `{origin}{basePath}/callback`, registered with Qeet ID. */
  readonly redirectUri: string;
  /** The app's origin, from the redirect URI. Return paths and request origins are checked against it. */
  readonly origin: string;
  /** Where the session routes live, such as `/auth`. */
  readonly basePath: string;
  /** Every session route's path. */
  readonly routes: SessionRoutes;
  /** The scopes asked for at sign-in. */
  readonly scopes: readonly string[];
  /** Where Qeet ID sends the browser after signing out, when the sign-out names no return path. */
  readonly postSignOutRedirectUri: string;
  /** How long a session lasts without being renewed, in seconds. */
  readonly sessionMaxAgeSeconds: number;
  /** Whether cookies are `Secure` and `__Host-` prefixed: whenever the app is served over https. */
  readonly secureCookies: boolean;
  /** The cookie secrets, newest first: the first seals, every one unseals. */
  readonly cookieSecrets: readonly string[];
  /** A server-side API key, to look up the organisation's name and the person's roles and permissions. */
  readonly apiKey: string | undefined;
}

/** The variables `loadConfig` reads: `process.env`, or any object with the same keys. */
export type QeetIDEnv = Readonly<Record<string, string | undefined>>;

/**
 * Reads and checks the configuration. Call it when the server starts to fail
 * fast; the package calls it itself the first time it needs it.
 *
 * @throws {ConfigurationError} listing every variable that is missing or wrong.
 */
export function loadConfig(env: QeetIDEnv = processEnv()): QeetIDConfig {
  const problems: string[] = [];
  const value = (name: string): string | undefined => {
    const raw = env[name]?.trim();
    return raw === undefined || raw === "" ? undefined : raw;
  };
  const required = (name: string, hint: string): string => {
    const raw = value(name);
    if (raw === undefined) problems.push(`${name} is required: ${hint}.`);
    return raw ?? "";
  };

  const baseUrl = trimTrailingSlashes(checkedUrl(value(ENV.baseUrl) ?? DEFAULT_BASE_URL, ENV.baseUrl, problems, { allowQuery: false }));

  const clientId = required(ENV.clientId, "the client id of your Qeet ID application");
  const clientSecret = required(ENV.clientSecret, "the client secret of your Qeet ID application (a confidential web application)");

  let basePath = DEFAULT_BASE_PATH;
  let routes = sessionRoutes(DEFAULT_BASE_PATH);
  const configuredBasePath = value(ENV.basePath);
  if (configuredBasePath !== undefined) {
    try {
      routes = sessionRoutes(configuredBasePath);
      basePath = trimTrailingSlashes(configuredBasePath);
    } catch {
      problems.push(`${ENV.basePath} must be a path on this site, such as ${DEFAULT_BASE_PATH}.`);
    }
  }

  const redirectUri = required(ENV.redirectUri, `the URL of ${routes.callback} on your site, registered with Qeet ID`);
  let origin = "";
  if (redirectUri !== "") {
    const url = checkedUrl(redirectUri, ENV.redirectUri, problems, { allowQuery: false });
    if (url !== "") {
      const parsed = new URL(url);
      origin = parsed.origin;
      if (parsed.pathname !== routes.callback) {
        problems.push(`${ENV.redirectUri} must point at ${routes.callback} on your site, where the callback route is.`);
      }
    }
  }

  const secrets = (value(ENV.cookieSecret) ?? "").split(/[\s,]+/).filter(Boolean);
  if (secrets.length === 0) {
    problems.push(
      `${ENV.cookieSecret} is required: a random secret of at least ${MIN_COOKIE_SECRET_LENGTH} characters (openssl rand -base64 32).`,
    );
  } else if (secrets.some((secret) => secret.length < MIN_COOKIE_SECRET_LENGTH)) {
    problems.push(`${ENV.cookieSecret} must hold secrets of at least ${MIN_COOKIE_SECRET_LENGTH} characters each.`);
  } else if (new Set(secrets).size !== secrets.length) {
    problems.push(`${ENV.cookieSecret} lists the same secret twice.`);
  }

  const scopes = (value(ENV.scopes) ?? DEFAULT_SCOPES.join(" ")).split(/\s+/).filter(Boolean);
  if (!scopes.includes("openid")) problems.push(`${ENV.scopes} must include openid: the session is built from the ID token.`);
  // RFC 6749 §3.3: scope-token = 1*( %x21 / %x23-5B / %x5D-7E )
  if (scopes.some((scope) => !/^[\x21\x23-\x5B\x5D-\x7E]+$/.test(scope))) problems.push(`${ENV.scopes} has a scope that isn't valid.`);

  let postSignOutRedirectUri = origin === "" ? "" : `${origin}/`;
  const configuredPostSignOut = value(ENV.postSignOutRedirectUri);
  if (configuredPostSignOut !== undefined) {
    postSignOutRedirectUri = checkedUrl(configuredPostSignOut, ENV.postSignOutRedirectUri, problems, { allowQuery: true });
  }

  let sessionMaxAgeSeconds = DEFAULT_SESSION_MAX_AGE_SECONDS;
  const configuredMaxAge = value(ENV.sessionMaxAge);
  if (configuredMaxAge !== undefined) {
    const seconds = /^\d+$/.test(configuredMaxAge) ? Number(configuredMaxAge) : Number.NaN;
    if (!(seconds >= MIN_SESSION_MAX_AGE_SECONDS && seconds <= MAX_SESSION_MAX_AGE_SECONDS)) {
      problems.push(
        `${ENV.sessionMaxAge} must be a whole number of seconds from ${MIN_SESSION_MAX_AGE_SECONDS} to ${MAX_SESSION_MAX_AGE_SECONDS}.`,
      );
    } else {
      sessionMaxAgeSeconds = seconds;
    }
  }

  const apiKey = value(ENV.apiKey);

  if (problems.length > 0) throw new ConfigurationError(problems);

  const config = {
    baseUrl,
    clientId,
    redirectUri,
    origin,
    basePath,
    routes,
    scopes: Object.freeze(scopes),
    postSignOutRedirectUri,
    sessionMaxAgeSeconds,
    secureCookies: origin.startsWith("https:"),
  };
  // The secrets stay out of JSON.stringify, console.log and util.inspect.
  Object.defineProperties(config, {
    clientSecret: { value: clientSecret, enumerable: false },
    cookieSecrets: { value: Object.freeze(secrets), enumerable: false },
    apiKey: { value: apiKey, enumerable: false },
  });
  return Object.freeze(config) as QeetIDConfig;
}

function processEnv(): QeetIDEnv {
  return (globalThis as { process?: { env?: QeetIDEnv } }).process?.env ?? {};
}

/**
 * `raw` as a normalised absolute URL, or "" after recording why it isn't
 * one: https, or http on this machine only, with no credentials or fragment.
 */
function checkedUrl(raw: string, name: string, problems: string[], options: { allowQuery: boolean }): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    problems.push(`${name} must be an absolute URL.`);
    return "";
  }
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) || url.hostname.endsWith(".localhost");
  if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) {
    problems.push(`${name} must use https (plain http only for localhost).`);
    return "";
  }
  if (url.username !== "" || url.password !== "" || url.hash !== "" || (!options.allowQuery && url.search !== "")) {
    problems.push(`${name} must not carry credentials, a fragment${options.allowQuery ? "" : " or a query"}.`);
    return "";
  }
  return url.toString();
}
