import { homedir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";

/**
 * Every site on the family's port map, in port order: the tools first, then the five public sites in family order,
 * parent first (Gary's map, 2026-10-05). The order here is the order of the launcher's task list. The map in
 * README.md is the same table for people, and a test holds the two together.
 */

/** How a site is started, in its repository's root. */
export type Run =
  /** `pnpm run <script> [args]`: a script the repository's own package.json defines. */
  | { readonly script: string; readonly args?: readonly string[] }
  /** The repository's pinned `@intentset/cli`, with these arguments. */
  | { readonly intentset: readonly string[] };

export type Site = {
  /** The task's name, in the TUI and on the command line (`sites restart crv`). */
  readonly name: string;
  readonly port: number;
  /** What it is, as the map in README.md says it. */
  readonly what: string;
  /** The repository's directory, a sibling of reef's. */
  readonly repo: string;
  readonly run: Run;
  /**
   * Where the port is written down when the launcher does not pass it: a Next app's `dev` script says `-p <port>`.
   * The preflight warns when that script names another port, which means the repository predates the map.
   */
  readonly declares?: { readonly file: string; readonly script: string };
  /** A file the site needs and starts without, with what goes wrong: the preflight warns when it is missing. */
  readonly needs?: { readonly file: string; readonly why: string };
  /**
   * A second, https address the site serves beside its port, and the certificate that side needs. Without the
   * certificate the site still starts on its port and the https side stays off, so the preflight warns, with the
   * command that makes it: that command asks for a sudo password, which a launcher task cannot answer.
   */
  readonly https?: { readonly port: number; readonly certificate: string; readonly make: string };
};

export const SITES: readonly Site[] = [
  {
    name: "atlas",
    port: 3000,
    what: "Intentset Atlas over Streamlane's model",
    repo: "streamlane",
    run: { intentset: ["serve", "--port", "3000"] },
  },
  {
    name: "streamlane",
    port: 3001,
    what: "Streamlane, the product (apps/web)",
    repo: "streamlane",
    run: { script: "dev" },
    declares: { file: "apps/web/package.json", script: "dev" },
    needs: {
      file: "amplify_outputs.json",
      why: "it starts, but has no backend to sign in against; the sandbox writes it (pnpm sandbox, Streamlane's README)",
    },
    // Streamlane #514 (2026-10-10): its pnpm dev proxies https://localhost:3443 to 3001, for Slack's https redirect.
    https: {
      port: 3443,
      certificate: "apps/web/certificates/localhost.pem",
      make: "cd apps/web && pnpm exec next dev -p 3001 --experimental-https",
    },
  },
  {
    name: "crv",
    port: 3002,
    what: "coralreefventures.com, the CRV app (apps/web)",
    repo: "coral-reef-site",
    run: { script: "web:dev" },
    declares: { file: "apps/web/package.json", script: "dev" },
  },
  {
    name: "markset",
    port: 3003,
    what: "markset.org",
    repo: "markset",
    run: { script: "site:watch", args: ["--port", "3003"] },
  },
  {
    name: "intentset",
    port: 3004,
    what: "intentset.org",
    repo: "intentset",
    run: { script: "site:watch", args: ["--port", "3004"] },
  },
  {
    name: "streamlane-site",
    port: 3005,
    what: "streamlane.app (apps/site)",
    repo: "streamlane",
    run: { script: "site:watch" },
    declares: { file: "apps/site/package.json", script: "dev" },
  },
  {
    name: "driftline-site",
    port: 3006,
    what: "driftline.app (apps/site)",
    repo: "driftline",
    run: { script: "site:watch" },
    declares: { file: "apps/site/package.json", script: "dev" },
  },
];

/** The environment variable that names the directory holding the repositories, when it is not reef's parent. */
export const ROOT_VARIABLE = "SITES_ROOT";

/**
 * The directory holding reef and its siblings: reef's parent, found from this file's own location so the repository
 * stays portable. A worktree under `.claude/worktrees/` counts as the checkout it belongs to.
 */
export const defaultRoot = (toolDir: string): string => {
  const reef = resolve(toolDir, "..", "..");
  const marker = `${sep}.claude${sep}worktrees${sep}`;
  const checkout = reef.includes(marker) ? reef.slice(0, reef.indexOf(marker)) : reef;
  return dirname(checkout);
};

export const rootOf = (toolDir: string, env: Readonly<Record<string, string | undefined>>): string => {
  const named = env[ROOT_VARIABLE];
  return named ? resolve(named) : defaultRoot(toolDir);
};

/**
 * The runner's project directory, where dekit.yaml is written: one per machine, outside every checkout, so `sites stop`
 * from any checkout reaches the sites a worktree started, and removing that worktree cannot strand a runner holding the
 * ports. `$XDG_STATE_HOME/coral-reef-sites`, or `~/.local/state/coral-reef-sites`.
 */
export const runnerDirOf = (env: Readonly<Record<string, string | undefined>>, home = homedir()): string =>
  join(env.XDG_STATE_HOME || join(home, ".local", "state"), "coral-reef-sites");

export type Manifest = {
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  engines?: { node?: string };
};

/** The command a site runs, as an argv, or why it cannot be found in the repository's manifest. */
export const commandFor = (site: Site, manifest: Manifest): { argv: string[] } | { error: string } => {
  const run = site.run;
  if ("script" in run) {
    if (!manifest.scripts?.[run.script]) {
      return { error: `${site.repo}'s package.json has no "${run.script}" script` };
    }
    return { argv: ["pnpm", "run", run.script, ...(run.args ?? [])] };
  }
  // Installed in the repository: its own bin. Otherwise the version its scripts pin for `pnpm dlx`.
  if (manifest.dependencies?.["@intentset/cli"] || manifest.devDependencies?.["@intentset/cli"]) {
    return { argv: ["pnpm", "exec", "intentset", ...run.intentset] };
  }
  const pinned = Object.values(manifest.scripts ?? {})
    .map((script) => /@intentset\/cli@(\d+\.\d+\.\d+[\w.-]*)/.exec(script)?.[1])
    .find((version) => version !== undefined);
  if (pinned) {
    return { argv: ["pnpm", "dlx", `@intentset/cli@${pinned}`, ...run.intentset] };
  }
  return { error: `${site.repo} neither depends on @intentset/cli nor pins a version of it in a script` };
};

/** The port a Next app's script listens on (`-p 3001`, `--port 3001`), when the script names one. */
export const declaredPort = (script: string | undefined): number | undefined => {
  const match = /(?:^|\s)(?:-p|--port)[\s=](\d+)/.exec(script ?? "");
  return match?.[1] ? Number(match[1]) : undefined;
};

/** Whether the running Node satisfies an `engines.node` of the form `>=X`, `>=X.Y` or `>=X.Y.Z`. */
export const nodeSatisfies = (range: string | undefined, version: string): boolean | undefined => {
  if (!range) return true;
  const want = /^\s*>=\s*v?(\d+)(?:\.(\d+))?(?:\.(\d+))?\s*$/.exec(range);
  if (!want) return undefined;
  const have = version.replace(/^v/, "").split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    const a = have[i] ?? 0;
    const b = Number(want[i + 1] ?? 0);
    if (a !== b) return a > b;
  }
  return true;
};

