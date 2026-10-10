import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { get as httpGet, type IncomingMessage } from "node:http";
import { get as httpsGet } from "node:https";
import { connect } from "node:net";
import { dirname, join, relative, sep } from "node:path";
import { stripVTControlCharacters } from "node:util";

import {
  certificateMissing,
  commandFor,
  declaredPort,
  dekitConfig,
  isActive,
  labelOf,
  leftRunning,
  type Manifest,
  nodeSatisfies,
  ROOT_VARIABLE,
  rootOf,
  runnerDirOf,
  SITES,
  type Site,
  urlOf,
} from "./config.ts";

/**
 * `sites`: every Coral Reef site under one dekit runner, with one terminal UI for all of them. This file is the command;
 * config.ts is the map. README.md says why dekit, and which mode of it.
 */

const toolDir = import.meta.dirname;
const root = rootOf(toolDir, process.env);
/** The runner's project directory, one per machine: dekit.yaml is written here on each run. */
const runnerDir = runnerDirOf(process.env);

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

q leaves the sites running in the background; Q or sites stop is what stops them.

The repositories are found beside reef's checkout (${root}); set ${ROOT_VARIABLE} to look elsewhere.
The runner, and the dekit.yaml it reads, are in ${runnerDir}, one per machine.
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

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** Each task's state by name, from the runner; empty when the runner is not running. */
const taskStates = (): Map<string, string> => {
  if (!runnerRunning()) return new Map();
  const ls = dekit(["ls", "--json"]);
  if (ls.status !== 0) {
    // The runner can exit between the two calls, as it does once Q has stopped the last site.
    if (!runnerRunning()) return new Map();
    throw new Failure(`sites: dekit ls failed: ${ls.stdout}`);
  }
  const listed = JSON.parse(ls.stdout || "{}") as { tasks?: { path: string; state: string }[] };
  return new Map((listed.tasks ?? []).map((task) => [task.path, task.state]));
};

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
  const commands = new Map<string, string[] | { error: string }>();
  for (const site of SITES) {
    const dir = repoDir(site);
    const command = existsSync(dir) ? commandOf(site) : { error: `no repository at ${dir}` };
    commands.set(site.name, "argv" in command ? command.argv : command);
  }
  const text = dekitConfig(root, commands, dirname(process.execPath));
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

/** Whether a site can start: its repository, the port, then its install, command, Node and declared port. */
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
  return startable(site);
};

/**
 * Whether the site's repository can run it now, apart from the port: its repository, install, command, Node and
 * declared port. A restart of a running site asks this too, before stopping it, so it cannot swap a working site for
 * one that fails.
 */
