import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { VERSION } from "../src/core/version.js";

describe("the package's exports", () => {
  it("the root entry adds the TanStack pieces to everything @qeet-id/react exports", async () => {
    const root = await import("../src/index.js");
    const react = await import("@qeet-id/react");
    for (const name of Object.keys(react)) expect(root).toHaveProperty(name);
    expect(root.QeetIDProvider).not.toBe(react.QeetIDProvider);
    expect(root.VERSION).toBe(VERSION);
    for (const name of ["getSession", "requireSession", "sessionMiddleware", "requireSessionMiddleware"]) expect(root).toHaveProperty(name);
  });

  it("the server entry has the route handlers, helpers, configuration and errors", async () => {
    const server = await import("../src/server.js");
    expect(Object.keys(server).sort()).toEqual([
      "ConfigurationError",
      "DEFAULT_BASE_URL",
      "DEFAULT_SCOPES",
      "DEFAULT_SESSION_MAX_AGE_SECONDS",
      "ENV",
      "MIN_COOKIE_SECRET_LENGTH",
      "NotSignedInError",
      "SessionUnavailableError",
      "VERSION",
      "authRouteHandlers",
      "checkPermission",
      "getAccessToken",
      "getQeetIDClient",
      "loadConfig",
    ]);
  });

  it("VERSION is package.json's version", () => {
    const { version } = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version: string };
    expect(VERSION).toBe(version);
  });
});
