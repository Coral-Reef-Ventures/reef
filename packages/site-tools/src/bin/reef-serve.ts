#!/usr/bin/env node
import { parseArgs } from "node:util";

import { serve } from "../serve.ts";

/**
 * reef-serve [--root out] [--port 3140]
 *
 * Serves a static export the way Amplify Hosting does, for screen tests and Lighthouse runs. PORT is read when
 * --port is not given, so a Playwright webServer command can pass either.
 */
const { values } = parseArgs({
  options: {
    root: { type: "string", default: "out" },
    port: { type: "string", default: process.env.PORT ?? "3140" },
    help: { type: "boolean", short: "h" },
  },
});

if (values.help) {
  console.log("reef-serve [--root out] [--port 3140]");
  process.exit(0);
}

const { url } = await serve({ root: values.root, port: Number(values.port) });
console.log(`Serving ${values.root} at ${url}`);
