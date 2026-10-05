import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { connect } from "node:net";
import { join, relative, sep } from "node:path";

import {
  commandFor,
  declaredPort,
  dekitConfig,
  labelOf,
  type Manifest,
  nodeSatisfies,
  ROOT_VARIABLE,
  rootOf,
  SITES,
  type Site,
} from "./config.ts";

/**
 * `sites`: every Coral Reef site under one dekit runner, with one terminal UI for all of them. This file is the command;
 * config.ts is the map. README.md says why dekit, and which mode of it.
 */

const toolDir = import.meta.dirname;
const root = rootOf(toolDir, process.env);
/** The runner's project directory: dekit.yaml is written here on each run, with this machine's absolute paths. */
const runnerDir = join(toolDir, ".dekit");

const HELP = `sites: start every Coral Reef site, and watch, stop and restart each from one terminal UI.

Usage:
  sites [--no-attach]    start each site that is not running, then open the TUI (--no-attach: only start them)
  sites stop             stop every site and the runner (also: sites down)
  sites status           each site, its port, whether it answers, and the pid and directory holding the port
  sites restart <name>   restart one site, or start it if it is stopped
  sites --help

Sites, in port order:
${SITES.map((site) => `  ${site.name.padEnd(16)} ${site.port}  ${site.what}`).join("\n")}

In the TUI: j/k or the arrows pick a site; s starts it, x stops it, X kills it, r restarts it; C-a moves between the
list and the output (to scroll, or type into the site); z zooms the output; q leaves the TUI with the sites running;
Q stops every site and the runner, as sites stop does; ? shows every key.

The repositories are found beside reef's checkout (${root}); set ${ROOT_VARIABLE} to look elsewhere.
Needs dekit (brew install mprocs: Homebrew's mprocs formula installs dekit since 0.10).`;

class Failure extends Error {}

type Result = { status: number; stdout: string };

const dekit = (args: string[], inherit = false): Result => {
  const result = spawnSync("dekit", ["-C", runnerDir, ...args], {
    encoding: "utf8",
    stdio: inherit ? "inherit" : ["ignore", "pipe", "pipe"],
  });
  if (result.error) {
    throw new Failure(
      `sites: cannot run dekit (${result.error.message}). Install it with: brew install mprocs (the formula installs dekit)`,
    );
  }
  return { status: result.status ?? 1, stdout: `${result.stdout ?? ""}${result.stderr ?? ""}`.trim() };
};

const run = (command: string, args: string[]): string =>
  spawnSync(command, args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).stdout ?? "";

const runnerRunning = (): boolean => dekit(["runner", "status"]).stdout.startsWith("[running]");

/** Each task's state by name, from the runner; empty when the runner is not running. */
const taskStates = (): Map<string, string> => {
  if (!runnerRunning()) return new Map();
  const listed = JSON.parse(dekit(["ls", "--json"]).stdout || "{}") as { tasks?: { path: string; state: string }[] };
  return new Map((listed.tasks ?? []).map((task) => [task.path, task.state]));
};

/** A task that is starting, running, ready or stopping holds (or is about to hold) its port. */
const isActive = (state: string | undefined): boolean =>
  state !== undefined && !/^(idle|exited|done|backoff)/.test(state);

const repoDir = (site: Site): string => join(root, site.repo);

const manifestOf = (site: Site): Manifest | undefined => {
  try {
    return JSON.parse(readFileSync(join(repoDir(site), "package.json"), "utf8")) as Manifest;
  } catch {
    return undefined;
  }
};

const commandOf = (site: Site): { argv: string[] } | { error: string } => {
  const manifest = manifestOf(site);
  return manifest ? commandFor(site, manifest) : { error: `no package.json in ${repoDir(site)}` };
};

/** Write dekit.yaml when it changed; a running runner reloads it, and its tasks keep running. */
const writeConfig = (): void => {
  const commands = new Map<string, string[]>();
  for (const site of SITES) {
    const command = commandOf(site);
    if ("argv" in command) commands.set(site.name, command.argv);
  }
  const text = dekitConfig(root, commands);
  const file = join(runnerDir, "dekit.yaml");
  const before = existsSync(file) ? readFileSync(file, "utf8") : undefined;
  if (text === before) return;
  mkdirSync(runnerDir, { recursive: true });
  writeFileSync(file, text);
  if (before !== undefined && runnerRunning()) dekit(["runner", "restart"]);
};

type Holder = { pid: number; command: string; cwd: string | undefined };

