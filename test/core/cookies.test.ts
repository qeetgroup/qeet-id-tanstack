import { describe, expect, it } from "vitest";
import { MAX_COOKIE_VALUE_LENGTH, clearChunked, parseCookies, readChunked, serializeCookie, writeChunked } from "../../src/core/cookies.js";

const asMap = (pairs: Record<string, string>) => new Map(Object.entries(pairs));
const nameOf = (setCookie: string) => setCookie.slice(0, setCookie.indexOf("="));

describe("parseCookies", () => {
  it("reads the Cookie header, first value winning", () => {
    const cookies = parseCookies(' a=1; b="two" ; c=x=y; ;d; a=ignored');
    expect([...cookies]).toEqual([
      ["a", "1"],
      ["b", "two"],
      ["c", "x=y"],
    ]);
    expect(parseCookies(null).size).toBe(0);
  });
});

describe("serializeCookie", () => {
  it("writes HttpOnly, SameSite=Lax, Path=/ and no Domain, Secure over https", () => {
    expect(serializeCookie("__Host-s", "v", { maxAge: 60.7, secure: true })).toBe(
      "__Host-s=v; Path=/; Max-Age=60; HttpOnly; SameSite=Lax; Secure",
    );
    expect(serializeCookie("s", "v", { maxAge: -5, secure: false })).toBe("s=v; Path=/; Max-Age=0; HttpOnly; SameSite=Lax");
  });
});

describe("chunking", () => {
  const attributes = { maxAge: 3600, secure: true };

  it("writes one cookie when the value fits, and deletes chunks left from before", () => {
    const headers = writeChunked(asMap({ s: "old", "s.0": "a", "s.1": "b", "sx.0": "other" }), "s", "small", attributes);
    expect(headers[0]).toMatch(/^s=small;/);
    expect(headers.slice(1).map(nameOf).sort()).toEqual(["s.0", "s.1"]);
    expect(headers.slice(1).every((header) => header.includes("Max-Age=0"))).toBe(true);
  });

  it("splits a long value into numbered chunks and reads it back", () => {
    const value = "x".repeat(MAX_COOKIE_VALUE_LENGTH * 2 + 10);
    const headers = writeChunked(asMap({ s: "single", "s.0": "a", "s.1": "b", "s.2": "c", "s.3": "d" }), "s", value, attributes);
    const set = headers.filter((header) => !header.includes("Max-Age=0"));
    const deleted = headers.filter((header) => header.includes("Max-Age=0")).map(nameOf);
    expect(set.map(nameOf)).toEqual(["s.0", "s.1", "s.2"]);
    expect(deleted.sort()).toEqual(["s", "s.3"]);
    const jar = new Map(set.map((header) => [nameOf(header), header.slice(header.indexOf("=") + 1, header.indexOf(";"))]));
    expect(readChunked(jar, "s")).toBe(value);
    for (const header of set) expect(header.length).toBeLessThan(4096);
  });

  it("prefers the whole cookie, and stops at the first missing chunk", () => {
    expect(readChunked(asMap({ s: "whole", "s.0": "a" }), "s")).toBe("whole");
    expect(readChunked(asMap({ "s.0": "a", "s.1": "b", "s.3": "d" }), "s")).toBe("ab");
    expect(readChunked(asMap({ "s.1": "b" }), "s")).toBeUndefined();
  });

  it("clears the cookie and every chunk the request carries", () => {
    const headers = clearChunked(asMap({ s: "a", "s.0": "b", "s.12": "c", "s.x": "d", other: "e" }), "s", false);
    expect(headers.map(nameOf).sort()).toEqual(["s", "s.0", "s.12"]);
    expect(headers.every((header) => header.includes("Max-Age=0") && !header.includes("Secure"))).toBe(true);
  });
});
