import { type ChildProcess, execFile, execFileSync, spawn } from "node:child_process";
import { createPrivateKey } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { request as httpRequest } from "node:http";
import { createServer as createHttpsServer, type Server } from "node:https";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { canonicalNext } from "../src/door/next.ts";
import { makeKey, signTicket, type TestKey, ticketClaims } from "../test/door-fixtures.ts";

/**
 * Two locked sites and a door, all on loopback, all over TLS:
 *
 *   alpha  https://localhost:<a>    the real bundle's server.mjs, behind a TLS proxy
 *   beta   https://127.0.0.1:<b>    the same, for the second stop of the sign-out walk
 *   door   https://127.0.0.1:<d>    a stand-in for coralreefventures.com that signs tickets with a test key
 *
 * localhost and 127.0.0.1 are different sites to a browser, so the door's POST to alpha is cross-site, which is the
 * case that matters; cookies ignore ports, so the two gates need two host names rather than two ports. The sign-out
 * walk is the one the door starts (coral-reef-site, sites.ts): /signout/done/ goes to the first site's
 * /_door/signout?then=<second id>, and the second returns to the door's /signout/.
 */
const packageRoot = path.resolve(import.meta.dirname, "..");
const repoRoot = path.resolve(packageRoot, "..", "..");
const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

const escapeHtml = (value: string) =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const page = (title: string, body: string) =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title></head><body>${body}</body></html>`;

const autoPost = (host: string, ticket: string, next: string) =>
  page(
    "Door: continuing",
    `<form method="post" action="https://${escapeHtml(host)}/_door">` +
      `<input type="hidden" name="ticket" value="${escapeHtml(ticket)}">` +
      `<input type="hidden" name="next" value="${escapeHtml(next)}"></form>` +
      "<script>document.forms[0].submit()</script>",
  );

/** A static export as Next writes one: pages, an RSC payload, a chunk the home page runs, an image, a 404 page. */
const writeExport = async (out: string) => {
  const marker = "<!-- SITE-BYTES -->";
  const files: Record<string, string | Buffer> = {
    "index.html": page(
      "Alpha",
      `${marker}<h1 id="title">Locked home</h1><img id="og" src="/og/home.png" alt="">` +
        '<script src="/_next/static/chunks/app.js"></script>',
    ),
    "index.txt": `${marker} rsc payload`,
    "docs/index.html": page("Docs", `${marker}<h1 id="title">Locked docs</h1>`),
    "docs/index.txt": `${marker} docs rsc payload`,
    "404.html": page("Not found", `${marker}<h1 id="title">Page not found.</h1>`),
    "_next/static/chunks/app.js": `/* SITE-BYTES */ document.body.dataset.app = "loaded";`,
    "_next/static/css/app.css": "/* SITE-BYTES */ body { margin: 0 }",
    "og/home.png": Buffer.from(png, "base64"),
    "sitemap.xml": `<?xml version="1.0"?><!-- SITE-BYTES --><urlset><url><loc>https://example/</loc></url></urlset>`,
    "manifest.webmanifest": `{"name":"SITE-BYTES"}`,
  };
  for (const [file, body] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(out, file)), { recursive: true });
    await writeFile(path.join(out, file), body);
  }
  return Object.keys(files);
};

const listen = (server: Server, host: string) =>
  new Promise<number>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, host, () => resolve((server.address() as AddressInfo).port));
  });

/** TLS in front of a gate, as Amplify's CDN terminates it: the request goes on as it came, Host and all. */
const tlsProxy = (tls: { key: Buffer; cert: Buffer }, target: () => number) =>
  createHttpsServer(tls, (incoming, outgoing) => {
    const upstream = httpRequest(
      { host: "127.0.0.1", port: target(), method: incoming.method, path: incoming.url, headers: incoming.headers },
      (answer) => {
        outgoing.writeHead(answer.statusCode ?? 502, answer.headers);
        answer.pipe(outgoing);
      },
    );
    upstream.on("error", () => outgoing.writeHead(502).end());
    incoming.pipe(upstream);
  });

