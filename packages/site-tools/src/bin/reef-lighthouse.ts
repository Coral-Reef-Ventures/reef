#!/usr/bin/env node
import { parseArgs } from "node:util";

import { runLighthouse } from "../lighthouse.ts";

/**
 * reef-lighthouse [--root out] [--reports lighthouse] [--port N] [--threshold 90] [--chrome <path>] [path ...]
 *
 * Lighthouse on every page in the export's sitemap, or the paths given, each category at the threshold or above. The
 * export is served on a free port unless --port pins one (Streamlane's run met EADDRINUSE on a fixed 3160).
 * Exits 1 with the failing pages named when one is under, and leaves their reports in --reports.
 */
const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    root: { type: "string", default: "out" },
    reports: { type: "string", default: "lighthouse" },
    port: { type: "string" },
    threshold: { type: "string", default: "90" },
    chrome: { type: "string" },
    "lighthouse-version": { type: "string", default: "13.5.0" },
    help: { type: "boolean", short: "h" },
  },
});

if (values.help) {
  console.log(
    "reef-lighthouse [--root out] [--reports lighthouse] [--port N] [--threshold 90] [--chrome <path>] [path ...]",
  );
  process.exit(0);
}

const threshold = Number(values.threshold) / 100;
const results = await runLighthouse({
  root: values.root,
  reportDir: values.reports,
  ...(values.port !== undefined && { port: Number(values.port) }),
  threshold,
  paths: positionals,
  lighthouseVersion: values["lighthouse-version"],
  ...(values.chrome !== undefined && { chrome: values.chrome }),
});

const failures = results.filter((result) => result.low.length > 0);
if (failures.length) {
  console.error(
    `Under ${threshold * 100}:\n${failures.map((result) => `${result.path}: ${result.low.join(", ")}`).join("\n")}\nReports in ${values.reports}/`,
  );
  process.exit(1);
}
