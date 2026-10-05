import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer, type IncomingHttpHeaders, request, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { parseGateConfig } from "../src/door/config.ts";
import { unsafe } from "../src/door/next.ts";
import {
  challenge,
  createGate,
  isDocumentRequest,
  normalizePath,
  readCookie,
  sessionCookie,
  stateCookie,
} from "../src/door/server.ts";
import { jwksOf, makeKey, signTicket, tamper, ticketClaims } from "./door-fixtures.ts";

/**
 * The gate over a small export, driven with raw HTTP so the Host header, the cookies and the request target are
 * exactly what a test says. The clock is fixed, so expiry is a claim and not a race.
 */
const door = "https://door.example";
const host = "site.example";
const otherHost = "other.example";
const key = makeKey("k1");
const now = 1_900_000_000;
const config = parseGateConfig({
  version: 1,
  site: "alpha",
  door,
  hosts: [host, otherHost],
  hostHeader: "host",
  signout: [
    { id: "alpha", host },
    { id: "beta", host: "beta.example" },
  ],
  jwks: jwksOf(key),
});

let root: string;
let server: Server;
let port: number;

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), "reef-gate-"));
  await mkdir(path.join(root, "docs"), { recursive: true });
  await mkdir(path.join(root, "_next", "static", "chunks"), { recursive: true });
  await mkdir(path.join(root, "og"), { recursive: true });
  await writeFile(path.join(root, "index.html"), "<h1>Home</h1>");
  await writeFile(path.join(root, "index.txt"), "rsc payload");
  await writeFile(path.join(root, "docs", "index.html"), "<h1>Docs</h1>");
  await writeFile(path.join(root, "404.html"), "<h1>Page not found.</h1>");
  await writeFile(path.join(root, "_next", "static", "chunks", "app.js"), "console.log('app')");
  await writeFile(path.join(root, "og", "home.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  server = createServer(createGate({ config, site: root, now: () => now }));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  port = (server.address() as AddressInfo).port;
});

afterAll(async () => {
  server.close();
  await rm(root, { recursive: true, force: true });
});

type Reply = { status: number; headers: IncomingHttpHeaders; body: string };

const send = (method: string, target: string, headers: Record<string, string> = {}, body?: string): Promise<Reply> =>
  new Promise((resolve, reject) => {
    const req = request(
      { host: "127.0.0.1", port, method, path: target, headers: { host, "accept-encoding": "identity", ...headers } },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () =>
          resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks).toString("utf8") }),
        );
      },
    );
    req.on("error", reject);
    req.end(body);
  });

const navigate = { "sec-fetch-mode": "navigate", accept: "text/html" };
const state = "s".repeat(43);
const session = (extra: Record<string, unknown> = {}) => {
  const { st: _st, ...claims } = ticketClaims({ issuer: door, host, now });
  return signTicket(key, { ...claims, ...extra });
};
const withSession = (extra: Record<string, unknown> = {}) => ({ cookie: `${sessionCookie}=${session(extra)}` });
const ticketPost = (ticket: string, next = "/docs/", cookie = `${stateCookie}=${state}`) =>
  send(
    "POST",
    "/_door",
    { "content-type": "application/x-www-form-urlencoded", cookie },
    new URLSearchParams({ ticket, next }).toString(),
  );
const ticket = (extra: Record<string, unknown> = {}) =>
  signTicket(key, { ...ticketClaims({ issuer: door, host, state, next: "/docs/", now }), ...extra });

const setCookies = (reply: Reply) => reply.headers["set-cookie"] ?? [];

describe("normalizePath", () => {
  it.each([
    ["/", "/"],
    ["/docs/", "/docs/"],
    ["/a%20b", "/a b"],
    ["/%2F%2Fevil.com", "///evil.com"],
  ])("decodes %j to %j", (raw, decoded) => {
    expect(normalizePath(raw)).toBe(decoded);
  });

  it.each([
    "/..",
    "/a/../b",
    "/a/%2e%2e/b",
    "/./a",
    "/\\evil.com",
    "/%5Cevil.com",
    "/%5cevil.com",
    "/%09/evil.com",
    "/%0D%0ASet-Cookie:x",
    "/%00",
    "/%7F",
    "/\t",
    "/%E0%A4%A",
    "docs",
  ])("refuses %j", (raw) => {
    expect(normalizePath(raw)).toBeNull();
  });
});

