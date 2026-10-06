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

describe("the READMEs", () => {
  // npm shows a package's README as its page, so the page an adopter lands on first names what they installed.
  it("open each package's README with the package's name", async () => {
    for (const dir of await packageDirs()) {
      const readme = await readFile(join(root, "packages", dir, "README.md"), "utf8").catch(() => "");
      expect(readme, `packages/${dir}/README.md`).toMatch(new RegExp(`^# @coralreefventures/${dir}$`, "m"));
    }
  });

  // A README that says "four packages" and lists three is stale the day a fifth ships; Markset's said seven and named six.
  it("name every published package in the root README's Status, with the count and the version", async () => {
    const rootPkg = await read("package.json");
    const readme = await readFile(join(root, "README.md"), "utf8");
    const status = /^## Status\n\n([\s\S]*?)\n## /m.exec(readme)?.[1] ?? "";
    expect(status, "the README has a Status section").not.toBe("");
    expect(status).toContain(`\`${rootPkg.version}\``);
    const sentence = /(\w+) packages are published under the `@coralreefventures`\s+scope: ([^.]*)\./.exec(status);
    expect(sentence, "the Status sentence that lists the published packages").not.toBeNull();
    const words: Record<string, number> = { three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8 };
    const dirs = await packageDirs();
    expect(words[sentence?.[1]?.toLowerCase() ?? ""], `the count says ${sentence?.[1]}`).toBe(dirs.length);
    for (const dir of dirs) {
      expect(sentence?.[2], `the README does not name ${dir}`).toContain(`\`${dir}\``);
    }
  });
});

describe("the release", () => {
  const workflow = () => readFile(join(root, ".github", "workflows", "release.yml"), "utf8");

  // A tag can be pushed from anywhere, so the release re-proves the gate rather than trusting that CI ran on the commit.
  it("proves the build before it publishes, and the registry's copy after", async () => {
    const yaml = await workflow();
    expect(yaml).toMatch(/tags: \["v\[0-9\]\*"\]/);
    expect(yaml).toMatch(/id-token: write/);
    expect(yaml).toMatch(/--provenance/);
    for (const step of [
      "pnpm install --frozen-lockfile",
      "pnpm run lint",
      "pnpm run typecheck",
      "pnpm test",
      "pnpm run e2e",
      "pnpm run smoke:packed",
    ]) {
      expect(yaml.indexOf(step), `the release runs ${step} before it publishes`).toBeGreaterThan(-1);
      expect(yaml.indexOf(step)).toBeLessThan(yaml.indexOf(" publish --provenance"));
    }
    expect(yaml).toMatch(/does not match package version/);
    // Only on a tag: on a manual run GITHUB_REF_NAME is the branch, which can never equal a version.
    expect(yaml).toMatch(/if: startsWith\(github\.ref, 'refs\/tags\/'\)/);
    expect(yaml.indexOf("pnpm run smoke:registry")).toBeGreaterThan(yaml.indexOf(" publish --provenance"));
    // pnpm run hands a "--" to the script rather than swallowing it, so the registry check would ask for version "--".
    expect(yaml).not.toMatch(/pnpm run [\w:-]+ --\s/);
  });

  // The registry answers a second publish of a version with a 403, which would fail the step and strand every package
  // after it; a re-pushed tag or a re-run after a partial publish has to skip what is out and carry on.
  it("can be run a second time without failing", async () => {
    const yaml = await workflow();
    expect(yaml).toMatch(/curl -sf -o \/dev\/null "https:\/\/registry\.npmjs\.org/);
    // Over plain HTTPS: a client's view fails on a bad credential, which would read as "not published".
    expect(yaml).not.toMatch(/(npm|pnpm) view/);
    expect(yaml).not.toMatch(/pnpm run release/);
    // One list: the workflow walks the release script's, which the first test here holds in dependency order.
    expect(yaml).toMatch(/scripts\.release\.match/);
    // Trusted publishing over OIDC: an .npmrc with an empty _authToken would be tried, refused, and stop it there.
    expect(yaml).not.toMatch(/NODE_AUTH_TOKEN/);
    expect(yaml).not.toMatch(/registry-url/);
  });

  // A private registry in one contributor's ~/.npmrc is written into the lockfile as the tarball URL for what it
  // served, and a frozen install elsewhere then fails with a 401 for a package nobody added. pnpm records a registry
  // package by integrity alone and writes a tarball URL only for one from somewhere else, so any such URL is foreign.
  it("installs every dependency from the public registry", async () => {
    const lock = await readFile(join(root, "pnpm-lock.yaml"), "utf8");
    const foreign = [...lock.matchAll(/tarball: (\S+)/g)]
      .map((match) => match[1])
      .filter((url) => !url?.startsWith("https://registry.npmjs.org/"));
    expect(foreign).toEqual([]);
    expect(await readFile(join(root, "package-lock.json"), "utf8").catch(() => "")).toBe("");
  });
});

describe("the family conventions", () => {
  // Every agent session in three repositories may read docs/conventions.md, and a conventions file that grows without
  // bound becomes the done-log it was written to replace.
  it("stay under 300 lines, and the README and CLAUDE.md point at them", async () => {
    const text = await readFile(join(root, "docs", "conventions.md"), "utf8");
    expect(text.split("\n").length).toBeLessThan(300);
    expect(text).toMatch(/^# Family conventions$/m);
    for (const file of ["README.md", "CLAUDE.md"]) {
      expect(await readFile(join(root, file), "utf8"), file).toContain("the conventions Markset and Intentset follow");
    }
  });

  // Gary's decision of 2026-10-06: both product sites' footers are a link row, then one line in this order. The sites'
  // own tests hold their footers; this holds the rule they are written to.
  it("give the footer as a link row, then one line with its exact link texts", async () => {
    const text = await readFile(join(root, "docs", "conventions.md"), "utf8");
    const footer = text.slice(text.indexOf("### Footer\n"), text.indexOf("### Status labels and voice"));
    expect(footer).toContain('<nav class="site-footer-nav" aria-label="Footer">');
    expect(footer).toContain(
      "<strong>Name</strong> · one-sentence statement · Source on GitHub · A Coral Reef Ventures project · Sibling project: <sibling>",
    );
    expect(footer.indexOf("site-footer-nav")).toBeLessThan(footer.indexOf("<strong>Name</strong>"));
    expect(footer).toContain("Origin: Gary's decision of 2026-10-06.");
    expect(text).toContain("`apps/web/lib/product-facts.ts` in coral-reef-site");
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