/** The preflight's warning for a site whose https side cannot start yet, or undefined when it can or has none. */
export const httpsWarning = (site: Site, certificateExists: boolean): string | undefined =>
  site.https && !certificateExists
    ? `no ${site.https.certificate}, so https://localhost:${site.https.port} stays off (http://localhost:${site.port} ` +
      `runs). To make it, once, in a terminal in ${site.repo}: ${site.https.make}, enter your password, Ctrl-C once ` +
      `it is ready, then sites restart ${site.name}`
    : undefined;

/** A task's label: what it is and its port, as the TUI lists it. */
export const labelOf = (site: Site): string => `${site.name} ${site.port}`;

const quote = (text: string): string => JSON.stringify(text);

/**
 * The command for a site that cannot run as things stand: it prints why and fails, so an `r` in the TUI says what is
 * wrong instead of silently running nothing. The reason is the shell's $1, so it needs no quoting.
 */
export const unavailable = (reason: string): string[] => [
  "sh",
  "-c",
  'echo "sites: $1. Fix that, then run sites again." >&2; exit 1',
  "sites",
  reason,
];

/**
 * The dekit.yaml the runner reads: one task per site, in port order, each in its repository's root with a ready check
 * on its port. A command is an argv, or the reason there is none. JSON strings are YAML strings, so every value is
 * written with JSON.stringify.
 */
export const dekitConfig = (
  root: string,
  commands: ReadonlyMap<string, readonly string[] | { readonly error: string }>,
  nodeDir: string,
): string => {
  const lines = [
    "# Written by tools/sites/sites on each run, from tools/sites/config.ts. Edit that file, not this one.",
    // Every task runs the Node that ran sites, whatever PATH the runner was started with: the runner outlives the
    // terminal that started it, so a Node removed or switched since (Homebrew's for nvm's, 2026-10-09) would otherwise
    // leave each restart with no node at all. The preflight checks each site's engines against this same Node.
    "defaults:",
    `  add_path: [${quote(nodeDir)}]`,
    "tasks:",
  ];
  for (const site of SITES) {
    // A site whose command cannot be found still gets a task, so the list keeps its order; the preflight skips it,
    // and the task itself says why if it is started from the TUI.
    const command = commands.get(site.name) ?? { error: `no command for ${site.name}` };
    const argv = "error" in command ? unavailable(command.error) : command;
    lines.push(
      `  ${site.name}:`,
      `    label: ${quote(labelOf(site))}`,
      `    cwd: ${quote(join(root, site.repo))}`,
      `    cmd: [${argv.map(quote).join(", ")}]`,
      `    ready: {tcp: ${site.port}}`,
    );
  }
  return `${lines.join("\n")}\n`;
};

/** A task that is starting, running, ready or stopping holds (or is about to hold) its port. */
export const isActive = (state: string | undefined): boolean =>
  state !== undefined && !/^(idle|exited|done|backoff)/.test(state);

/** A task on its way down: stopped (`x`), restarting (`r`), or, with every other task, stopped by `Q`. */
export const isStopping = (state: string | undefined): boolean => state?.startsWith("stopping") ?? false;

/**
 * How many sites the TUI left running, from the task states read once `dekit attach` has returned, or undefined while a
 * task is stopping and it is too soon to tell. attach exits 0 on `q` and on `Q` alike, within milliseconds of the key,
 * so the states are the only evidence (tried 2026-10-05): after `q` they are as they were, and after `Q` every task is
 * stopping until it exits, then the runner exits and there are no states at all. A task stopped or restarted just
 * before `q` is stopping too, and a restart comes back, so a stopping task means read again. Once the wait is over
 * (`final`), a task still stopping is on its way down and is not counted.
 */
export const leftRunning = (states: Iterable<string>, final = false): number | undefined => {
  const all = [...states];
  if (!final && all.some(isStopping)) return undefined;
  return all.filter((state) => isActive(state) && !isStopping(state)).length;
};

/** The repositories the sites live in, once each, in map order. */
export const repositories = (): string[] => [...new Set(SITES.map((site) => site.repo))];