describe("readCookie", () => {
  it("reads one value and refuses a name sent twice", () => {
    expect(readCookie("a=1; b=2", "b")).toBe("2");
    expect(readCookie("b=1; b=2", "b")).toBeUndefined();
    expect(readCookie(undefined, "b")).toBeUndefined();
    expect(readCookie("bb=1", "b")).toBeUndefined();
  });
});

describe("isDocumentRequest", () => {
  const req = (method: string, headers: Record<string, string>) =>
    ({ method, headers }) as unknown as Parameters<typeof isDocumentRequest>[0];
  it("is a navigation, or a request with no Sec-Fetch headers that asks for HTML", () => {
    expect(isDocumentRequest(req("GET", { "sec-fetch-mode": "navigate" }))).toBe(true);
    expect(isDocumentRequest(req("HEAD", { accept: "text/html,*/*" }))).toBe(true);
    expect(isDocumentRequest(req("GET", { "sec-fetch-mode": "cors", accept: "text/html" }))).toBe(false);
    expect(isDocumentRequest(req("GET", { accept: "*/*" }))).toBe(false);
    expect(isDocumentRequest(req("POST", { "sec-fetch-mode": "navigate" }))).toBe(false);
  });
});

describe("the gate, step by step", () => {
  it("(1) refuses a traversal, a backslash or a control character, raw or encoded, with 400", async () => {
    for (const target of ["/%09/evil.com", "/%5C/evil.com", "/%0D%0ASet-Cookie:x", "/a/%2e%2e/index.html"]) {
      const reply = await send("GET", target, navigate);
      expect(reply.status, target).toBe(400);
      expect(reply.headers.location, target).toBeUndefined();
      expect(reply.body).toBe("");
    }
  });

  it("(1) answers a method other than GET, HEAD or POST with 405", async () => {
    expect((await send("PUT", "/", withSession())).status).toBe(405);
    expect((await send("DELETE", "/", withSession())).status).toBe(405);
    expect((await send("POST", "/", withSession())).status).toBe(405);
  });

  it("(2) refuses a host not on the list with an empty 403, even with a session", async () => {
    const reply = await send("GET", "/", { ...navigate, ...withSession(), host: "main.app.example" });
    expect(reply.status).toBe(403);
    expect(reply.body).toBe("");
    expect(reply.headers["cache-control"]).toBe("no-store");
    expect(reply.headers.location).toBeUndefined();
  });

  it("(3) disallows every robot and answers health, with no site content", async () => {
    const robots = await send("GET", "/robots.txt");
    expect(robots.status).toBe(200);
    expect(robots.body).toBe("User-agent: *\nDisallow: /\n");
    const health = await send("GET", "/_door/health");
    expect(health.body).toBe("ok");
  });

  it("(4) turns a valid ticket into the session cookie and a 303 to the canonical next", async () => {
    const jws = ticket();
    const reply = await ticketPost(jws);
    expect(reply.status).toBe(303);
    expect(reply.headers.location).toBe("/docs/");
    expect(setCookies(reply)).toEqual([
      `${sessionCookie}=${jws}; Max-Age=3600; Path=/; Secure; HttpOnly; SameSite=Lax`,
      `${stateCookie}=; Max-Age=0; Path=/; Secure; HttpOnly; SameSite=None`,
    ]);
    expect(reply.headers["cache-control"]).toBe("no-store");
  });

  it("(4) gives the cookie only the ticket's remaining life", async () => {
    const reply = await ticketPost(ticket({ iat: now - 1000, exp: now + 2600 }));
    expect(setCookies(reply)[0]).toContain("Max-Age=2600;");
  });

  const refused: [string, () => Promise<Reply>][] = [
    ["a tampered ticket", () => ticketPost(tamper(ticket()))],
    ["an expired ticket", () => ticketPost(ticket({ iat: now - 3600, exp: now }))],
    ["a ticket for another host", () => ticketPost(ticket({ aud: otherHost }))],
    ["a ticket from another issuer", () => ticketPost(ticket({ iss: "https://evil.example" }))],
    ["an unknown kid", () => ticketPost(signTicket(makeKey("k2"), ticketClaims({ issuer: door, host, state, now })))],
    ["a state that is not the cookie's", () => ticketPost(ticket({ st: "t".repeat(43) }))],
    ["no state cookie", () => ticketPost(ticket(), "/docs/", "")],
    ["a state cookie sent twice", () => ticketPost(ticket(), "/docs/", `${stateCookie}=${state}; ${stateCookie}=x`)],
    ["a form next unlike the claim", () => ticketPost(ticket(), "/")],
    ["a claim next that leaves the site", () => ticketPost(ticket({ next: "/\\evil.com" }), "/\\evil.com")],
    ["a claim next of //evil.com", () => ticketPost(ticket({ next: "//evil.com" }), "//evil.com")],
    ["a ticket with no next", () => ticketPost(ticket({ next: undefined }))],
    [
      "a ticket sent as JSON",
      () => send("POST", "/_door", { "content-type": "application/json", cookie: `${stateCookie}=${state}` }, "{}"),
    ],
    [
      "a body over 16 KB",
      () =>
        send(
          "POST",
          "/_door",
          { "content-type": "application/x-www-form-urlencoded", cookie: `${stateCookie}=${state}` },
          `ticket=${"a".repeat(17 * 1024)}`,
        ),
    ],
  ];
  it.each(refused)("(4) refuses %s: a 303 back to the door, and no session", async (_name, post) => {
    const reply = await post();
    expect(reply.status).toBe(303);
    expect(reply.headers.location).toBe(`${door}/?error=ticket`);
    expect(setCookies(reply).some((value) => value.startsWith(`${sessionCookie}=`))).toBe(false);
  });

  it("(4) takes a ticket only by POST", async () => {
    expect((await send("GET", `/_door?ticket=${ticket()}`, navigate)).status).toBe(405);
  });

  it("(5) clears both cookies and walks a fixed map, never a URL from the query", async () => {
    const walk = async (query: string) => {
      const reply = await send("GET", `/_door/signout${query}`, withSession());
      expect(reply.status).toBe(303);
      expect(setCookies(reply)).toEqual([
        `${sessionCookie}=; Max-Age=0; Path=/; Secure; HttpOnly; SameSite=Lax`,
        `${stateCookie}=; Max-Age=0; Path=/; Secure; HttpOnly; SameSite=None`,
      ]);
      return reply.headers.location;
    };
    expect(await walk("?then=door")).toBe(`${door}/signout/`);
    expect(await walk("?then=beta")).toBe("https://beta.example/_door/signout?then=door");
    expect(await walk("?then=alpha")).toBe(`https://${host}/_door/signout?then=beta`);
    expect(await walk("")).toBe(`${door}/signout/`);
    expect(await walk("?then=https://evil.example/")).toBe(`${door}/signout/`);
    expect(await walk("?then=done")).toBe(`${door}/signout/`);
  });

  it("(6) serves a page, its RSC payload and its chunks to a valid session, private", async () => {
    const page = await send("GET", "/docs/", { ...navigate, ...withSession() });
    expect(page.status).toBe(200);
    expect(page.body).toBe("<h1>Docs</h1>");
    expect(page.headers["cache-control"]).toBe("private, no-store");
    const rsc = await send("GET", "/index.txt", withSession());
    expect(rsc.body).toBe("rsc payload");
    expect(rsc.headers["cache-control"]).toBe("private, no-store");
    const chunk = await send("GET", "/_next/static/chunks/app.js", withSession());
    expect(chunk.status).toBe(200);
    expect(chunk.headers["cache-control"]).toBe("private, max-age=31536000, immutable");
    const image = await send("GET", "/og/home.png", withSession());
    expect(image.headers["cache-control"]).toBe("private, no-store");
  });

  it("(6) redirects a directory without its slash with 308, keeping the query on the same origin", async () => {
    const reply = await send("GET", "/docs?tab=api", { ...navigate, ...withSession() });
    expect(reply.status).toBe(308);
    expect(reply.headers.location).toBe("/docs/?tab=api");
  });

  it("(6) answers a missing file with the 404 page", async () => {
    const reply = await send("GET", "/nope/", { ...navigate, ...withSession() });
    expect(reply.status).toBe(404);
    expect(reply.body).toBe("<h1>Page not found.</h1>");
    expect(reply.headers["cache-control"]).toBe("private, no-store");
  });

  it("(6) accepts the session on the host it was issued for and no other", async () => {
    const reply = await send("GET", "/", { ...navigate, ...withSession(), host: otherHost });
    expect(reply.status).toBe(401);
    expect(reply.body).toContain("Alpha is coming soon.");
  });

  it.each([
    ["an expired session", { iat: now - 3600, exp: now }],
    ["a session for another host", { aud: otherHost }],
    ["a session from another issuer", { iss: "https://evil.example" }],
  ])("(7) treats %s as none", async (_name, extra) => {
    expect((await send("GET", "/", withSession(extra))).status).toBe(401);
  });

  /** The coming-soon page with its one varying part, the sign-in link's next, read out. */
  const signinNext = (reply: Reply) => {
    const href = /<a class="button" href="([^"]*)">/.exec(reply.body)?.[1] ?? "";
    const url = new URL(href.replace(/&amp;/g, "&"), `https://${host}`);
    expect(url.origin).toBe(`https://${host}`);
    expect(url.pathname).toBe("/_door/signin");
    return url.searchParams.get("next");
  };
  const siteBytes = ["<h1>Home</h1>", "<h1>Docs</h1>", "rsc payload", "Page not found", "console.log"];

  it("(7) answers a page load with the coming-soon page: a 401, the gate's own HTML, no-store, nothing else set", async () => {
    const reply = await send("GET", "/docs/?tab=api", navigate);
    expect(reply.status).toBe(401);
    expect(reply.headers["content-type"]).toBe("text/html; charset=utf-8");
    expect(reply.headers["content-length"]).toBe(String(Buffer.byteLength(reply.body)));
    expect(reply.headers["cache-control"]).toBe("no-store");
    expect(reply.headers["www-authenticate"]).toBe(challenge("alpha"));
    expect(reply.headers["content-security-policy"]).toMatch(/^default-src 'none'; style-src 'sha256-[^']+'; /);
    expect(reply.headers.location).toBeUndefined();
    expect(reply.headers["set-cookie"]).toBeUndefined();
    expect(reply.body).toContain("<h1>Alpha is coming soon.</h1>");
    expect(reply.body).toContain(
      '<a class="link" href="https://door.example/get-involved/?site=alpha">Get involved</a>',
    );
    expect(signinNext(reply)).toBe("/docs/?tab=api");
  });

  it("(7) answers HEAD for a page with the same headers and no body", async () => {
    const get = await send("GET", "/docs/", navigate);
    const head = await send("HEAD", "/docs/", navigate);
    expect(head.status).toBe(401);
    expect(head.body).toBe("");
    const { date: _getDate, ...getHeaders } = get.headers;
    const { date: _headDate, ...headHeaders } = head.headers;
    expect(headHeaders).toEqual(getHeaders);
  });

  it("(7) holds no byte of the site, and is the same page for every path but the next it links to", async () => {
    const placeholder = (body: string) => body.replace(/href="\/_door\/signin\?next=[^"]*"/, 'href="NEXT"');
    const pages = await Promise.all(
      ["/", "/docs/", "/index.txt", "/_next/static/chunks/app.js", "/og/home.png", "/nope/", "/404.html"].map(
        (target) => send("GET", target, navigate),
      ),
    );
    for (const reply of pages) {
      expect(reply.status).toBe(401);
      for (const bytes of siteBytes) expect(reply.body).not.toContain(bytes);
      expect(placeholder(reply.body)).toBe(placeholder(pages[0]?.body ?? ""));
    }
    expect(pages.map(signinNext)).toEqual([
      "/",
      "/docs/",
      "/index.txt",
      "/_next/static/chunks/app.js",
      "/og/home.png",
      "/nope/",
      "/404.html",
    ]);
  });

  it("(7) links a next that would leave the site, or is too long, as /", async () => {
    expect(signinNext(await send("GET", "/%2F%2Fevil.com", navigate))).toBe("/%2F%2Fevil.com");
    expect(signinNext(await send("GET", `/${"a".repeat(600)}`, navigate))).toBe("/");
  });

  it("(4) starts a sign-in at /_door/signin: a fresh state cookie and a 302 to the door with the canonical next", async () => {
    const reply = await send("GET", `/_door/signin?next=${encodeURIComponent("/docs/?tab=api")}`, navigate);
    expect(reply.status).toBe(302);
    expect(reply.body).toBe("");
    expect(reply.headers["cache-control"]).toBe("no-store");
    expect(reply.headers["x-robots-tag"]).toBe("noindex, nofollow");
    const location = new URL(reply.headers.location ?? "");
    expect(location.origin).toBe(door);
    expect(location.pathname).toBe("/");
    const [stateSet] = setCookies(reply);
    const nonce =
      /^__Host-crv_door_state=([A-Za-z0-9_-]{43}); Max-Age=600; Path=\/; Secure; HttpOnly; SameSite=None$/.exec(
        stateSet ?? "",
      )?.[1];
    expect(nonce).toBeDefined();
    expect(Object.fromEntries(location.searchParams)).toEqual({
      site: "alpha",
      host,
      next: "/docs/?tab=api",
      state: nonce,
    });
    const again = await send("GET", `/_door/signin?next=${encodeURIComponent("/docs/?tab=api")}`, navigate);
    expect(new URL(again.headers.location ?? "").searchParams.get("state")).not.toBe(nonce);
  });

  it("(4) follows the coming-soon page's own link to the door, coming back to the page asked for", async () => {
    const page = await send("GET", "/docs/?tab=api", navigate);
    const href = (/<a class="button" href="([^"]*)">/.exec(page.body)?.[1] ?? "").replace(/&amp;/g, "&");
    const reply = await send("GET", href, navigate);
    expect(reply.status).toBe(302);
    expect(new URL(reply.headers.location ?? "").searchParams.get("next")).toBe("/docs/?tab=api");
  });

  // Canonical next's hostile cases, arriving as the sign-in's query rather than as a request path: each is refused (/)
  // or reduced to a path on this host. The location is always the door, and the next it names never leaves the site.
  const hostile: [string, string, string][] = [
    ["//evil.com", "next=%2F%2Fevil.com", "/"],
    ["/\\evil.com", "next=%2F%5Cevil.com", "/"],
    ["/\\\\evil.com", "next=%2F%5C%5Cevil.com", "/"],
    ["/<TAB>/evil.com", "next=%2F%09%2Fevil.com", "/"],
    ["/<LF>/evil.com", "next=%2F%0A%2Fevil.com", "/"],
    ["/<CR><LF>Set-Cookie:x", "next=%2F%0D%0ASet-Cookie%3Ax", "/"],
    ["/.//evil.com", "next=%2F.%2F%2Fevil.com", "/"],
    ["/..//evil.com", "next=%2F..%2F%2Fevil.com", "/"],
    ["https://evil.com", "next=https%3A%2F%2Fevil.com", "/"],
    ["/%2F%2Fevil.com, kept: it is still a path", "next=%2F%252F%252Fevil.com", "/%2F%2Fevil.com"],
    ["a next over 512 characters", `next=%2F${"a".repeat(600)}`, "/"],
    ["no next", "", "/"],
    ["an empty next", "next=", "/"],
    ["a next sent twice", "next=%2Fa%2F&next=%2Fb%2F", "/"],
    ["a dot segment", "next=%2Fa%2F..%2Fdocs%2F", "/docs/"],
    ["a plain path and query", "next=%2Fdocs%2F%3Ftab%3Dapi", "/docs/?tab=api"],
  ];
  it.each(hostile)("(4) takes %s through /_door/signin to the door safely", async (_name, query, expected) => {
    const reply = await send("GET", `/_door/signin?${query}`, navigate);
    expect(reply.status).toBe(302);
    expect(reply.headers["set-cookie"]?.length).toBe(1);
    const location = new URL(reply.headers.location ?? "");
    expect(location.origin).toBe(door);
    expect(location.searchParams.get("next")).toBe(expected);
    expect(location.searchParams.get("host")).toBe(host);
    expect(unsafe(reply.headers.location ?? "")).toBe(false);
  });

  it("(4) starts a sign-in only by GET or HEAD, and only on an allowed host", async () => {
    expect((await send("POST", "/_door/signin?next=%2F", navigate)).status).toBe(405);
    const elsewhere = await send("GET", "/_door/signin?next=%2F", { ...navigate, host: "evil.example" });
    expect(elsewhere.status).toBe(403);
    expect(elsewhere.headers["set-cookie"]).toBeUndefined();
    expect((await send("HEAD", "/_door/signin?next=%2F", navigate)).status).toBe(302);
  });

  it("(7) answers anything that is not a page load with an empty 401", async () => {
    for (const target of ["/_next/static/chunks/app.js", "/index.txt", "/og/home.png", "/docs/"]) {
      const reply = await send("GET", target, { accept: "*/*", "sec-fetch-mode": "cors" });
      expect(reply.status, target).toBe(401);
      expect(reply.body, target).toBe("");
      expect(reply.headers["www-authenticate"], target).toBe(challenge("alpha"));
      expect(reply.headers["set-cookie"], target).toBeUndefined();
    }
  });

  it("puts the security headers, noindex and a no-store or private Cache-Control on every response", async () => {
    const replies = await Promise.all([
      send("GET", "/%09/x", navigate),
      send("PUT", "/"),
      send("GET", "/", { host: "evil.example" }),
      send("GET", "/robots.txt"),
      send("GET", "/_door/health"),
      ticketPost(ticket()),
      ticketPost(tamper(ticket())),
      send("GET", "/_door/signout?then=door"),
      send("GET", "/_door/signin?next=%2F"),
      send("HEAD", "/docs/", navigate),
      send("GET", "/_door/unknown"),
      send("GET", "/docs/", withSession()),
      send("GET", "/docs", withSession()),
      send("GET", "/nope", withSession()),
      send("GET", "/_next/static/chunks/app.js", withSession()),
      send("GET", "/", navigate),
      send("GET", "/"),
    ]);
    for (const reply of replies) {
      expect(reply.headers["x-robots-tag"]).toBe("noindex, nofollow");
      expect(reply.headers["x-content-type-options"]).toBe("nosniff");
      expect(reply.headers["x-frame-options"]).toBe("DENY");
      expect(reply.headers["strict-transport-security"]).toMatch(/^max-age=\d+/);
      expect(reply.headers["cache-control"]).toMatch(/no-store|private/);
    }
  });

  it("(8) fails closed: an exception is an empty 500 and serves nothing", async () => {
    const broken = createServer(
      createGate({
        config,
        site: root,
        now: () => {
          throw new Error("clock");
        },
      }),
    );
    await new Promise<void>((resolve) => broken.listen(0, "127.0.0.1", resolve));
    const brokenPort = (broken.address() as AddressInfo).port;
    const reply = await new Promise<Reply>((resolve, reject) => {
      const req = request(
        { host: "127.0.0.1", port: brokenPort, path: "/", headers: { host, ...withSession() } },
        (res) => {
          const chunks: Buffer[] = [];
          res.on("data", (chunk: Buffer) => chunks.push(chunk));
          res.on("end", () =>
            resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks).toString() }),
          );
        },
      );
      req.on("error", reject);
      req.end();
    });
    broken.close();
    expect(reply.status).toBe(500);
    expect(reply.body).toBe("");
  });
});
