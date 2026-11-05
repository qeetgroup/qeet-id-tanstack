/**
 * The errors this package throws on the server. Each extends `QeetIDError`
 * from `@qeet-id/node`, so one `instanceof QeetIDError` covers both packages,
 * and each carries a stable `code` to branch on.
 *
 * ```text
 * QeetIDError                    (@qeet-id/node)
 * ├── ConfigurationError         invalid_configuration: a QEET_ID_* variable is missing or wrong
 * ├── NotSignedInError           not_signed_in: the request has no session
 * └── SessionUnavailableError    session_unavailable: Qeet ID couldn't be reached to renew the session
 * ```
 */

import { QeetIDError } from "@qeet-id/node";

function named(ctor: abstract new (...args: never[]) => Error, name: string): void {
  // On the prototype, where @qeet-id/node keeps its errors' names.
  Object.defineProperty(ctor.prototype, "name", { value: name, enumerable: false, writable: true, configurable: true });
}

/**
 * The configuration is missing or wrong. Thrown the first time the package
 * needs it, or by `loadConfig()` when the app checks at startup. `problems`
 * names each variable and what is wrong with it, never its value.
 */
export class ConfigurationError extends QeetIDError {
  declare readonly code: "invalid_configuration";
  /** One line per problem, each naming the variable. */
  readonly problems: readonly string[];

  constructor(problems: readonly string[]) {
    super(`Qeet ID isn't configured correctly:\n${problems.map((problem) => `  - ${problem}`).join("\n")}`, {
      code: "invalid_configuration",
    });
    this.problems = Object.freeze([...problems]);
  }
}
named(ConfigurationError, "ConfigurationError");

/** The request has no session: nobody is signed in, or the session has ended. */
export class NotSignedInError extends QeetIDError {
  declare readonly code: "not_signed_in";
  /** The HTTP status that fits: 401. */
  readonly status: 401 = 401;

  constructor(message = "Nobody is signed in.") {
    super(message, { code: "not_signed_in" });
  }
}
named(NotSignedInError, "NotSignedInError");

/**
 * The session's access token had expired and Qeet ID couldn't be reached to
 * renew it. The session may still be good: try again later.
 */
export class SessionUnavailableError extends QeetIDError {
  declare readonly code: "session_unavailable";
  /** The HTTP status that fits: 503. */
  readonly status: 503 = 503;

  constructor(options: { cause?: unknown } = {}) {
    super("Qeet ID couldn't be reached to renew the session.", { code: "session_unavailable", cause: options.cause });
  }
}
named(SessionUnavailableError, "SessionUnavailableError");
