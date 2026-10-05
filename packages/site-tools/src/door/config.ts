import { readFile } from "node:fs/promises";

import { type Jwks, parseJwks } from "./verify.ts";

/** One stop on the sign-out walk: a site behind the door, by id, and the host its gate answers on. */
export type SignoutStop = { id: string; host: string };

/** gate.config.json, as reef-door-bundle writes it beside the gate. Data only: it names no product. */
export type GateConfigFile = {
  version: 1;
  /** This site's id at the door, which the door's redirect names as `?site=`. */
  site: string;
  /** The door's origin, `https://` and nothing after the host. Tickets name it as `iss`. */
  door: string;
  /** The hosts this gate answers on, each exactly as the Host header carries it. Any other gets 403. */
  hosts: string[];
  /** Which header names the host: `host`, or `x-forwarded-host` if the platform rewrites Host. */
  hostHeader: "host" | "x-forwarded-host";
  /** The fixed sign-out walk, in order: the same list the door's own site registry holds. */
  signout: SignoutStop[];
  /** The door's public keys. */
  jwks: { keys: unknown[] };
};

export type GateConfig = Omit<GateConfigFile, "jwks"> & { keys: Jwks; issuer: string };

const siteId = /^[a-z0-9][a-z0-9-]{0,31}$/;
const hostName = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*(:\d{1,5})?$/;

export const isSiteId = (value: unknown): value is string => typeof value === "string" && siteId.test(value);
export const isHost = (value: unknown): value is string =>
  typeof value === "string" && value.length <= 253 && hostName.test(value);

/** The door's origin from its URL: https only, with no path, query, fragment or credentials. */
export const doorOrigin = (door: unknown): string => {
  if (typeof door !== "string") throw new Error("the door URL is missing");
  let url: URL;
  try {
    url = new URL(door);
  } catch {
    throw new Error(`the door URL is not a URL: ${door}`);
  }
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) {
    throw new Error(`the door URL must be an https origin: ${door}`);
  }
  if (url.pathname !== "/") throw new Error(`the door URL must be an origin, with no path: ${door}`);
  return url.origin;
};

/** The sign-out walk: unique site ids, each with a host, and nothing else (no URL, so no redirect from data). */
const checkSignout = (signout: unknown): SignoutStop[] => {
  if (!Array.isArray(signout)) throw new Error("the sign-out walk is not a list");
  const seen = new Set<string>();
  for (const stop of signout as Partial<SignoutStop>[]) {
    if (!isSiteId(stop?.id) || !isHost(stop?.host) || seen.has(stop.id)) {
      throw new Error(`a sign-out stop is not a unique id and a host: ${JSON.stringify(stop)}`);
    }
    seen.add(stop.id);
  }
  return (signout as SignoutStop[]).map(({ id, host }) => ({ id, host }));
};

/**
 * Checks a gate configuration and returns it ready to use, or throws naming what is wrong. The gate calls this as it
 * starts and refuses to start on a bad file; the bundler calls it before it writes one.
 */
export const parseGateConfig = (value: unknown): GateConfig => {
  if (typeof value !== "object" || value === null) throw new Error("the gate configuration is not an object");
  const file = value as Partial<GateConfigFile>;
  if (file.version !== 1) throw new Error("the gate configuration has an unknown version");
  if (!isSiteId(file.site)) throw new Error(`the site id is not lowercase letters, digits and hyphens: ${file.site}`);
  const issuer = doorOrigin(file.door);
  if (!Array.isArray(file.hosts) || file.hosts.length === 0) throw new Error("the gate answers on no host");
  for (const host of file.hosts) {
    if (!isHost(host)) throw new Error(`not a lowercase host name: ${host}`);
  }
  if (file.hostHeader !== "host" && file.hostHeader !== "x-forwarded-host") {
    throw new Error(`the host header must be host or x-forwarded-host: ${file.hostHeader}`);
  }
  const signout = checkSignout(file.signout ?? []);
  const keys = parseJwks(file.jwks);
  return {
    version: 1,
    site: file.site,
    door: issuer,
    issuer,
    hosts: [...file.hosts],
    hostHeader: file.hostHeader,
    signout,
    keys,
  };
};

/** Reads and checks gate.config.json. */
export const readGateConfig = async (file: string | URL): Promise<GateConfig> =>
  parseGateConfig(JSON.parse(await readFile(file, "utf8")));

/**
 * `id=host,id=host` as the bin's --signout-chain takes it, in walk order.
 */
export const parseSignoutChain = (value: string | undefined): SignoutStop[] =>
  (value ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const [id = "", host = "", ...rest] = entry.split("=");
      if (rest.length > 0 || !isSiteId(id) || !isHost(host)) {
        throw new Error(`a sign-out stop must be id=host: ${entry}`);
      }
      return { id, host };
    });
