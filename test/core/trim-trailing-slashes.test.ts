import { describe, expect, it } from "vitest";
import { trimTrailingSlashes } from "../../src/core/encoding.js";

describe("trimTrailingSlashes", () => {
  it("removes the trailing slashes and keeps the rest", () => {
    expect(trimTrailingSlashes("https://api.id.qeet.in///")).toBe("https://api.id.qeet.in");
    expect(trimTrailingSlashes("/auth/")).toBe("/auth");
    expect(trimTrailingSlashes("/auth")).toBe("/auth");
    expect(trimTrailingSlashes("///")).toBe("");
    expect(trimTrailingSlashes("")).toBe("");
  });

  it("stays fast on a long run of slashes that does not end the string", () => {
    const hostile = `${"/".repeat(100_000)}x`;
    const started = performance.now();
    expect(trimTrailingSlashes(hostile)).toBe(hostile);
    expect(performance.now() - started).toBeLessThan(50);
  });
});
