import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { access, constants, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

import { describe, expect, it } from "vitest";

import {
  commandFor,
  declaredPort,
  defaultRoot,
  dekitConfig,
  labelOf,
  type Manifest,
  nodeSatisfies,
  repositories,
  rootOf,
  SITES,
} from "../tools/sites/config.ts";

/**
 * The sites launcher (tools/sites): its map against the README's, the dekit.yaml it writes, and, on a machine with the
 * sibling repositories beside reef, that every command it runs is one its repository defines.
 */
const reef = resolve(import.meta.dirname, "..");
const toolDir = join(reef, "tools", "sites");
const run = promisify(execFile);

describe("the port map", () => {
  it("gives every site its own name and port, in port order", () => {
    const ports = SITES.map((site) => site.port);
    expect(new Set(ports).size).toBe(ports.length);
    expect(new Set(SITES.map((site) => site.name)).size).toBe(SITES.length);
    expect([...ports].sort((a, b) => a - b)).toEqual(ports);
    expect(SITES.map(labelOf)).toContain("crv 3002");
  });

  it("is the map tools/sites/README.md shows, row for row", async () => {
    const readme = await readFile(join(toolDir, "README.md"), "utf8");
    const rows = [...readme.matchAll(/^\| (\d+) \| `([a-z-]+)` \| ([^|]+?) \| `([a-z-]+)` \|/gm)].map((match) => ({
      port: Number(match[1]),
      name: match[2],
      what: match[3],
      repo: match[4],
    }));
    expect(rows).toEqual(SITES.map(({ port, name, what, repo }) => ({ port, name, what, repo })));
  });
});

describe("the dekit.yaml it writes", () => {
  it("has one task per site, in port order, in its repository's root, with a ready check on its port", () => {
    const commands = new Map(SITES.map((site) => [site.name, ["pnpm", "run", site.name]]));
    const text = dekitConfig("/repos", commands);
    expect([...text.matchAll(/^ {2}([a-z-]+):$/gm)].map((match) => match[1])).toEqual(SITES.map((site) => site.name));
    for (const site of SITES) {
      const task = text.slice(text.indexOf(`  ${site.name}:\n`)).split(/\n(?= {2}[a-z])/)[0] ?? "";
      expect(task).toContain(`label: "${site.name} ${site.port}"`);
      expect(task).toContain(`cwd: "/repos/${site.repo}"`);
      expect(task).toContain(`cmd: ["pnpm", "run", "${site.name}"]`);
      expect(task).toContain(`ready: {tcp: ${site.port}}`);
    }
  });

  it("keeps a task whose command cannot be found, as one that fails, so the list keeps its order", () => {
    expect(dekitConfig("/repos", new Map())).toContain('cmd: ["false"]');
  });
});

describe("finding things", () => {
  it("finds the repositories beside reef's checkout, from a worktree too, unless SITES_ROOT names them", () => {
    expect(defaultRoot("/code/reef/tools/sites")).toBe("/code");
    expect(defaultRoot("/code/reef/.claude/worktrees/sites/tools/sites")).toBe("/code");
    expect(rootOf("/code/reef/tools/sites", { SITES_ROOT: "/elsewhere" })).toBe("/elsewhere");
  });

  it("runs a script the repository defines, and refuses one it does not", () => {
    const site = SITES.find((candidate) => candidate.name === "markset");
    if (!site) throw new Error("markset is on the map");
    expect(commandFor(site, { scripts: { "site:watch": "node site/serve.ts" } })).toEqual({
      argv: ["pnpm", "run", "site:watch", "--port", "3003"],
    });
    expect(commandFor(site, { scripts: {} })).toHaveProperty("error");
  });

  it("runs Atlas with the repository's own @intentset/cli, or the version its scripts pin", () => {
    const atlas = SITES.find((candidate) => candidate.name === "atlas");
    if (!atlas) throw new Error("atlas is on the map");
    expect(commandFor(atlas, { devDependencies: { "@intentset/cli": "0.6.1" } })).toEqual({
      argv: ["pnpm", "exec", "intentset", "serve", "--port", "3000"],
    });
    expect(commandFor(atlas, { scripts: { help: "pnpm dlx @intentset/cli@0.6.1 publish" } })).toEqual({
      argv: ["pnpm", "dlx", "@intentset/cli@0.6.1", "serve", "--port", "3000"],
    });
    expect(commandFor(atlas, {})).toHaveProperty("error");
  });

  it("reads a Next script's port and a >= engines range", () => {
    expect(declaredPort("tsx scripts/prepare-assets.ts && next dev -p 3005")).toBe(3005);
    expect(declaredPort("next dev --port=3002")).toBe(3002);
    expect(declaredPort("next dev")).toBeUndefined();
    expect(nodeSatisfies(">=24", "v24.15.0")).toBe(true);
    expect(nodeSatisfies(">=22.18", "v22.17.1")).toBe(false);
    expect(nodeSatisfies("^24", "v24.15.0")).toBeUndefined();
    expect(nodeSatisfies(undefined, "v20.0.0")).toBe(true);
  });
});

describe("the command", () => {
  it("is an executable shim, run as `pnpm sites` inside reef", async () => {
    await access(join(toolDir, "sites"), constants.X_OK);
    const manifest = JSON.parse(await readFile(join(reef, "package.json"), "utf8")) as Manifest;
    expect(manifest.scripts?.sites).toBe("tools/sites/sites");
  });

  it("lists every site in its help, and exits 2 on a command it does not know", async () => {
    const { stdout } = await run(join(toolDir, "sites"), ["--help"]);
    for (const site of SITES) expect(stdout).toMatch(new RegExp(`^ {2}${site.name} +${site.port} `, "m"));
    await expect(run(join(toolDir, "sites"), ["launch"])).rejects.toMatchObject({ code: 2 });
  });
});

// The sibling repositories are on a developer's machine, not in CI.
const root = defaultRoot(toolDir);
const absent = repositories().filter((repo) => !existsSync(join(root, repo, "package.json")));

describe.skipIf(absent.length > 0)(
  `every command, against the repositories in ${root}${absent.length ? ` (skipped: ${absent.join(", ")} absent)` : ""}`,
  () => {
    it("names a script its repository defines, or for Atlas, the @intentset/cli the repository pins", async () => {
      for (const site of SITES) {
        const manifest = JSON.parse(await readFile(join(root, site.repo, "package.json"), "utf8")) as Manifest;
        expect(commandFor(site, manifest), site.name).toHaveProperty("argv");
      }
    });
  },
);