const startable = (site: Site): Extract<Verdict, { kind: "start" | "skip" }> => {
  const dir = repoDir(site);
  if (!existsSync(dir))
    return { kind: "skip", reason: `no repository at ${dir} (set ${ROOT_VARIABLE} to look elsewhere)` };
  if (!existsSync(join(dir, "node_modules"))) {
    return { kind: "skip", reason: `not installed; run: cd ${dir} && pnpm install` };
  }
  const command = commandOf(site);
  if ("error" in command) return { kind: "skip", reason: command.error };
  if (site.certificate && !existsSync(join(dir, site.certificate))) {
    return { kind: "skip", reason: certificateMissing(site, dir) };
  }
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

/** What became of carrying out a verdict: a site skipped is not a failure, one that did not start is. */
type Outcome = "started" | "left" | "skipped" | "failed";

/** Carries out a preflight's verdict and reports it. */
const act = (site: Site, verdict: Verdict): Outcome => {
  switch (verdict.kind) {
    case "running":
      line(site, "running");
      return "left";
    case "outside":
      line(site, "outside", `running outside the launcher: ${describe(verdict.holder)}; left alone`);
      return "left";
    case "skip":
      line(site, "skipped", verdict.reason);
      return "skipped";
    case "start": {
      const started = dekit(["start", site.name]);
      line(site, started.status === 0 ? "starting" : "failed", started.status === 0 ? "" : started.stdout);
      for (const warning of verdict.warnings) line(site, "warning", warning);
      return started.status === 0 ? "started" : "failed";
    }
  }
};

/** How long a site that was just started has to die for the launcher to say so: a bad pin or script dies within it. */
const SETTLE_MS = 2000;

/**
 * Waits SETTLE_MS, then reports each of these sites that has already exited, with the last lines of its output.
 * Returns how many had.
 */
const settle = async (started: readonly Site[]): Promise<number> => {
  if (started.length === 0) return 0;
  await sleep(SETTLE_MS);
  const states = taskStates();
  let died = 0;
  for (const site of started) {
    const state = states.get(site.name);
    if (isActive(state)) continue;
    died++;
    line(site, "exited", `it stopped within ${SETTLE_MS / 1000} seconds (${state ?? "gone"}); its last output:`);
    const screen = stripVTControlCharacters(dekit(["screen", site.name]).stdout).replaceAll("\r", "");
    const last = screen
      .split("\n")
      .map((text) => text.trimEnd())
      .filter((text) => text)
      .slice(-6);
    for (const text of last) console.log(`      ${text}`);
  }
  return died;
};

/**
 * How long the launcher waits, once the TUI has closed, for tasks that are stopping: after Q, attach returns before the
 * sites have stopped, and they stop within half a second.
 */
const LEAVE_MS = 2000;

/**
 * How many sites the TUI left running: read at once after q, and after Q (or a stop or restart just before q) once
 * nothing is stopping, or LEAVE_MS.
 */
const leftBehind = async (): Promise<number> => {
  const deadline = Date.now() + LEAVE_MS;
  for (;;) {
    const count = leftRunning(taskStates().values(), Date.now() >= deadline);
    if (count !== undefined) return count;
    await sleep(100);
  }
};

/** Set by Ctrl-C while sites are being started: the loop stops at the next site and says how far it got. */
let interrupted = false;

const up = async (attach: boolean): Promise<number> => {
  writeConfig();
  const states = taskStates();
  console.log(`sites: the repositories in ${root}`);
  const onInterrupt = (): void => {
    interrupted = true;
  };
  process.once("SIGINT", onInterrupt);
  const outcomes: Outcome[] = [];
  const started: Site[] = [];
  for (const site of SITES) {
    // A turn of the event loop, so a Ctrl-C during the last site's synchronous start is seen before the next.
    await new Promise(setImmediate);
    if (interrupted) break;
    const outcome = act(site, preflight(site, states.get(site.name)));
    outcomes.push(outcome);
    if (outcome === "started") started.push(site);
  }
  await new Promise(setImmediate);
  process.off("SIGINT", onInterrupt);
  if (interrupted) {
    console.log(
      `sites: interrupted after checking ${outcomes.length} of ${SITES.length} sites; ` +
        `${started.length} started and still running. sites finishes the job; sites stop stops them.`,
    );
    return 130;
  }
  const died = await settle(started);
  const failed = died > 0 || outcomes.includes("failed");
  if (!attach || !process.stdout.isTTY) {
    console.log("Open the TUI with: sites. Stop everything with: sites stop.");
    return failed ? 1 : 0;
  }
  if (!runnerRunning()) {
    console.log("Nothing is running, so there is no TUI to open.");
    return 1;
  }
  const status = dekit(["attach"], true).status;
  // q detaches rather than stopping anything, which mprocs' q does not; say so every time.
  const active = await leftBehind();
  if (active > 0) {
    console.log(
      `sites: ${active} ${active === 1 ? "site is" : "sites are"} still running in the background. ` +
        "sites stop stops them; sites opens the TUI again.",
    );
  }
  return status;
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

/** Restarts a running site, checking first, so a restart that could not start it again leaves the running one alone. */
const restartRunning = async (site: Site): Promise<number> => {
  const verdict = startable(site);
  if (verdict.kind === "skip") {
    line(site, "refused", `${verdict.reason}; the running site was left alone`);
    return 1;
  }
  const restarted = dekit(["restart", site.name]);
  line(site, restarted.status === 0 ? "restarted" : "failed", restarted.status === 0 ? "" : restarted.stdout);
  if (restarted.status !== 0) return 1;
  for (const warning of verdict.warnings) line(site, "warning", warning);
  return (await settle([site])) > 0 ? 1 : 0;
};

const restart = async (name: string | undefined): Promise<number> => {
  const site = SITES.find((candidate) => candidate.name === name);
  if (!site) {
    console.error(`sites restart: name a site: ${SITES.map((candidate) => candidate.name).join(", ")}`);
    return 2;
  }
  writeConfig();
  const state = taskStates().get(site.name);
  if (isActive(state)) return restartRunning(site);
  // Stopped: start it as sites does, unless the port is someone else's, or the site's own run outside the launcher.
  const outcome = act(site, preflight(site, state));
  if (outcome !== "started") return 1;
  return (await settle([site])) > 0 ? 1 : 0;
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

/**
 * HTTP status when the site answers within three seconds, "listening" when it accepts but is still compiling. A site
 * whose task is still starting gets a TCP check only, since a GET would set a Next dev server compiling its home page.
 */
const answer = async (site: Site, state: string | undefined): Promise<string> => {
  if (isActive(state) && state !== "ready") return (await listening(site.port)) ? "listening" : "no";
  const status = await statusOf(urlOf(site));
  if (status !== undefined) return `HTTP ${status}`;
  return (await listening(site.port)) ? "listening" : "no";
};

/**
 * The status a GET of `url` answers within three seconds, redirects unfollowed. An https site's certificate is one
 * `next dev` made and only the system's keychain trusts, so it is not checked: this asks whether the site answers, on
 * this machine's own loopback, not whether it can be trusted.
 */
const statusOf = (url: string): Promise<number | undefined> =>
  new Promise((resolve) => {
    const answered = (response: IncomingMessage) => {
      response.resume();
      resolve(response.statusCode);
    };
    const request = url.startsWith("https:")
      ? httpsGet(url, { rejectUnauthorized: false, timeout: 3000 }, answered)
      : httpGet(url, { timeout: 3000 }, answered);
    request.once("timeout", () => request.destroy());
    request.once("error", () => resolve(undefined));
  });

const status = async (): Promise<number> => {
  const states = taskStates();
  const running = states.size > 0;
  // Who holds each port first, then whether it answers, so a row is not two moments a build apart.
  const holders = SITES.map((site) => holderOf(site.port));
  const answers = await Promise.all(SITES.map((site) => answer(site, states.get(site.name))));
  console.log(
    `${"site".padEnd(18)}${"port".padEnd(6)}${"task".padEnd(12)}${"answers".padEnd(11)}${"pid".padEnd(8)}directory`,
  );
  for (const [index, site] of SITES.entries()) {
    const holder = holders[index];
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
