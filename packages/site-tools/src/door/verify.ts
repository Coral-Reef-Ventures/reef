import { createHash, createPublicKey, type KeyObject, timingSafeEqual, verify } from "node:crypto";

/** The JWKS the door publishes: P-256 public keys by `kid`. */
export type Jwks = ReadonlyMap<string, KeyObject>;

/** What a door ticket, and the session cookie made from it, claims. */
export type DoorClaims = {
  iss: string;
  aud: string;
  sub: string;
  gid: string;
  jti: string;
  iat: number;
  exp: number;
  st?: string;
  next?: string;
  kid?: string;
};

export type Verdict = { ok: true; claims: DoorClaims; kid: string } | { ok: false; reason: string };

export type VerifyOptions = {
  keys: Jwks;
  /** The door's origin, which the ticket names as `iss`. */
  issuer: string;
  /** The host the request arrived on, which the ticket names as `aud`. */
  audience: string;
  /** Seconds since the epoch; the clock by default. */
  now?: number;
  /** The state cookie's value. Given, the ticket's `st` has to equal it; a session cookie is checked without it. */
  state?: string;
};

/** The longest a ticket or session may live, from `iat` to `exp`. */
export const maxLifetimeSeconds = 3600;
/** How far ahead of this clock a ticket's `iat` may be, for a door whose clock runs a little fast. */
export const clockSkewSeconds = 60;

const base64url = /^[A-Za-z0-9_-]+$/;
const maxTokenLength = 4096;

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const decodeJson = (part: string): unknown => {
  try {
    return JSON.parse(Buffer.from(part, "base64url").toString("utf8"));
  } catch {
    return undefined;
  }
};

const isText = (value: unknown, max = 256): value is string =>
  typeof value === "string" && value.length > 0 && value.length <= max;

/** One JWKS entry, or a throw naming why it cannot be a door key. */
const readJwk = (jwk: unknown): [string, KeyObject] => {
  if (!isObject(jwk)) throw new Error("a JWKS entry is not an object");
  if ("d" in jwk) throw new Error("the JWKS holds a private key");
  if (jwk.kty !== "EC" || jwk.crv !== "P-256") throw new Error("a JWKS key is not EC on P-256");
  if (jwk.alg !== undefined && jwk.alg !== "ES256") throw new Error("a JWKS key is not for ES256");
  if (jwk.use !== undefined && jwk.use !== "sig") throw new Error("a JWKS key is not for signing");
  if (!isText(jwk.kid)) throw new Error("a JWKS key has no kid");
  if (!isText(jwk.x, 64) || !isText(jwk.y, 64)) throw new Error("a JWKS key has no coordinates");
  const key = createPublicKey({ key: { kty: "EC", crv: "P-256", x: jwk.x, y: jwk.y }, format: "jwk" });
  if (key.asymmetricKeyType !== "ec" || key.asymmetricKeyDetails?.namedCurve !== "prime256v1") {
    throw new Error("a JWKS key is not EC on P-256");
  }
  return [jwk.kid, key];
};

/**
 * Reads a JWKS and keeps only what a door key can be: EC on P-256, for signing with ES256, with a `kid`, and public.
 * Anything else throws, because a gate built with a key it cannot use, or with a private one, must not ship.
 */
export const parseJwks = (value: unknown): Jwks => {
  if (!isObject(value) || !Array.isArray(value.keys) || value.keys.length === 0) {
    throw new Error("the JWKS has no keys");
  }
  const keys = new Map<string, KeyObject>();
  for (const entry of value.keys) {
    const [kid, key] = readJwk(entry);
    if (keys.has(kid)) throw new Error(`a JWKS kid is used twice: ${kid}`);
    keys.set(kid, key);
  }
  return keys;
};

/** Equal strings, compared in time that depends on neither value: both are hashed to the same length first. */
const sameSecret = (a: string, b: string) =>
  timingSafeEqual(createHash("sha256").update(a).digest(), createHash("sha256").update(b).digest());

type Signed = { ok: true; kid: string; payload: unknown } | { ok: false; reason: string };

/** The JWS's shape, header and signature, checked before anything in its payload is believed. */
const checkSignature = (token: unknown, keys: Jwks): Signed => {
  const refuse = (reason: string): Signed => ({ ok: false, reason });
  if (typeof token !== "string" || token.length > maxTokenLength) return refuse("shape");
  const parts = token.split(".");
  if (parts.length !== 3 || !parts.every((part) => base64url.test(part))) return refuse("shape");
  const [encodedHeader = "", encodedPayload = "", encodedSignature = ""] = parts;
  const header = decodeJson(encodedHeader);
  if (!isObject(header) || header.alg !== "ES256" || "crit" in header) return refuse("header");
  if (header.typ !== undefined && header.typ !== "JWT") return refuse("header");
  if (!isText(header.kid)) return refuse("header");
  const key = keys.get(header.kid);
  if (!key) return refuse("kid");
  const signature = Buffer.from(encodedSignature, "base64url");
  if (signature.length !== 64) return refuse("signature");
  const signed = Buffer.from(`${encodedHeader}.${encodedPayload}`, "ascii");
  if (!verify("sha256", signed, { key, dsaEncoding: "ieee-p1363" }, signature)) return refuse("signature");
  return { ok: true, kid: header.kid, payload: decodeJson(encodedPayload) };
};

/** Whether `iat` and `exp` make a live ticket of at most an hour: a reason to refuse, or undefined. */
const checkTimes = (iat: unknown, exp: unknown, now: number): string | undefined => {
  if (typeof iat !== "number" || typeof exp !== "number" || !Number.isInteger(iat) || !Number.isInteger(exp)) {
    return "time";
  }
  if (exp <= now) return "expired";
  if (iat > now + clockSkewSeconds || exp <= iat || exp - iat > maxLifetimeSeconds) return "time";
  return undefined;
};

/** The claims of a signed token, against what this gate expects: a reason to refuse, or undefined. */
const checkClaims = (claims: Record<string, unknown>, kid: string, options: VerifyOptions): string | undefined => {
  if (claims.iss !== options.issuer) return "iss";
  if (claims.aud !== options.audience) return "aud";
  if (!isText(claims.sub) || !isText(claims.gid) || !isText(claims.jti)) return "subject";
  const late = checkTimes(claims.iat, claims.exp, options.now ?? Math.floor(Date.now() / 1000));
  if (late) return late;
  if (claims.kid !== undefined && claims.kid !== kid) return "kid";
  if (claims.next !== undefined && typeof claims.next !== "string") return "next";
  if (options.state !== undefined && !(isText(claims.st, 128) && sameSecret(claims.st, options.state))) return "state";
  return undefined;
};

/**
 * Verifies a door ticket or session: an ES256 JWS whose `kid` is in the JWKS, signed by that key, issued by the door
 * for this exact host, unexpired, living no longer than an hour, and (for a ticket) bound to the state cookie. The
 * signature is checked before any claim is read. Every refusal is the same refusal to the visitor; `reason` is for
 * tests.
 */
export const verifyTicket = (token: unknown, options: VerifyOptions): Verdict => {
  const refuse = (reason: string): Verdict => ({ ok: false, reason });
  const signed = checkSignature(token, options.keys);
  if (!signed.ok) return signed;
  const claims = signed.payload;
  if (!isObject(claims)) return refuse("payload");
  const reason = checkClaims(claims, signed.kid, options);
  return reason ? refuse(reason) : { ok: true, claims: claims as DoorClaims, kid: signed.kid };
};
