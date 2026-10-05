# sites

One command that starts every Coral Reef site on this machine and shows them all in one terminal UI, where each one's
output is on screen and each can be stopped, killed and restarted on its own. Family tooling: not a package, nothing
is published, and it adds no dependency to reef.

```sh
sites                    # start each site that is not running, then open the TUI
sites stop               # stop every site and the runner (also: sites down)
sites status             # each site, its port, whether it answers, and the pid and directory holding the port
sites restart crv        # restart one site, or start it if it is stopped
sites --help
```

Inside reef, `pnpm sites` runs the same command (`pnpm sites status`, and so on).

## The port map

Tools first, then the five public sites in family order, parent first (Gary's map, 2026-10-05). A test holds this
table to `config.ts`, row for row; change both together.

| Port | Site | What | Repository | Runs |
| --- | --- | --- | --- | --- |
| 3000 | `atlas` | Intentset Atlas over Streamlane's model | `streamlane` | `pnpm dlx @intentset/cli@<pinned> serve --port 3000` |
| 3001 | `streamlane` | Streamlane, the product (apps/web) | `streamlane` | `pnpm run dev` |
| 3002 | `crv` | coralreefventures.com, the CRV app (apps/web) | `coral-reef-site` | `pnpm run web:dev` |
| 3003 | `markset` | markset.org | `markset` | `pnpm run site:watch --port 3003` |
| 3004 | `intentset` | intentset.org | `intentset` | `pnpm run site:watch --port 3004` |
| 3005 | `streamlane-site` | streamlane.app (apps/site) | `streamlane` | `pnpm run site:watch` |
| 3006 | `driftline-site` | driftline.app (apps/site) | `driftline` | `pnpm run site:watch` |

Each repository's own default moves to the same port (2026-10-05), so a site run on its own lands where the launcher
puts it. The retired
one-page coralreefventures.com (coral-reef-site's `site/`) is off the map, on 3009. The e2e ports (3130, 3150, 3151 and
free ports) are untouched.

Atlas runs the `@intentset/cli` Streamlane pins: its own dependency when it has one (`pnpm exec intentset`), otherwise
the version its scripts name for `pnpm dlx` (`help:publish`, 0.6.1 today), read from Streamlane's package.json on each
run so the two cannot drift. The two static sites take the port as a flag; the four Next apps name theirs in their own
`dev` scripts, and a site whose script names another port is skipped rather than started onto a neighbour's.

## Keys in the TUI

The left pane lists the sites in port order with their state; the right pane is the selected site's output.

| Key | Does |
| --- | --- |
| `j` `k`, or the arrows | pick a site |
| `s` | start it |
| `x` | stop it: SIGTERM to its whole process group, then SIGKILL after 10 seconds |
| `X` | kill it now: SIGKILL to its whole process group |
| `r` / `R` | restart it / force-restart it |
| `C-a` | move between the list and the output, to scroll it or type into the site |
| `C-u` `C-d`, `PageUp` `PageDown` | scroll the output |
| `z` | zoom the output to the whole terminal |
| `v` | copy mode |
| `q` | leave the TUI; the sites keep running, and `sites` comes back to them |
| `Q` | stop every site and the runner, as `sites stop` does |
| `?` | every key |

Key bindings are dekit's defaults, set in `~/.config/dekit/config.yaml` if you want others (`dekit help config/user`).

## Before it starts anything

`sites` and `sites restart` check each site first and skip the ones that would fail, rather than failing them all:

- **The repository** is beside reef's checkout (reef's parent directory, found from the script's own location, and
  from a worktree under `.claude/worktrees/` too). `SITES_ROOT=/some/dir sites` looks elsewhere.
- **It is installed**: no `node_modules` prints the `cd <repo> && pnpm install` to run, and that site is skipped.
- **Node is new enough** for the repository's `engines.node`.
- **The port is free, or the site already holds it.** A port held by the launcher's own task is left running. A port
  held by the same site started by hand (a process working in that repository, not in one of its agents' worktrees)
  is reported and left alone. A port held by anything else is reported with its pid, command and directory, and that
  site is skipped. **Nothing is ever killed that the launcher did not start.**
- **Streamlane needs `amplify_outputs.json`** at its root: without it the product starts but has no backend to sign in
  against, so it is a warning, not a skip.

## Why dekit, and its own mode rather than `dekit mprocs`

Gary chose mprocs (2026-10-05). Homebrew's `mprocs` formula installs it as **dekit** since 0.10 (`brew install mprocs`
puts `dekit` on PATH), with two ways to run it: `dekit mprocs`, the classic mprocs.yaml TUI in the foreground, and
dekit's own mode, a dekit.yaml served by a background runner that `dekit attach` opens a TUI onto. Both were tried
against the real sites on 2026-10-05: Streamlane's `next dev`, Driftline's `tsx … && next dev`, and Atlas through
`pnpm dlx`, each of which is a tree of three to five processes.

**dekit's own mode** is the one this uses, for four reasons:

1. **Stopping is by process group.** dekit sends the stop signal to each task's whole group, so `x`, `X`, `r` and
   `sites stop` take down pnpm, the shell, Next and its workers together. The mprocs mode signals the main process
   only. In the trial its stops still freed every port, because the pty hangs up on the children when pnpm exits, but
   that leans on every child honouring SIGHUP. Signalling pnpm alone, as anything outside a pty does, was seen to
   leave Atlas's server orphaned on 3000.
2. **Ready checks.** Each task waits on a TCP check of its port, so the list shows `ready` only when the site answers,
   not merely when its command started. The mprocs mode has none.
3. **Every action has a command line**, by task name: `dekit restart crv` is what `sites restart crv` runs, and
   `dekit ls --json` is what `sites status` reads. The mprocs mode's remote control (`--ctl`) acts on the selected
   process, picked by its place in the list.
4. **The sites outlive the terminal.** Closing the window, or `q`, leaves them running, and `sites` reattaches; `Q` or
   `sites stop` is the way to stop them. A foreground TUI loses every site when its terminal goes.

## How it works

`sites` is a bash shim that finds its own directory through any symlink and runs `sites.ts` with Node's type
stripping; `config.ts` is the map. Each run writes `.dekit/dekit.yaml` beside them (ignored by git: it holds this
machine's absolute paths) with one task per site, in port order, each in its repository's root with `ready: {tcp:
<port>}`, and runs dekit with `-C .dekit`, so the runner is this checkout's own. A changed file is reloaded by a
running runner without stopping its sites. The runner takes its environment, PATH and Node included, from the
terminal that first starts it.

On Gary's machine `~/.local/bin/sites` is a symlink to `tools/sites/sites` in reef's main checkout.
