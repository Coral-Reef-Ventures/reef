import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import {
  createServer,
  type IncomingMessage,
  type OutgoingHttpHeaders,
  type Server,
  type ServerResponse,
} from "node:http";
import path from "node:path";
import { createBrotliCompress, createGzip } from "node:zlib";

// This module is also part of the door gate's compute bundle (door/package.ts copies it), so it imports nothing but
// Node's own modules.

const types: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".webmanifest": "application/manifest+json",
  ".txt": "text/plain; charset=utf-8",
  ".xml": "application/xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".svg": "image/svg+xml",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ico": "image/x-icon",
};

/** The Content-Type a file is served with, by its extension. */
export const contentTypeOf = (file: string): string => types[path.extname(file)] ?? "application/octet-stream";

const isFile = async (file: string) => (await stat(file).catch(() => null))?.isFile() ?? false;
const isDirectory = async (file: string) => (await stat(file).catch(() => null))?.isDirectory() ?? false;

/** Brotli or gzip for text, as the browser accepts; images and fonts are already compressed. */
export const encodingFor = (type: string, accepts: string): "br" | "gzip" | undefined => {
  if (!/^(text\/|application\/(json|xml|manifest\+json)|image\/svg)/.test(type)) {
    return undefined;
  }
  return accepts.includes("br") ? "br" : accepts.includes("gzip") ? "gzip" : undefined;
};

/**
 * What a decoded path names inside an export, the way Amplify Hosting maps one: a file, a directory's index.html
 * when the path ends in a slash, a directory reached without its slash (the caller redirects), nothing, or a path
 * outside the export altogether (the caller refuses it).
 */
export type StaticTarget =
  | { kind: "file"; file: string }
  | { kind: "directory" }
  | { kind: "missing"; notFound: string }
  | { kind: "outside" };

export const staticTarget = async (root: string, decodedPath: string): Promise<StaticTarget> => {
  const base = path.resolve(root);
  const file = path.join(base, decodedPath);
  if (file !== base && !file.startsWith(`${base}${path.sep}`)) {
    return { kind: "outside" };
  }
  const notFound = path.join(base, "404.html");
  if (await isFile(file)) {
    return { kind: "file", file };
  }
  if (await isDirectory(file)) {
    if (decodedPath.endsWith("/")) {
      const index = path.join(file, "index.html");
      return (await isFile(index)) ? { kind: "file", file: index } : { kind: "missing", notFound };
    }
    return { kind: "directory" };
  }
  return { kind: "missing", notFound };
};

/**
 * Streams one file, typed by its extension and compressed as the request accepts, with any extra headers the caller
 * adds. A HEAD request gets the headers alone. A file that cannot be read after the headers are out ends the
 * response rather than sending anything else.
 */
export const sendFile = async (
  request: IncomingMessage,
  response: ServerResponse,
  file: string,
  status = 200,
  headers: OutgoingHttpHeaders = {},
): Promise<void> => {
  if (!(await isFile(file))) {
    response.writeHead(status, { ...headers, "Content-Length": "0" }).end();
    return;
  }
  const type = contentTypeOf(file);
  const encoding = encodingFor(type, String(request.headers["accept-encoding"] ?? ""));
  response.writeHead(status, {
    ...headers,
    "Content-Type": type,
    Vary: "Accept-Encoding",
    ...(encoding && { "Content-Encoding": encoding }),
  });
  if (request.method === "HEAD") {
    response.end();
    return;
  }
  const body = createReadStream(file);
  const compressor = encoding === "br" ? createBrotliCompress() : encoding === "gzip" ? createGzip() : undefined;
  body.on("error", () => response.destroy());
  (compressor ? body.pipe(compressor) : body).pipe(response);
};

/**
 * A server for a static export the way Amplify Hosting serves one, for screen tests and Lighthouse runs: a directory
 * answers with its index.html, a directory path without its slash redirects to it, anything else is the 404 page
 * with status 404, and text is compressed (Brotli or gzip) as the CDN compresses it. Not started: `listen` it, or
 * call `serve`.
 */
export const createStaticServer = (root: string): Server =>
  createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://localhost");
    let decoded: string;
    try {
      decoded = decodeURIComponent(url.pathname);
    } catch {
      response.writeHead(400).end();
      return;
    }
    const target = await staticTarget(root, decoded);
    if (target.kind === "outside") {
      response.writeHead(400).end();
    } else if (target.kind === "file") {
      await sendFile(request, response, target.file);
    } else if (target.kind === "directory") {
      response.writeHead(301, { Location: `${url.pathname}/${url.search}` }).end();
    } else {
      await sendFile(request, response, target.notFound, 404);
    }
  });

export type ServeOptions = {
  /** The static export; `out` by default, Next's. */
  root?: string;
  /** 0 takes a free port, which `url` then names. */
  port?: number;
};

/** The server, listening. */
export const serve = async ({
  root = "out",
  port = 3140,
}: ServeOptions = {}): Promise<{ server: Server; url: string }> => {
  const server = createStaticServer(root);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, () => resolve());
  });
  const address = server.address();
  const bound = typeof address === "object" && address ? address.port : port;
  return { server, url: `http://localhost:${bound}` };
};
