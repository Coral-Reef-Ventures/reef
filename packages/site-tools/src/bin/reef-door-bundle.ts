#!/usr/bin/env node
import { parseArgs } from "node:util";

import { parseSignoutChain } from "../door/config.ts";
import { bundleDoor } from "../door/package.ts";

const usage = `reef-door-bundle --site <id> [--out out] [--dest .amplify-hosting] --door-url <url> --hosts <h1,h2>
                 --jwks-url <url> [--signout-chain id=host,id=host] [--host-header host|x-forwarded-host]
                 [--name <display name>] [--mark <file in out>] [--mark-dark <file in out>]
                 [--accent #rrggbb] [--accent-dark #rrggbb]

Locks a static export behind the door: writes .amplify-hosting with the export inside the gate's compute bundle and
one route, /* to Compute. --door-url, --hosts, --jwks-url, --signout-chain and --host-header fall back to
CRV_DOOR_URL, CRV_DOOR_HOSTS, CRV_DOOR_JWKS_URL, CRV_DOOR_SIGNOUT_CHAIN and CRV_DOOR_HOST_HEADER.

A page load without a session gets a coming-soon page: --name (the site id, capitalized, by default), --mark and
--mark-dark (an .svg or .png inside the export, inlined; none by default), --accent and --accent-dark (the button's
color in each scheme, at least 3:1 on the page; neutral by default).`;

const { values } = parseArgs({
  options: {
    site: { type: "string" },
    out: { type: "string", default: "out" },
    dest: { type: "string", default: ".amplify-hosting" },
    "door-url": { type: "string" },
    hosts: { type: "string" },
    "jwks-url": { type: "string" },
    "signout-chain": { type: "string" },
    "host-header": { type: "string" },
    name: { type: "string" },
    mark: { type: "string" },
    "mark-dark": { type: "string" },
    accent: { type: "string" },
    "accent-dark": { type: "string" },
    help: { type: "boolean", short: "h" },
  },
});

if (values.help) {
  console.log(usage);
  process.exit(0);
}

const env = process.env;
const doorUrl = values["door-url"] ?? env.CRV_DOOR_URL;
const hosts = values.hosts ?? env.CRV_DOOR_HOSTS;
const jwksUrl = values["jwks-url"] ?? env.CRV_DOOR_JWKS_URL;
const hostHeader = values["host-header"] ?? env.CRV_DOOR_HOST_HEADER ?? "host";

try {
  if (!values.site || !doorUrl || !hosts || !jwksUrl) {
    throw new Error("--site, --door-url, --hosts and --jwks-url are required (or their CRV_DOOR_* variables)");
  }
  if (hostHeader !== "host" && hostHeader !== "x-forwarded-host") {
    throw new Error(`--host-header must be host or x-forwarded-host: ${hostHeader}`);
  }
  const manifest = await bundleDoor({
    site: values.site,
    out: values.out,
    dest: values.dest,
    doorUrl,
    hosts: hosts.split(","),
    jwksUrl,
    signout: parseSignoutChain(values["signout-chain"] ?? env.CRV_DOOR_SIGNOUT_CHAIN),
    hostHeader,
    page: {
      name: values.name,
      mark: values.mark,
      markDark: values["mark-dark"],
      accent: values.accent,
      accentDark: values["accent-dark"],
    },
  });
  console.log(`reef-door-bundle: ${values.dest} written for ${values.site}, gate ${manifest.framework.version}`);
} catch (error) {
  console.error(`reef-door-bundle: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
