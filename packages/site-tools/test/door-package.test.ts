import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { parseGateConfig, parseSignoutChain } from "../src/door/config.ts";
import { bundleDoor, checkDeployment, fetchJwks, gateFiles } from "../src/door/package.ts";
import { jwksOf, makeKey } from "./door-fixtures.ts";

/**
 * reef-door-bundle's library half. The gate files it copies are the compiled ones; these tests hand it a stand-in
 * compiled root, because what is checked here is the deployment's shape. The real bundle is built and started by the
 * Playwright suite (e2e/door.spec.ts) and by the smoke test from the packed package.
 */
let work: string;
let out: string;
let dest: string;
let gateRoot: string;
let jwksUrl: string;

beforeEach(async () => {
  work = await mkdtemp(path.join(tmpdir(), "reef-door-bundle-"));
  out = path.join(work, "out");
  dest = path.join(work, ".amplify-hosting");
  gateRoot = path.join(work, "dist");
  await mkdir(path.join(out, "_next", "static"), { recursive: true });
  await writeFile(path.join(out, "index.html"), "<h1>Home</h1>");
  await writeFile(path.join(out, "_next", "static", "app.js"), "app");
  for (const file of gateFiles) {
    await mkdir(path.dirname(path.join(gateRoot, file)), { recursive: true });
    await writeFile(path.join(gateRoot, file), `// ${file}\n`);
  }
  const jwksFile = path.join(work, "jwks.json");
  await writeFile(jwksFile, JSON.stringify(jwksOf(makeKey("k1"))));
  jwksUrl = pathToFileURL(jwksFile).href;
});

afterEach(async () => {
  await rm(work, { recursive: true, force: true });
});

const bundle = (extra: Partial<Parameters<typeof bundleDoor>[0]> = {}) =>
  bundleDoor({
    site: "alpha",
    out,
    dest,
    doorUrl: "https://door.example/",
    hosts: ["Site.example", " www.site.example "],
    jwksUrl,
    signout: parseSignoutChain("alpha=site.example,beta=beta.example"),
    gateRoot,
    ...extra,
  });

const listAll = async (directory: string, prefix = ""): Promise<string[]> => {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map((entry) =>
      entry.isDirectory()
        ? listAll(path.join(directory, entry.name), `${prefix}${entry.name}/`)
        : [`${prefix}${entry.name}`],
    ),
  );
  return nested.flat().sort();
};