/** Whatever is listening on the port: its pid, its command line and its working directory. */
const holderOf = (port: number): Holder | undefined => {
  const pid = Number(
    run("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-t"])
      .split("\n")
      .find((line) => line.trim()),
  );
  if (!pid) return undefined;
  const command = run("ps", ["-o", "command=", "-p", String(pid)]).trim();
  const cwd = run("lsof", ["-a", "-p", String(pid), "-d", "cwd", "-Fn"])
    .split("\n")
    .find((line) => line.startsWith("n"))
    ?.slice(1);
  return { pid, command, cwd };
};

const real = (path: string): string => {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
};

/** A process working in the site's repository (not in one of its agents' worktrees) is that site, run by hand. */
const belongsTo = (cwd: string | undefined, site: Site): boolean => {
  if (!cwd) return false;
  const dir = real(repoDir(site));
  return (cwd === dir || cwd.startsWith(dir + sep)) && !cwd.startsWith(join(dir, ".claude") + sep);
};

const shown = (path: string | undefined): string => {
  if (!path) return "?";
  const inside = relative(real(root), path);
  return inside && !inside.startsWith("..") ? inside : path;
};

const describe = (holder: Holder): string =>
  `pid ${holder.pid} (${holder.command.slice(0, 80)}) in ${shown(holder.cwd)}`;

type Verdict =
  | { kind: "start"; warnings: string[] }
  | { kind: "running" }
  | { kind: "outside"; holder: Holder }
  | { kind: "skip"; reason: string };

/** Whether a site can start: its repository, the port, its install, its command and Node, then what to warn about. */
const preflight = (site: Site, state: string | undefined): Verdict => {
  const dir = repoDir(site);
  if (!existsSync(dir))
    return { kind: "skip", reason: `no repository at ${dir} (set ${ROOT_VARIABLE} to look elsewhere)` };
  if (isActive(state)) return { kind: "running" };
  const holder = holderOf(site.port);
  if (holder && belongsTo(holder.cwd, site)) return { kind: "outside", holder };
  if (holder) {
    return { kind: "skip", reason: `port ${site.port} is held by ${describe(holder)}; it was not killed` };
  }
  if (!existsSync(join(dir, "node_modules"))) {
    return { kind: "skip", reason: `not installed; run: cd ${dir} && pnpm install` };
  }
  const command = commandOf(site);
  if ("error" in command) return { kind: "skip", reason: command.error };
  const engines = manifestOf(site)?.engines?.node;
  const node = nodeSatisfies(engines, process.version);
  if (node === false) return { kind: "skip", reason: `needs Node ${engines}, and this is ${process.version}` };
  // Started anyway, it would take another site's port, or fail on it.
  const port = portDeclared(site);
  if (port !== undefined && port !== site.port) {
    return {
      kind: "skip",
      reason: `its ${site.declares?.file} serves on ${port}, not ${site.port}; pull ${site.repo} for the port map`,
    };
  }
  return { kind: "start", warnings: warningsFor(site, engines, node) };
};

/** The port a Next app's own script names, for a site whose port the launcher does not pass. */
const portDeclared = (site: Site): number | undefined => {
  if (!site.declares) return undefined;
  try {
    const app = JSON.parse(readFileSync(join(repoDir(site), site.declares.file), "utf8")) as Manifest;
    return declaredPort(app.scripts?.[site.declares.script]);
  } catch {
    return undefined;
  }
};

const warningsFor = (site: Site, engines: string | undefined, node: boolean | undefined): string[] => {
  const warnings: string[] = [];
  if (node === undefined) warnings.push(`cannot read engines.node "${engines}"; Node was not checked`);
  if (site.needs && !existsSync(join(repoDir(site), site.needs.file))) {
    warnings.push(`no ${site.needs.file}: ${site.needs.why}`);
  }
  return warnings;
};

const line = (site: Site, verdict: string, note = ""): void => {
  console.log(`  ${labelOf(site).padEnd(22)}${verdict.padEnd(9)}${note}`);
};

/** Carries out a preflight's verdict and reports it; false when the site was skipped or failed to start. */
const act = (site: Site, verdict: Verdict): boolean => {
  switch (verdict.kind) {
    case "running":
      line(site, "running");
      return true;
    case "outside":
      line(site, "outside", `running outside the launcher: ${describe(verdict.holder)}; left alone`);
      return true;
    case "skip":
      line(site, "skipped", verdict.reason);
      return false;
    case "start": {
      const started = dekit(["start", site.name]);
      line(site, started.status === 0 ? "starting" : "failed", started.status === 0 ? "" : started.stdout);
      for (const warning of verdict.warnings) line(site, "warning", warning);
      return started.status === 0;
    }
  }
};

