/**
 * Install the published packages into an empty project and use them, as a consumer would. Everything else in the
 * suite runs inside the workspace; this is the one check that sees what a consumer's install resolves, and pnpm's
 * strict layout also catches a package that imports something it does not declare.
 *
 *   node test/consumer/smoke.ts --packed              pack each package and install the tarballs
 *   node test/consumer/smoke.ts --registry <version>  install that version from the registry
 *
 * The release workflow runs --packed before it publishes and --registry after. Three of the four packages ship
 * TypeScript source (the site's with CSS modules), which Node will not run from node_modules, so the consumer
 * bundles them with esbuild first, as Next (transpilePackages), tsx, Vitest or Amplify's function bundler would,
 * and runs the bundle. Only the peers and Node's own modules stay outside it.
 */
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { build } from "esbuild";

const root = resolve(import.meta.dirname, "..", "..");
const release = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).scripts.release as string;
const PACKAGES = [...release.matchAll(/--filter (@coralreefventures\/[a-z-]+)/g)].map((m) => m[1] ?? "");

/** What a consumer adds for the peers: React and Next for the shell, Mantine for the theme. */
const PEERS = ["react@19.3.0", "react-dom@19.3.0", "next@16.3.6", "@mantine/core@9.6.3", "@mantine/hooks@9.6.3"];

// pnpm run hands a "--" on to the script; a release once asked the registry for version "--".
const args = process.argv.slice(2).filter((arg) => arg !== "--");
const mode = args[0];
const version = args[1] ?? "";
const project = mkdtempSync(join(tmpdir(), "reef-consumer-"));
const run = (command: string, commandArgs: string[], cwd = project) =>
  execFileSync(command, commandArgs, { cwd, stdio: ["ignore", "pipe", "inherit"], encoding: "utf8" });

try {
  writeFileSync(join(project, "package.json"), JSON.stringify({ name: "consumer", private: true, type: "module" }));
  // A release is installed minutes after it is published, inside the three-day hold the workspace keeps, so the
  // hold is lifted here; and the esbuild the bundle step needs may build its binary.
  const settings = [
    "minimumReleaseAge: 0",
    "allowBuilds:",
    "  esbuild: true",
    "  sharp: false",
    "  unrs-resolver: false",
  ];
  let specs: string[];
  if (mode === "--packed") {
    const packs = join(project, "packs");
    mkdirSync(packs);
    for (const name of PACKAGES) run("pnpm", ["--filter", name, "pack", "--pack-destination", packs], root);
    specs = readdirSync(packs).map((file) => join(packs, file));
  } else if (mode === "--registry" && /^\d+\.\d+\.\d+(-[\w.]+)?$/.test(version)) {
    specs = PACKAGES.map((name) => `${name}@${version}`);
  } else {
    throw new Error("usage: smoke.ts --packed | --registry <version>");
  }
  writeFileSync(join(project, "pnpm-workspace.yaml"), `${settings.join("\n")}\n`);
  // The registry can take minutes to serve every version it has just accepted. Twenty minutes, then fail.
  for (let attempt = 1; ; attempt++) {
    try {
      run("pnpm", ["add", "--prefer-offline=false", "--reporter=silent", ...specs, ...PEERS]);
      break;
    } catch (error) {
      if (mode !== "--registry" || attempt === 40) throw error;
      console.log(`consumer: the registry does not have every package yet; waiting (attempt ${attempt})`);
      execFileSync("sleep", ["30"]);
    }
  }
  // The packages as a bundler sees them: TypeScript, JSX and CSS modules resolved from the consumer's node_modules.
  copyFileSync(join(import.meta.dirname, "consumer-entry.tsx"), join(project, "consumer-entry.tsx"));
  await build({
    absWorkingDir: project,
    entryPoints: [join(project, "consumer-entry.tsx")],
    outfile: join(project, "consumer-bundle.mjs"),
    bundle: true,
    format: "esm",
    platform: "node",
    jsx: "automatic",
    external: ["react", "react/*", "react-dom", "react-dom/*", "next", "next/*", "@mantine/*"],
    // Next's own bundler resolves `next/og`; Node wants the file, next/og.js. Still external: it is a peer.
    plugins: [
      {
        name: "next-og",
        setup: (api) => api.onResolve({ filter: /^next\/og$/ }, () => ({ path: "next/og.js", external: true })),
      },
    ],
    logLevel: "warning",
  });
  copyFileSync(join(import.meta.dirname, "consumer.mjs"), join(project, "consumer.mjs"));
  process.stdout.write(run("node", ["consumer.mjs"]));
} finally {
  rmSync(project, { recursive: true, force: true });
}