describe("bundleDoor", () => {
  it("writes one route, /* to Compute, and the export inside the gate's bundle, with no static/ directory", async () => {
    const manifest = await bundle();
    const version = (
      JSON.parse(await readFile(path.resolve(import.meta.dirname, "..", "package.json"), "utf8")) as {
        version: string;
      }
    ).version;
    expect(manifest).toEqual({
      version: 1,
      routes: [{ path: "/*", target: { kind: "Compute", src: "default" } }],
      computeResources: [{ name: "default", runtime: "nodejs24.x", entrypoint: "server.mjs" }],
      framework: { name: "crv-door-gate", version },
    });
    expect(await listAll(dest)).toEqual([
      "compute/default/gate.config.json",
      "compute/default/gate/door/config.js",
      "compute/default/gate/door/next.js",
      "compute/default/gate/door/server.js",
      "compute/default/gate/door/verify.js",
      "compute/default/gate/package.json",
      "compute/default/gate/serve.js",
      "compute/default/server.mjs",
      "compute/default/site/_next/static/app.js",
      "compute/default/site/index.html",
      "deploy-manifest.json",
    ]);
    expect(await readFile(path.join(dest, "compute", "default", "server.mjs"), "utf8")).toContain(
      'import { startGate } from "./gate/door/server.js";',
    );
  });

  it("writes a configuration the gate accepts: the door's origin, lowercased hosts, the walk and the keys", async () => {
    await bundle();
    const written = JSON.parse(await readFile(path.join(dest, "compute", "default", "gate.config.json"), "utf8"));
    expect(written).toMatchObject({
      version: 1,
      site: "alpha",
      door: "https://door.example",
      hosts: ["site.example", "www.site.example"],
      hostHeader: "host",
      signout: [
        { id: "alpha", host: "site.example" },
        { id: "beta", host: "beta.example" },
      ],
    });
    expect(written.jwks.keys).toHaveLength(1);
    expect(written.jwks.keys[0]).not.toHaveProperty("d");
    expect(() => parseGateConfig(written)).not.toThrow();
  });

  it("replaces an earlier deployment rather than adding to it", async () => {
    await mkdir(path.join(dest, "static"), { recursive: true });
    await writeFile(path.join(dest, "static", "leak.html"), "old");
    await bundle();
    expect(await readdir(dest)).toEqual(["compute", "deploy-manifest.json"]);
  });

  it.each([
    [
      "a JWKS with a P-384 key",
      async () => writeFile(path.join(work, "jwks.json"), JSON.stringify(jwksOf(makeKey("p", "P-384")))),
    ],
    ["an empty JWKS", async () => writeFile(path.join(work, "jwks.json"), JSON.stringify({ keys: [] }))],
    ["a JWKS that is not JSON", async () => writeFile(path.join(work, "jwks.json"), "<html>")],
  ])("fails the build on %s", async (_name, spoil) => {
    await spoil();
    await expect(bundle()).rejects.toThrow();
    await expect(readdir(dest)).rejects.toThrow();
  });

  it.each([
    ["an http door", { doorUrl: "http://door.example" }],
    ["a door URL with a path", { doorUrl: "https://door.example/signin" }],
    ["no host", { hosts: [] }],
    ["a host with a path", { hosts: ["site.example/x"] }],
    ["a site id with capitals", { site: "Alpha" }],
    ["a deployment directory Amplify does not read", { dest: path.join("/tmp", "elsewhere") }],
    ["a missing export", { out: path.join("/tmp", "reef-no-such-export") }],
  ])("refuses %s", async (_name, extra) => {
    await expect(bundle(extra)).rejects.toThrow();
  });

  it("refuses a JWKS URL that is neither https: nor file:", async () => {
    await expect(fetchJwks("http://door.example/jwks.json")).rejects.toThrow(/https/);
    await expect(fetchJwks("not a url")).rejects.toThrow(/not a URL/);
  });

  it("fails when the JWKS is unreachable", async () => {
    await expect(fetchJwks("https://127.0.0.1:9/.well-known/crv-door-jwks.json")).rejects.toThrow(/unreachable/);
  });
});

describe("checkDeployment", () => {
  const manifestFile = () => path.join(dest, "deploy-manifest.json");
  const rewrite = async (change: (manifest: Record<string, unknown>) => void) => {
    const manifest = JSON.parse(await readFile(manifestFile(), "utf8"));
    change(manifest);
    await writeFile(manifestFile(), JSON.stringify(manifest));
  };

  it("refuses a static/ directory, which Amplify would serve around the gate", async () => {
    await bundle();
    await mkdir(path.join(dest, "static"));
    await expect(checkDeployment(dest)).rejects.toThrow(/static/);
  });

  it("refuses a second route", async () => {
    await bundle();
    await rewrite((manifest) => {
      (manifest.routes as unknown[]).unshift({ path: "/_next/static/*", target: { kind: "Static" } });
    });
    await expect(checkDeployment(dest)).rejects.toThrow(/more than one route/);
  });

  it("refuses a route that is not /* to Compute", async () => {
    await bundle();
    await rewrite((manifest) => {
      manifest.routes = [{ path: "/*", target: { kind: "Static" } }];
    });
    await expect(checkDeployment(dest)).rejects.toThrow(/Compute/);
  });

  it("refuses a bundle over the size limit", async () => {
    await bundle();
    await expect(checkDeployment(dest, 100)).rejects.toThrow(/over the 100 limit/);
  });
});

describe("the gate's files", () => {
  // The compute bundle has no node_modules: the gate may import Node's own modules and its own files, nothing else.
  it("import nothing but Node's modules and each other, and are exactly the files the bundle copies", async () => {
    const src = path.resolve(import.meta.dirname, "..", "src");
    const reached = new Set<string>();
    const visit = async (file: string) => {
      if (reached.has(file)) return;
      reached.add(file);
      const text = await readFile(path.join(src, file), "utf8");
      for (const [, specifier = ""] of text.matchAll(/^(?:import|export)[^"']*from\s+["']([^"']+)["']/gm)) {
        if (specifier.startsWith("node:")) continue;
        expect(specifier, `${file} imports ${specifier}`).toMatch(/^\.\.?\//);
        await visit(path.relative(src, path.resolve(path.dirname(path.join(src, file)), specifier)));
      }
    };
    await visit("door/server.ts");
    expect([...reached].map((file) => file.replace(/\.ts$/, ".js")).sort()).toEqual([...gateFiles].sort());
  });
});
