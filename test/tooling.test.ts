import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { describe, expect, it } from "vitest";

import { bundleDoor, gateFiles } from "../packages/site-tools/src/door/package.ts";
import { jwksOf, makeKey } from "../packages/site-tools/test/door-fixtures.ts";

/**
 * The shape of the repository: every package publishable under the one scope, at the one version, with exact
 * dependency pins and a licence from the family's allowlist; the release list in dependency order and complete.
 */
const root = resolve(import.meta.dirname, "..");

type Manifest = {
  name: string;
  version: string;
  private?: boolean;
  license?: string;
  homepage?: string;
  files?: string[];
  exports?: Record<string, unknown>;
  bin?: Record<string, string>;
  repository?: { directory?: string };
  publishConfig?: { access?: string };
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
};

const read = async (file: string) => JSON.parse(await readFile(join(root, file), "utf8")) as Manifest;

const packageDirs = async () => {
  const entries = await readdir(join(root, "packages"), { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
};

const exact = /^\d+\.\d+\.\d+(-[\w.]+)?$/;

describe("the packages", () => {
  it("are the four the family shares, and the release script names each one, in dependency order", async () => {
    const rootPkg = await read("package.json");
    const named = [...(rootPkg.scripts?.release ?? "").matchAll(/--filter (@coralreefventures\/[a-z-]+)/g)].map(
      (match) => match[1],
    );
    expect(named).toEqual([
      "@coralreefventures/theme",
      "@coralreefventures/contact",
      "@coralreefventures/site-tools",
      "@coralreefventures/site",
    ]);
    const dirs = await packageDirs();
    expect(dirs.map((dir) => `@coralreefventures/${dir}`).sort()).toEqual([...named].sort());
    // A package is published after every sibling it depends on, so what it points at exists on the registry.
    for (const [index, name] of named.entries()) {
      const manifest = await read(`packages/${name?.split("/")[1]}/package.json`);
      for (const dep of Object.keys(manifest.dependencies ?? {})) {
        if (dep.startsWith("@coralreefventures/")) {
          expect(named.indexOf(dep), `${name} depends on ${dep}, which must be released first`).toBeLessThan(index);
        }
      }
    }
  });

  it("are public, MIT, at the root's version, under the scope, and say where they live", async () => {
    const rootPkg = await read("package.json");
    for (const dir of await packageDirs()) {
      const manifest = await read(`packages/${dir}/package.json`);
      expect(manifest.name).toBe(`@coralreefventures/${dir}`);
      expect(manifest.private, `${dir} must not be private`).toBeUndefined();
      expect(manifest.license).toBe("MIT");
      expect(manifest.version).toBe(rootPkg.version);
      expect(manifest.publishConfig?.access).toBe("public");
      expect(manifest.repository?.directory).toBe(`packages/${dir}`);
      expect(manifest.homepage).toBe(rootPkg.homepage);
      expect(manifest.files).toContain("README.md");
      expect(manifest.exports?.["."]).toBeDefined();
    }
  });

  it("pin every dependency exactly, and ask for a sibling at the version released together", async () => {
    const rootPkg = await read("package.json");
    const manifests = [
      rootPkg,
      ...(await Promise.all((await packageDirs()).map((dir) => read(`packages/${dir}/package.json`)))),
    ];
    for (const manifest of manifests) {
      for (const [dep, range] of Object.entries({
        ...manifest.dependencies,
        ...manifest.devDependencies,
        ...manifest.peerDependencies,
      })) {
        if (dep.startsWith("@coralreefventures/")) {
          expect(range, `${manifest.name} → ${dep}`).toBe(`^${rootPkg.version}`);
        } else {
          expect(range, `${manifest.name} → ${dep} is not pinned exactly`).toMatch(exact);
        }
      }
    }
  });

  it("ship source where nothing needs a build, and compiled JavaScript only where a bin needs one", async () => {
    for (const dir of await packageDirs()) {
      const manifest = await read(`packages/${dir}/package.json`);
      const entry = manifest.exports?.["."];
      if (manifest.bin) {
        // Node refuses to strip types under node_modules, so a bin is JavaScript tsc wrote on prepack.
        expect(manifest.scripts?.prepack).toBeDefined();
        expect(manifest.files).toContain("dist");
        expect(entry).toMatchObject({ types: expect.stringMatching(/^\.\/dist\/.*\.d\.ts$/) });
        for (const bin of Object.values(manifest.bin)) {
          expect(bin).toMatch(/^\.\/dist\/bin\/[a-z-]+\.js$/);
        }
      } else {
        expect(entry).toMatch(/^\.\/src\/index\.tsx?$/);
        expect(manifest.files).toContain("src");
        expect(manifest.scripts?.build).toBeUndefined();
      }
    }
  });
});

describe("the toolchain", () => {
  it("pins pnpm in one place and names the Node the products run", async () => {
    const rootPkg = await read("package.json");
    expect((rootPkg as { packageManager?: string }).packageManager).toMatch(/^pnpm@\d+\.\d+\.\d+$/);
    expect((await readFile(join(root, ".nvmrc"), "utf8")).trim()).toBe("24");
  });

  it("keeps every Biome setting: a comment in a .json would have dropped what follows it", async () => {
    const text = await readFile(join(root, "biome.jsonc"), "utf8");
    const config = JSON.parse(text.replace(/^\s*\/\/.*$/gm, "")) as {
      linter: { rules: { style: Record<string, unknown>; suspicious: Record<string, unknown> } };
      overrides: unknown[];
    };
    expect(config.linter.rules.style.noDefaultExport).toBe("error");
    expect(config.linter.rules.style.useImportType).toBe("error");
    expect(config.linter.rules.suspicious.noConsole).toBeDefined();
    expect(config.overrides.length).toBeGreaterThanOrEqual(3);
  });

  it("names the repository and the site in the root manifest, and nowhere else by another value", async () => {
    const rootPkg = (await read("package.json")) as Manifest & { repository: { url: string } };
    expect(rootPkg.repository.url).toBe("git+https://github.com/Coral-Reef-Ventures/reef.git");
    expect(rootPkg.homepage).toBe("https://coralreefventures.com/");
    for (const dir of await packageDirs()) {
      const manifest = (await read(`packages/${dir}/package.json`)) as Manifest & { repository: { url: string } };
      expect(manifest.repository.url).toBe(rootPkg.repository.url);
    }
  });

  it("leaves no product's scope in anything that ships", async () => {
    const products = /@(streamlane|driftline)\//;
    for (const dir of await packageDirs()) {
      const manifest = await read(`packages/${dir}/package.json`);
      expect(JSON.stringify(manifest)).not.toMatch(products);
      for (const file of await sources(join(root, "packages", dir, "src"))) {
        expect(await readFile(file, "utf8"), file).not.toMatch(products);
      }
    }
  });
});

describe("the door's deployment", () => {
  // The lock depends on this shape: a Static route, or a static/ directory, would be served by Amplify around the gate.
  it("has exactly one route, /* to Compute, and no static/ directory", async () => {
    const work = await mkdtemp(join(tmpdir(), "reef-tooling-door-"));
    try {
      await mkdir(join(work, "out"));
      await writeFile(join(work, "out", "index.html"), "<h1>Home</h1>");
      for (const file of gateFiles) {
        await mkdir(dirname(join(work, "dist", file)), { recursive: true });
        await writeFile(join(work, "dist", file), "");
      }
      await writeFile(join(work, "jwks.json"), JSON.stringify(jwksOf(makeKey())));
      const dest = join(work, ".amplify-hosting");
      await bundleDoor({
        site: "tooling",
        out: join(work, "out"),
        dest,
        doorUrl: "https://door.example",
        hosts: ["site.example"],
        jwksUrl: pathToFileURL(join(work, "jwks.json")).href,
        gateRoot: join(work, "dist"),
      });
      const manifest = JSON.parse(await readFile(join(dest, "deploy-manifest.json"), "utf8"));
      expect(manifest.routes).toEqual([{ path: "/*", target: { kind: "Compute", src: "default" } }]);
      expect((await readdir(dest)).sort()).toEqual(["compute", "deploy-manifest.json"]);
    } finally {
      await rm(work, { recursive: true, force: true });
    }
  });
});

const sources = async (directory: string): Promise<string[]> => {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map((entry) =>
      entry.isDirectory() ? sources(join(directory, entry.name)) : [join(directory, entry.name)],
    ),
  );
  return nested.flat();
};
