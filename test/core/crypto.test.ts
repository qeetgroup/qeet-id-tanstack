import { describe, expect, it } from "vitest";
import { deriveKeys, pkceChallenge, seal, timingSafeEqual, unseal } from "../../src/core/crypto.js";
import { decodeBase64Url, encodeBase64Url, utf8 } from "../../src/core/encoding.js";

const SECRET = "first-secret-0123456789abcdefghijklmnop";
const NEXT = "second-secret-0123456789abcdefghijklmno";

describe("seal and unseal", () => {
  it("round-trips JSON as a dir/A256GCM JWE", async () => {
    const [key] = await deriveKeys([SECRET], "session");
    const value = { v: 1, hello: "Meera", nested: { list: [1, 2, 3] } };
    const sealed = await seal(value, key!);
    const parts = sealed.split(".");
    expect(parts).toHaveLength(5);
    expect(parts[1]).toBe("");
    const header = JSON.parse(new TextDecoder().decode(decodeBase64Url(parts[0]!)));
    expect(header).toEqual({ alg: "dir", enc: "A256GCM", kid: key!.kid });
    expect(sealed).not.toContain("Meera");
    expect(await unseal(sealed, [key!])).toEqual(value);
  });

  it("uses a fresh IV each time", async () => {
    const [key] = await deriveKeys([SECRET], "session");
    expect(await seal({ a: 1 }, key!)).not.toBe(await seal({ a: 1 }, key!));
  });

  it("refuses a value changed anywhere", async () => {
    const [key] = await deriveKeys([SECRET], "session");
    const sealed = await seal({ user: "meera" }, key!);
    const parts = sealed.split(".");
    for (const index of [0, 2, 3, 4]) {
      const bytes = decodeBase64Url(parts[index]!)!;
      bytes[0] = bytes[0]! ^ 1;
      const tampered = [...parts];
      tampered[index] = encodeBase64Url(bytes);
      expect(await unseal(tampered.join("."), [key!])).toBeUndefined();
    }
  });

  it("refuses another secret's and another purpose's keys", async () => {
    const [session] = await deriveKeys([SECRET], "session");
    const [signIn] = await deriveKeys([SECRET], "sign-in");
    const [other] = await deriveKeys([NEXT], "session");
    const sealed = await seal({ a: 1 }, session!);
    expect(await unseal(sealed, [signIn!])).toBeUndefined();
    expect(await unseal(sealed, [other!])).toBeUndefined();
    // Even forced to use the other purpose's key under the same kid, the tag fails.
    expect(await unseal(sealed, [{ kid: session!.kid, key: signIn!.key }])).toBeUndefined();
  });

  it("rotates: the first secret seals and every secret unseals", async () => {
    const [old] = await deriveKeys([SECRET], "session");
    const sealedBefore = await seal({ era: "old" }, old!);
    const rotated = await deriveKeys([NEXT, SECRET], "session");
    expect(await unseal(sealedBefore, rotated)).toEqual({ era: "old" });
    const sealedAfter = await seal({ era: "new" }, rotated[0]!);
    expect(await unseal(sealedAfter, rotated)).toEqual({ era: "new" });
    // Once the old secret is dropped, what it sealed no longer opens.
    expect(await unseal(sealedBefore, await deriveKeys([NEXT], "session"))).toBeUndefined();
  });

  it("derives the same key from the same secret, so other instances can unseal", async () => {
    const [a] = await deriveKeys([SECRET], "session");
    const [b] = await deriveKeys([SECRET], "session");
    expect(a!.kid).toBe(b!.kid);
    expect(await unseal(await seal({ x: 1 }, a!), [b!])).toEqual({ x: 1 });
  });

  it("refuses headers other than the one it writes", async () => {
    const [key] = await deriveKeys([SECRET], "session");
    const sealed = await seal({ a: 1 }, key!);
    const [, ...rest] = sealed.split(".");
    const withHeader = (header: object) => [encodeBase64Url(utf8(JSON.stringify(header))), ...rest].join(".");
    expect(await unseal(withHeader({ alg: "none", enc: "A256GCM", kid: key!.kid }), [key!])).toBeUndefined();
    expect(await unseal(withHeader({ alg: "dir", enc: "A128GCM", kid: key!.kid }), [key!])).toBeUndefined();
    expect(await unseal(withHeader({ alg: "dir", enc: "A256GCM", kid: key!.kid, zip: "DEF" }), [key!])).toBeUndefined();
    expect(await unseal(withHeader({ alg: "dir", enc: "A256GCM" }), [key!])).toBeUndefined();
  });

  it("answers undefined, never throws, for junk", async () => {
    const keys = await deriveKeys([SECRET], "session");
    for (const junk of ["", "abc", "a.b.c.d.e", "....", "e30..AAAA.AAAA.AAAA", "x".repeat(70_000), "%%%.%%.%%.%%.%%"]) {
      expect(await unseal(junk, keys)).toBeUndefined();
    }
    expect(await unseal(undefined as unknown as string, keys)).toBeUndefined();
  });
});

describe("pkceChallenge", () => {
  it("matches RFC 7636 appendix B", async () => {
    expect(await pkceChallenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")).toBe("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
  });
});

describe("timingSafeEqual", () => {
  it("compares whole strings", () => {
    expect(timingSafeEqual("state-123", "state-123")).toBe(true);
    expect(timingSafeEqual("state-123", "state-124")).toBe(false);
    expect(timingSafeEqual("state", "state-123")).toBe(false);
    expect(timingSafeEqual("", "")).toBe(true);
  });
});

describe("base64url", () => {
  it("round-trips bytes and refuses other alphabets", () => {
    const bytes = new Uint8Array(100_000).map((_, index) => (index * 7919) % 256);
    expect(decodeBase64Url(encodeBase64Url(bytes))).toEqual(bytes);
    expect(encodeBase64Url(new Uint8Array([251, 255]))).toBe("-_8");
    expect(decodeBase64Url("a+b/")).toBeUndefined();
    expect(decodeBase64Url("abcde")).toBeUndefined();
  });
});
