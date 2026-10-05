import { generateKeyPairSync, type KeyObject, randomUUID, sign } from "node:crypto";

/**
 * Test keys and tickets for the door gate, shared by the unit tests and the Playwright suite. A ticket here is what
 * the door's issuer signs with KMS: an ES256 JWS over these claims, its signature raw r‖s.
 */
export type TestKey = { kid: string; privateKey: KeyObject; jwk: Record<string, unknown> };

export const makeKey = (kid = "test-key", namedCurve = "P-256"): TestKey => {
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve });
  const jwk = publicKey.export({ format: "jwk" }) as Record<string, unknown>;
  return { kid, privateKey, jwk: { ...jwk, kid, alg: "ES256", use: "sig" } };
};

export const jwksOf = (...keys: TestKey[]) => ({ keys: keys.map((key) => key.jwk) });

const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");

export const signTicket = (
  key: TestKey,
  claims: Record<string, unknown>,
  header: Record<string, unknown> = {},
  dsaEncoding: "ieee-p1363" | "der" = "ieee-p1363",
): string => {
  const head = encode({ alg: "ES256", typ: "JWT", kid: key.kid, ...header });
  const body = encode(claims);
  const signature = sign("sha256", Buffer.from(`${head}.${body}`), { key: key.privateKey, dsaEncoding });
  return `${head}.${body}.${signature.toString("base64url")}`;
};

export type ClaimsInput = {
  issuer: string;
  host: string;
  state?: string;
  next?: string;
  now?: number;
  lifetime?: number;
};

/** The claims the door's issuer writes for one grant on one host. */
export const ticketClaims = ({ issuer, host, state, next = "/", now, lifetime = 3600 }: ClaimsInput) => {
  const iat = now ?? Math.floor(Date.now() / 1000);
  return {
    iss: issuer,
    aud: host,
    sub: "01JPERSON0000000000000000",
    gid: "01JGRANT00000000000000000",
    jti: randomUUID(),
    iat,
    exp: iat + lifetime,
    ...(state !== undefined && { st: state }),
    next,
  };
};

/** Flips one character of a JWS's payload, keeping it base64url, so the signature no longer covers it. */
export const tamper = (jws: string): string => {
  const [head = "", body = "", signature = ""] = jws.split(".");
  const at = Math.floor(body.length / 2);
  const flipped = body[at] === "A" ? "B" : "A";
  return `${head}.${body.slice(0, at)}${flipped}${body.slice(at + 1)}.${signature}`;
};
