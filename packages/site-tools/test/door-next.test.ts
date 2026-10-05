import { describe, expect, it } from "vitest";

import { canonicalNext } from "../src/door/next.ts";

const host = "site.example";

describe("canonicalNext", () => {
  it.each([
    ["/", "/"],
    ["/docs/", "/docs/"],
    ["/docs/?tab=api", "/docs/?tab=api"],
    ["/docs/#install", "/docs/"],
    ["/%2F%2Fevil.com", "/%2F%2Fevil.com"],
    ["/a/../b/", "/b/"],
  ])("keeps %j as the same-origin path %j", (next, expected) => {
    expect(canonicalNext(next, host)).toBe(expected);
  });

  it.each([
    "//evil.com",
    "/\\evil.com",
    "/\\\\evil.com",
    "/\t/evil.com",
    "/\n/evil.com",
    "/\r\nSet-Cookie:x",
    "/.//evil.com",
    "/..//evil.com",
    "https://evil.com",
    "evil.com",
    "",
    `/${"a".repeat(512)}`,
    "/\u007f",
    "/\u0000",
  ])("refuses %j", (next) => {
    expect(canonicalNext(next, host)).toBeNull();
  });

  it("refuses what is not a string", () => {
    expect(canonicalNext(undefined, host)).toBeNull();
    expect(canonicalNext(["/"], host)).toBeNull();
  });

  it("parses against the host it is given, port included", () => {
    expect(canonicalNext("/x/", "localhost:8443")).toBe("/x/");
  });
});
