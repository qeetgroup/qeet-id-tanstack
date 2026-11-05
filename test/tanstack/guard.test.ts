import { QeetIDError } from "@qeet-id/react";
import { isRedirect } from "@tanstack/react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTestSession } from "../helpers/session.js";

const server = vi.hoisted(() => ({ session: null as unknown }));
vi.mock("../../src/tanstack/server-functions.js", () => ({ getSession: async () => server.session }));
const { requireSession } = await import("../../src/tanstack/guard.js");

const at = (href: string) => ({ href, searchStr: href.includes("?") ? href.slice(href.indexOf("?")) : "" });

async function thrown(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error("expected the guard to throw");
}

beforeEach(() => {
  server.session = null;
});

describe("requireSession", () => {
  it("lets a signed-in person through and adds the session to the context", async () => {
    server.session = createTestSession();
    expect(await requireSession()({ location: at("/invoices") })).toEqual({ session: server.session });
  });

  it("sends anyone else to sign in with a full page load, coming back to the page", async () => {
    const error = await thrown(requireSession()({ location: at("/invoices?status=due#top") }));
    expect(isRedirect(error)).toBe(true);
    const { options } = error as { options: { href: string; reloadDocument: boolean } };
    expect(options.reloadDocument).toBe(true);
    expect(options.href).toBe("/auth/sign-in?returnTo=%2Finvoices%3Fstatus%3Ddue%23top");
  });

  it("follows a custom base path", async () => {
    const error = (await thrown(requireSession({ basePath: "/account/auth/" })({ location: at("/") }))) as { options: { href: string } };
    expect(error.options.href).toBe("/account/auth/sign-in?returnTo=%2F");
    expect(() => requireSession({ basePath: "//evil.example" })).toThrow(TypeError);
  });

  it("throws the failed sign-in's QeetIDError instead of looping back to sign in", async () => {
    const error = await thrown(requireSession()({ location: at("/invoices?authError=access_denied") }));
    expect(error).toBeInstanceOf(QeetIDError);
    expect(error).toMatchObject({ code: "access_denied", status: 401 });
  });
});