const up = (attach: boolean): number => {
  writeConfig();
  const states = taskStates();
  console.log(`sites: the repositories in ${root}`);
  const results = SITES.map((site) => act(site, preflight(site, states.get(site.name))));
  const failed = results.includes(false);
  if (!attach || !process.stdout.isTTY) {
    console.log("Open the TUI with: sites. Stop everything with: sites stop.");
    return failed ? 1 : 0;
  }
  if (!runnerRunning()) {
    console.log("Nothing is running, so there is no TUI to open.");
    return 1;
  }
  return dekit(["attach"], true).status;
};

const stop = (): number => {
  if (runnerRunning()) {
    const down = dekit(["down"]);
    if (down.status !== 0) {
      console.error(`sites: dekit down failed: ${down.stdout}`);
      return 1;
    }
    console.log("sites: stopped every site and the runner. sites starts them again.");
  } else {
    console.log("sites: the launcher is not running.");
  }
  for (const site of SITES) {
    const holder = holderOf(site.port);
    if (holder) line(site, "still up", `outside the launcher, so not stopped: ${describe(holder)}`);
  }
  return 0;
};

const restart = (name: string | undefined): number => {
  const site = SITES.find((candidate) => candidate.name === name);
  if (!site) {
    console.error(`sites restart: name a site: ${SITES.map((candidate) => candidate.name).join(", ")}`);
    return 2;
  }
  writeConfig();
  const state = taskStates().get(site.name);
  if (isActive(state)) {
    const restarted = dekit(["restart", site.name]);
    line(site, restarted.status === 0 ? "restarted" : "failed", restarted.status === 0 ? "" : restarted.stdout);
    return restarted.status === 0 ? 0 : 1;
  }
  // Stopped: start it as sites does, unless the port is someone else's, or the site's own run outside the launcher.
  const verdict = preflight(site, state);
  return act(site, verdict) && verdict.kind === "start" ? 0 : 1;
};

const listening = (port: number): Promise<boolean> =>
  new Promise((resolve) => {
    const socket = connect({ port, host: "localhost", autoSelectFamily: true, timeout: 1000 });
    const done = (open: boolean) => {
      socket.destroy();
      resolve(open);
    };
    socket.once("connect", () => done(true));
    socket.once("error", () => done(false));
    socket.once("timeout", () => done(false));
  });

/** HTTP status when the site answers within three seconds, "listening" when it accepts but is still compiling. */
const answer = async (port: number): Promise<string> => {
  try {
    const response = await fetch(`http://localhost:${port}/`, {
      redirect: "manual",
      signal: AbortSignal.timeout(3000),
    });
    return `HTTP ${response.status}`;
  } catch {
    return (await listening(port)) ? "listening" : "no";
  }
};

const status = async (): Promise<number> => {
  const states = taskStates();
  const running = states.size > 0;
  const answers = await Promise.all(SITES.map((site) => answer(site.port)));
  console.log(
    `${"site".padEnd(18)}${"port".padEnd(6)}${"task".padEnd(12)}${"answers".padEnd(11)}${"pid".padEnd(8)}directory`,
  );
  for (const [index, site] of SITES.entries()) {
    const holder = holderOf(site.port);
    const task = running ? (states.get(site.name) ?? "-") : "-";
    console.log(
      `${site.name.padEnd(18)}${String(site.port).padEnd(6)}${task.padEnd(12)}${(answers[index] ?? "no").padEnd(11)}` +
        `${String(holder?.pid ?? "-").padEnd(8)}${holder ? shown(holder.cwd) : "-"}`,
    );
  }
  if (!running) console.log("The launcher is not running: a pid above is a site started some other way.");
  return 0;
};

const main = async (args: string[]): Promise<number> => {
  const [command, ...rest] = args;
  if (command === "--help" || command === "-h" || command === "help") {
    console.log(HELP);
    return 0;
  }
  if (command === undefined || command === "up" || command === "--no-attach") {
    const flags = command === "--no-attach" ? ["--no-attach", ...rest] : rest;
    const unknown = flags.filter((flag) => flag !== "--no-attach");
    if (unknown.length) return usage(`unknown option ${unknown[0]}`);
    return up(!flags.includes("--no-attach"));
  }
  if (rest.length > (command === "restart" ? 1 : 0)) return usage(`unexpected ${rest.join(" ")}`);
  if (command === "stop" || command === "down") return stop();
  if (command === "status") return status();
  if (command === "restart") return restart(rest[0]);
  return usage(`unknown command ${command}`);
};

const usage = (problem: string): number => {
  console.error(`sites: ${problem}. sites --help lists the commands.`);
  return 2;
};

try {
  process.exitCode = await main(process.argv.slice(2));
} catch (error) {
  if (!(error instanceof Failure)) throw error;
  console.error(error.message);
  process.exitCode = 1;
}