const waitForHealth = async (port: number, host: string) => {
  for (let attempt = 0; attempt < 100; attempt++) {
    const ok = await new Promise<boolean>((resolve) => {
      const probe = httpRequest({ host: "127.0.0.1", port, path: "/_door/health", headers: { host } }, (answer) => {
        answer.resume();
        resolve(answer.statusCode === 200);
      });
      probe.on("error", () => resolve(false));
      probe.end();
    });
    if (ok) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`the gate on ${port} never answered its health check`);
};

/**
 * The stand-in door. `/` with a site's query signs a ticket for that host and posts it back, as the real door does once
 * a Cognito session exists (unless the visitor carries door_hold=1, a test's way of being someone with no session);
 * `/post` posts whatever ticket a test signed; `/signout/done/` starts the sign-out walk and `/signout/` ends it.
 */
const doorServer = (
  tls: { key: Buffer; cert: Buffer },
  key: TestKey,
  registry: Record<string, string>,
  signoutStart: string,
) => {
  let origin = "";
  const doorPage = (extra = "") => page("Door", `<h1 id="door">Door</h1>${extra}`);

  /** What the real door does once a Cognito session exists: a ticket for this host's grant, posted in a form. */
  const issue = (query: URLSearchParams): [number, string] => {
    const host = query.get("host") ?? "";
    const state = query.get("state") ?? "";
    const next = canonicalNext(query.get("next"), host);
    if (registry[host] !== query.get("site") || next === null || !/^[A-Za-z0-9_-]{22,64}$/.test(state)) {
      return [400, doorPage('<p id="error">bad request</p>')];
    }
    return [200, autoPost(host, signTicket(key, ticketClaims({ issuer: origin, host, state, next })), next)];
  };

  /** For the refusal cases: post whatever ticket the test signed, as the door's own form would. */
  const post = (query: URLSearchParams): [number, string] => {
    const host = query.get("host") ?? "";
    if (!registry[host]) return [400, doorPage("unknown host")];
    return [200, autoPost(host, query.get("ticket") ?? "", query.get("next") ?? "/")];
  };

  const home = (query: URLSearchParams, cookie: string): [number, string] => {
    if (query.has("error")) return [200, doorPage(`<p id="error">${escapeHtml(query.get("error") ?? "")}</p>`)];
    // A visitor with no session at the door gets the page and no ticket; a test sets door_hold to be that visitor.
    if (/(^|; )door_hold=1(;|$)/.test(cookie) || !query.has("site")) return [200, doorPage()];
    return issue(query);
  };

  const routes: Record<string, (query: URLSearchParams, cookie: string) => [number, string]> = {
    "/": home,
    "/post": post,
    "/signout/": () => [200, page("Signed out", '<h1 id="door">Signed out</h1>')],
    "/signout/done/": () => [
      200,
      page("Signing out", `<script>location.replace(${JSON.stringify(signoutStart)})</script>`),
    ],
  };

  const server = createHttpsServer(tls, (incoming, outgoing) => {
    const url = new URL(incoming.url ?? "/", origin);
    if (url.pathname === "/.well-known/crv-door-jwks.json") {
      outgoing.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ keys: [key.jwk] }));
      return;
    }
    const route = routes[url.pathname] ?? (() => [200, doorPage()] as [number, string]);
    const [status, body] = route(url.searchParams, incoming.headers.cookie ?? "");
    outgoing.writeHead(status, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" }).end(body);
  });
  return {
    server,
    listen: async () => {
      origin = `https://127.0.0.1:${await listen(server, "127.0.0.1")}`;
      return origin;
    },
  };
};

const freePort = async () => {
  const probe = createHttpsServer();
  const port = await listen(probe, "127.0.0.1");
  await new Promise((resolve) => probe.close(resolve));
  return port;
};

