import { describe, expect, it } from "vitest";

import { parseJwks, verifyTicket } from "../src/door/verify.ts";
import { jwksOf, makeKey, signTicket, tamper, ticketClaims } from "./door-fixtures.ts";

const issuer = "https://door.example";
const host = "site.example";
const key = makeKey("k1");
const keys = parseJwks(jwksOf(key));
const now = 1_900_000_000;
const state = "s".repeat(43);
const options = { keys, issuer, audience: host, now, state };
const claims = (extra: Record<string, unknown> = {}) => ({ ...ticketClaims({ issuer, host, state, now }), ...extra });

describe("verifyTicket", () => {
  it("accepts a ticket the door signed for this host and state", () => {
    const verdict = verifyTicket(signTicket(key, claims({ next: "/docs/" })), options);
    expect(verdict).toMatchObject({ ok: true, kid: "k1", claims: { aud: host, next: "/docs/" } });
  });

  it("accepts a session without the state, which a ticket needs", () => {
    const { st: _st, ...session } = claims();
    expect(verifyTicket(signTicket(key, session), { keys, issuer, audience: host, now }).ok).toBe(true);
    expect(verifyTicket(signTicket(key, session), options)).toEqual({ ok: false, reason: "state" });
  });

  const refusals: [string, () => string, string][] = [
    ["a tampered payload", () => tamper(signTicket(key, claims())), "signature"],
    ["another key's signature", () => signTicket(makeKey("k1"), claims()), "signature"],
    ["an unknown kid", () => signTicket(makeKey("k2"), claims()), "kid"],
    ["alg none", () => signTicket(key, claims(), { alg: "none" }), "header"],
    ["alg HS256", () => signTicket(key, claims(), { alg: "HS256" }), "header"],
    ["a crit header", () => signTicket(key, claims(), { crit: ["exp"] }), "header"],
    ["a DER signature rather than raw r‖s", () => signTicket(key, claims(), {}, "der"), "signature"],
    ["another issuer", () => signTicket(key, claims({ iss: "https://evil.example" })), "iss"],
    ["another host", () => signTicket(key, claims({ aud: "other.example" })), "aud"],
    ["an audience list", () => signTicket(key, claims({ aud: [host] })), "aud"],
    ["an expired ticket", () => signTicket(key, claims({ iat: now - 3600, exp: now })), "expired"],
    ["a lifetime over an hour", () => signTicket(key, claims({ iat: now - 10, exp: now + 3600 })), "time"],
    ["an iat from the future", () => signTicket(key, claims({ iat: now + 120, exp: now + 600 })), "time"],
    ["a fractional exp", () => signTicket(key, claims({ exp: now + 0.5 })), "time"],
    ["no subject", () => signTicket(key, claims({ sub: "" })), "subject"],
    ["no grant", () => signTicket(key, claims({ gid: undefined })), "subject"],
    ["another state", () => signTicket(key, claims({ st: "t".repeat(43) })), "state"],
    ["a payload kid that is not the header's", () => signTicket(key, claims({ kid: "k2" })), "kid"],
    ["a next that is not a string", () => signTicket(key, claims({ next: 1 })), "next"],
  ];
  it.each(refusals)("refuses %s", (_name, token, reason) => {
    expect(verifyTicket(token(), options)).toEqual({ ok: false, reason });
  });

  it.each([undefined, "", "a.b", "a.b.c.d", "a.b.c=", "é.b.c", `${"a".repeat(4097)}.b.c`])(
    "refuses the shape %j",
    (token) => {
      expect(verifyTicket(token, options).ok).toBe(false);
    },
  );
});

describe("parseJwks", () => {
  it("keeps P-256 public keys by kid", () => {
    const keysOut = parseJwks(jwksOf(makeKey("a"), makeKey("b")));
    expect([...keysOut.keys()]).toEqual(["a", "b"]);
  });

  it.each([
    ["no keys", { keys: [] }],
    ["not a JWKS", []],
    ["a P-384 key", jwksOf(makeKey("p384", "P-384"))],
    ["a private key", { keys: [{ ...makeKey("x").jwk, d: "AAAA" }] }],
    ["a kid used twice", jwksOf(makeKey("same"), makeKey("same"))],
    ["a key with no kid", { keys: [{ ...makeKey("x").jwk, kid: undefined }] }],
    ["an RS256 key", { keys: [{ ...makeKey("x").jwk, alg: "RS256" }] }],
    ["an encryption key", { keys: [{ ...makeKey("x").jwk, use: "enc" }] }],
  ])("refuses %s", (_name, jwks) => {
    expect(() => parseJwks(jwks)).toThrow();
  });
});
