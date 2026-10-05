import { describe, expect, it } from "vitest";

import { doorOrigin, parseGateConfig, parseSignoutChain } from "../src/door/config.ts";
import { jwksOf, makeKey } from "./door-fixtures.ts";

const valid = {
  version: 1,
  site: "alpha",
  door: "https://door.example",
  hosts: ["site.example", "localhost:8443"],
  hostHeader: "host",
  signout: [{ id: "alpha", host: "site.example" }],
  jwks: jwksOf(makeKey("k1")),
};

describe("parseGateConfig", () => {
  it("accepts a configuration and names the door as the issuer", () => {
    const config = parseGateConfig(valid);
    expect(config).toMatchObject({ site: "alpha", door: "https://door.example", issuer: "https://door.example" });
    expect([...config.keys.keys()]).toEqual(["k1"]);
  });

  it.each([
    ["no object", null],
    ["another version", { ...valid, version: 2 }],
    ["a site id with a slash", { ...valid, site: "a/b" }],
    ["an http door", { ...valid, door: "http://door.example" }],
    ["a door with a query", { ...valid, door: "https://door.example/?x=1" }],
    ["a door with credentials", { ...valid, door: "https://u:p@door.example" }],
    ["no hosts", { ...valid, hosts: [] }],
    ["an uppercase host", { ...valid, hosts: ["Site.example"] }],
    ["a host with a scheme", { ...valid, hosts: ["https://site.example"] }],
    ["an unknown host header", { ...valid, hostHeader: "forwarded" }],
    ["a sign-out stop used twice", { ...valid, signout: [valid.signout[0], valid.signout[0]] }],
    ["a sign-out stop with a URL", { ...valid, signout: [{ id: "alpha", host: "https://evil.example/" }] }],
    ["no keys", { ...valid, jwks: { keys: [] } }],
    ["a P-384 key", { ...valid, jwks: jwksOf(makeKey("p", "P-384")) }],
  ])("refuses %s", (_name, value) => {
    expect(() => parseGateConfig(value)).toThrow();
  });
});

describe("doorOrigin", () => {
  it("keeps the origin and drops a trailing slash", () => {
    expect(doorOrigin("https://door.example/")).toBe("https://door.example");
    expect(doorOrigin("https://door.example:8443")).toBe("https://door.example:8443");
  });
});

describe("parseSignoutChain", () => {
  it("reads id=host pairs in walk order", () => {
    expect(parseSignoutChain(" alpha=site.example , beta=beta.example ")).toEqual([
      { id: "alpha", host: "site.example" },
      { id: "beta", host: "beta.example" },
    ]);
    expect(parseSignoutChain(undefined)).toEqual([]);
  });

  it.each(["alpha", "alpha=site.example=x", "Alpha=site.example", "alpha=https://site.example"])(
    "refuses %j",
    (value) => {
      expect(() => parseSignoutChain(value)).toThrow();
    },
  );
});
