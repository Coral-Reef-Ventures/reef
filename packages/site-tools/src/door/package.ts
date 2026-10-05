import { cp, mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { type GateConfigFile, parseGateConfig, type SignoutStop } from "./config.ts";
import { parseJwks } from "./verify.ts";

/**
 * The gate's own files, relative to the package's compiled root, which the bundle carries beside server.mjs. They
 * import Node's modules and each other and nothing else, so the bundle needs no node_modules (a test holds the list
 * against the imports).
 */
export const gateFiles = ["serve.js", "door/server.js", "door/config.js", "door/next.js", "door/verify.js"];

/** Amplify takes a deployment of up to 220 MB; the gate refuses one over 200, which leaves room. */
export const maxBundleBytes = 200 * 1024 * 1024;

export type DeployManifest = {
  version: 1;
  routes: { path: string; target: { kind: string; src?: string } }[];
  computeResources: { name: string; runtime: string; entrypoint: string }[];
  framework: { name: string; version: string };
};

export type BundleDoorOptions = {
  /** This site's id at the door. */
  site: string;
  /** The static export to lock: `out` by default. */
  out?: string;
  /** Where Amplify reads the deployment from: `.amplify-hosting`, which is also the only name accepted. */
  dest?: string;
  /** The door's origin. */
  doorUrl: string;
  /** The hosts the gate answers on. */
  hosts: string[];
  /** The door's JWKS: `https:`, or `file:` for a build without the network and for tests. */
  jwksUrl: string;
  /** The sign-out walk, in order. */
  signout?: SignoutStop[];
  hostHeader?: GateConfigFile["hostHeader"];
  /** The compiled package root the gate's files are copied from; this package's own `dist` by default. */
  gateRoot?: string;
  maxBytes?: number;
};

const packageRoot = fileURLToPath(new URL("../../", import.meta.url));
const compiledRoot = fileURLToPath(new URL("../", import.meta.url));

const ownVersion = async () =>
  (JSON.parse(await readFile(path.join(packageRoot, "package.json"), "utf8")) as { version: string }).version;

/** Fetches the door's JWKS and checks it is P-256 public keys; a build with no usable key fails here. */
export const fetchJwks = async (jwksUrl: string): Promise<{ keys: unknown[] }> => {
  let url: URL;
  try {
    url = new URL(jwksUrl);
  } catch {
    throw new Error(`the JWKS URL is not a URL: ${jwksUrl}`);
  }
  let text: string;
  if (url.protocol === "file:") {
    text = await readFile(url, "utf8");
  } else if (url.protocol === "https:") {
    const response = await fetch(url, { redirect: "error", signal: AbortSignal.timeout(15_000) }).catch(
      (error: unknown) => {
        // fetch says only "fetch failed"; what went wrong (refused, a certificate, a timeout) is its cause.
        const cause = error instanceof Error && error.cause instanceof Error ? `: ${error.cause.message}` : "";
        throw new Error(
          `the JWKS is unreachable at ${jwksUrl}: ${error instanceof Error ? error.message : error}${cause}`,
        );
      },
    );
    if (!response.ok) throw new Error(`the JWKS answered ${response.status} at ${jwksUrl}`);
    text = await response.text();
  } else {
    throw new Error(`the JWKS URL must be https: (or file:): ${jwksUrl}`);
  }
  let jwks: unknown;
  try {
    jwks = JSON.parse(text);
  } catch {
    throw new Error(`the JWKS at ${jwksUrl} is not JSON`);
  }
  parseJwks(jwks);
  return { keys: (jwks as { keys: unknown[] }).keys };
};

const sizeOf = async (target: string): Promise<number> => {
  const info = await stat(target);
  if (!info.isDirectory()) return info.size;
  let total = 0;
  for (const entry of await readdir(target)) total += await sizeOf(path.join(target, entry));
  return total;
};

/**
 * Checks a written deployment the way the lock depends on it: exactly one route, `/*` to Compute, no static/
 * directory for Amplify to serve around the gate, the gate's entry point present, and the whole under the size limit.
 * Throws naming the first thing wrong.
 */
export const checkDeployment = async (dest: string, maxBytes = maxBundleBytes): Promise<DeployManifest> => {
  const manifest = JSON.parse(await readFile(path.join(dest, "deploy-manifest.json"), "utf8")) as DeployManifest;
  const [route, ...others] = manifest.routes ?? [];
  if (others.length > 0) throw new Error("the deployment has more than one route; only /* to Compute may exist");
  if (route?.path !== "/*" || route.target?.kind !== "Compute" || route.target.src !== "default") {
    throw new Error("the deployment's one route must be /* to Compute default");
  }
  const [compute, ...moreCompute] = manifest.computeResources ?? [];
  if (moreCompute.length > 0 || compute?.name !== "default" || compute.entrypoint !== "server.mjs") {
    throw new Error("the deployment must have one compute resource, default, entered at server.mjs");
  }
  const entries = await readdir(dest);
  if (entries.includes("static")) throw new Error("the deployment has a static/ directory, which bypasses the gate");
  await stat(path.join(dest, "compute", "default", "server.mjs"));
  const size = await sizeOf(dest);
  if (size > maxBytes) throw new Error(`the deployment is ${size} bytes, over the ${maxBytes} limit`);
  return manifest;
};

const entryPoint = (
  version: string,
) => `// Written by reef-door-bundle (@coralreefventures/site-tools ${version}). Do not edit.
// Every request to this site passes through the gate; nothing is served around it.
import { startGate } from "./gate/door/server.js";

await startGate({
  config: new URL("./gate.config.json", import.meta.url),
  site: new URL("./site/", import.meta.url),
  port: Number(process.env.PORT || 3000),
});
`;

/**
 * Writes `.amplify-hosting` for a locked site: the static export under compute/default/site, the gate beside it with
 * its configuration, and a deployment manifest with one route, `/*` to Compute, so Amplify serves every byte through
 * the gate. The JWKS is fetched and checked first, and the result is checked after, so a build that would ship an open
 * or unusable gate fails instead.
 */
export const bundleDoor = async (options: BundleDoorOptions): Promise<DeployManifest> => {
  const out = path.resolve(options.out ?? "out");
  const dest = path.resolve(options.dest ?? ".amplify-hosting");
  if (path.basename(dest) !== ".amplify-hosting") {
    throw new Error(`the deployment directory must be named .amplify-hosting, which Amplify reads: ${dest}`);
  }
  if (!(await stat(out).catch(() => null))?.isDirectory()) throw new Error(`the static export is missing: ${out}`);
  if (out === dest || out.startsWith(`${dest}${path.sep}`) || dest.startsWith(`${out}${path.sep}`)) {
    throw new Error("the static export and the deployment directory must not contain each other");
  }
  const jwks = await fetchJwks(options.jwksUrl);
  const configFile: GateConfigFile = {
    version: 1,
    site: options.site,
    door: options.doorUrl.replace(/\/$/, ""),
    hosts: options.hosts.map((host) => host.trim().toLowerCase()).filter(Boolean),
    hostHeader: options.hostHeader ?? "host",
    signout: options.signout ?? [],
    jwks,
  };
  const config = parseGateConfig(configFile);
  configFile.door = config.door;

  const gateRoot = options.gateRoot ?? compiledRoot;
  const version = await ownVersion();
  const compute = path.join(dest, "compute", "default");
  await rm(dest, { recursive: true, force: true });
  await mkdir(path.join(compute, "gate"), { recursive: true });
  for (const file of gateFiles) {
    await mkdir(path.dirname(path.join(compute, "gate", file)), { recursive: true });
    await cp(path.join(gateRoot, file), path.join(compute, "gate", file));
  }
  // The gate's files are ES modules named .js, and nothing above them in the bundle says so.
  await writeFile(path.join(compute, "gate", "package.json"), `${JSON.stringify({ type: "module" })}\n`);
  await writeFile(path.join(compute, "server.mjs"), entryPoint(version));
  await writeFile(path.join(compute, "gate.config.json"), `${JSON.stringify(configFile, null, 2)}\n`);
  await cp(out, path.join(compute, "site"), { recursive: true });
  const manifest: DeployManifest = {
    version: 1,
    routes: [{ path: "/*", target: { kind: "Compute", src: "default" } }],
    computeResources: [{ name: "default", runtime: "nodejs24.x", entrypoint: "server.mjs" }],
    framework: { name: "crv-door-gate", version },
  };
  await writeFile(path.join(dest, "deploy-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  return checkDeployment(dest, options.maxBytes);
};