export default async function globalSetup() {
  const work = await mkdtemp(path.join(tmpdir(), "reef-door-e2e-"));
  const children: ChildProcess[] = [];
  const servers: Server[] = [];
  const teardown = async () => {
    for (const child of children) child.kill();
    await Promise.all(servers.map((server) => new Promise((resolve) => server.close(resolve))));
    await rm(work, { recursive: true, force: true });
  };
  try {
    // The bin and the gate are the compiled ones a consumer installs.
    execFileSync("pnpm", ["--filter", "@coralreefventures/site-tools", "run", "build"], {
      cwd: repoRoot,
      stdio: "ignore",
    });

    execFileSync(
      "openssl",
      [
        "req",
        "-x509",
        "-newkey",
        "ec",
        "-pkeyopt",
        "ec_paramgen_curve:P-256",
        "-nodes",
        "-days",
        "1",
        "-subj",
        "/CN=localhost",
        "-addext",
        "subjectAltName=DNS:localhost,IP:127.0.0.1",
        "-keyout",
        path.join(work, "tls-key.pem"),
        "-out",
        path.join(work, "tls-cert.pem"),
      ],
      { stdio: "ignore" },
    );
    const tls = {
      key: await readFile(path.join(work, "tls-key.pem")),
      cert: await readFile(path.join(work, "tls-cert.pem")),
    };

    const key = makeKey("e2e-key");
    await writeFile(path.join(work, "door-key.pem"), key.privateKey.export({ format: "pem", type: "pkcs8" }));
    const out = path.join(work, "out");
    const files = await writeExport(out);

    // Ports first: each gate's host list names its own, and the door's registry names both.
    const gatePorts = { alpha: 0, beta: 0 };
    const proxyA = tlsProxy(tls, () => gatePorts.alpha);
    const proxyB = tlsProxy(tls, () => gatePorts.beta);
    servers.push(proxyA, proxyB);
    const portA = await listen(proxyA, "127.0.0.1");
    // A browser may try localhost on ::1 first, so alpha answers there too, where loopback has IPv6.
    const proxyA6 = tlsProxy(tls, () => gatePorts.alpha);
    await new Promise<void>((resolve) => {
      proxyA6.once("error", () => resolve());
      proxyA6.listen(portA, "::1", () => {
        servers.push(proxyA6);
        resolve();
      });
    });
    const hostA = `localhost:${portA}`;
    const hostB = `127.0.0.1:${await listen(proxyB, "127.0.0.1")}`;
    const registry: Record<string, string> = { [hostA]: "alpha", [hostB]: "beta" };

    // The door's sign-out page starts the walk at the first site, naming the second (coral-reef-site, sites.ts).
    const door = doorServer(tls, key, registry, `https://${hostA}/_door/signout?then=beta`);
    servers.push(door.server);
    const doorOrigin = await door.listen();

    const signout = `alpha=${hostA},beta=${hostB}`;
    for (const [site, host] of [
      ["alpha", hostA],
      ["beta", hostB],
    ] as const) {
      const dest = path.join(work, site, ".amplify-hosting");
      // The real bin, fetching the JWKS over https from the door, which it trusts through the run's certificate. Not
      // execFileSync: the door answering that fetch is in this process.
      await promisify(execFile)(
        process.execPath,
        [
          path.join(packageRoot, "dist", "bin", "reef-door-bundle.js"),
          "--site",
          site,
          "--out",
          out,
          "--dest",
          dest,
          "--door-url",
          doorOrigin,
          "--hosts",
          host,
          "--jwks-url",
          `${doorOrigin}/.well-known/crv-door-jwks.json`,
          "--signout-chain",
          signout,
        ],
        { env: { ...process.env, NODE_EXTRA_CA_CERTS: path.join(work, "tls-cert.pem") } },
      );
      const port = await freePort();
      const child = spawn(process.execPath, [path.join(dest, "compute", "default", "server.mjs")], {
        cwd: path.join(dest, "compute", "default"),
        env: { PATH: process.env.PATH ?? "", PORT: String(port), NODE_ENV: "production" },
        stdio: "ignore",
      });
      children.push(child);
      gatePorts[site] = port;
      await waitForHealth(port, host);
    }

    process.env.DOOR_E2E = JSON.stringify({
      door: doorOrigin,
      alpha: `https://${hostA}`,
      beta: `https://${hostB}`,
      kid: key.kid,
      keyFile: path.join(work, "door-key.pem"),
      files,
    });
    // Checked here so a bad key file fails setup rather than every test.
    createPrivateKey(await readFile(path.join(work, "door-key.pem")));
  } catch (error) {
    await teardown();
    throw error;
  }
  return teardown;
}
