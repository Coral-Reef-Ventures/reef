import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { gunzipSync } from "node:zlib";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { encodingFor, serve } from "../src/serve.ts";

/** An export with a home page, one directory page, a stylesheet and a 404 page, as Next writes one. */
let root: string;
let origin: string;
let close: () => void;

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), "reef-serve-"));
  await mkdir(path.join(root, "pricing"), { recursive: true });
  await writeFile(path.join(root, "index.html"), "<h1>Home</h1>");
  await writeFile(path.join(root, "pricing", "index.html"), "<h1>Pricing</h1>");
  await writeFile(path.join(root, "404.html"), "<h1>Page not found.</h1>");
  await writeFile(path.join(root, "site.css"), "body{margin:0}".repeat(40));
  await writeFile(path.join(root, "mark.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  const started = await serve({ root, port: 0 });
  origin = started.url;
  close = () => started.server.close();
});

afterAll(async () => {
  close();
  await rm(root, { recursive: true, force: true });
});

// Nothing in these requests asks for compression, so bodies come back as written.
const get = (pathname: string, headers: Record<string, string> = {}) =>
  fetch(`${origin}${pathname}`, { redirect: "manual", headers: { "accept-encoding": "identity", ...headers } });

describe("the static server", () => {
  it("answers a directory with its index.html", async () => {
    const response = await get("/pricing/");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(await response.text()).toBe("<h1>Pricing</h1>");
  });

  it("redirects a directory path without its slash, keeping the query", async () => {
    const response = await get("/pricing?plan=team");
    expect(response.status).toBe(301);
    expect(response.headers.get("location")).toBe("/pricing/?plan=team");
  });

  it("serves the 404 page with status 404 for anything else", async () => {
    const response = await get("/no-such-page/");
    expect(response.status).toBe(404);
    expect(await response.text()).toBe("<h1>Page not found.</h1>");
  });

  it("types a file by its extension and leaves images uncompressed", async () => {
    const css = await get("/site.css");
    expect(css.headers.get("content-type")).toBe("text/css; charset=utf-8");
    const png = await get("/mark.png", { "accept-encoding": "br, gzip" });
    expect(png.headers.get("content-type")).toBe("image/png");
    expect(png.headers.get("content-encoding")).toBeNull();
  });

  it("compresses text as the browser accepts, and says so", async () => {
    const response = await fetch(`${origin}/site.css`, { headers: { "accept-encoding": "gzip" } });
    expect(response.headers.get("vary")).toBe("Accept-Encoding");
    // fetch decodes the body itself; the header is the evidence, and the decoded text is the file.
    expect(response.headers.get("content-encoding")).toBe("gzip");
    expect(await response.text()).toBe("body{margin:0}".repeat(40));
  });

  it("refuses a path that climbs out of the export", async () => {
    const response = await fetch(`${origin}/%2e%2e/%2e%2e/etc/passwd`, { redirect: "manual" });
    expect([400, 404]).toContain(response.status);
    expect(await response.text()).not.toMatch(/root:/);
  });
});

describe("encodingFor", () => {
  it("prefers Brotli, then gzip, for text and SVG only", () => {
    expect(encodingFor("text/html; charset=utf-8", "gzip, deflate, br")).toBe("br");
    expect(encodingFor("application/json", "gzip")).toBe("gzip");
    expect(encodingFor("image/svg+xml", "br")).toBe("br");
    expect(encodingFor("image/png", "br, gzip")).toBeUndefined();
    expect(encodingFor("font/woff2", "br, gzip")).toBeUndefined();
    expect(encodingFor("text/css; charset=utf-8", "")).toBeUndefined();
  });

  it("is what gunzip undoes", () => {
    expect(gunzipSync(Buffer.from([0x1f, 0x8b, 8, 0, 0, 0, 0, 0, 0, 3, 3, 0, 0, 0, 0, 0, 0, 0, 0, 0])).length).toBe(0);
  });
});
