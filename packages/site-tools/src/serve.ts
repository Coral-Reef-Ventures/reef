import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import path from "node:path";
import { createBrotliCompress, createGzip } from "node:zlib";

const types: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".txt": "text/plain; charset=utf-8",
  ".xml": "application/xml",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
  ".ico": "image/x-icon",
};

const isFile = async (file: string) => (await stat(file).catch(() => null))?.isFile() ?? false;
const isDirectory = async (file: string) => (await stat(file).catch(() => null))?.isDirectory() ?? false;

/** Brotli or gzip for text, as the browser accepts; images and fonts are already compressed. */
export const encodingFor = (type: string, accepts: string): "br" | "gzip" | undefined => {
  if (!/^(text\/|application\/(json|xml)|image\/svg)/.test(type)) {
    return undefined;
  }
  return accepts.includes("br") ? "br" : accepts.includes("gzip") ? "gzip" : undefined;
};

/**
 * A server for a static export the way Amplify Hosting serves one, for screen tests and Lighthouse runs: a directory
 * answers with its index.html, a directory path without its slash redirects to it, anything else is the 404 page
 * with status 404, and text is compressed (Brotli or gzip) as the CDN compresses it. Not started: `listen` it, or
 * call `serve`.
 */
export const createStaticServer = (root: string): Server => {
  const base = path.resolve(root);
  return createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://localhost");
    const file = path.join(base, decodeURIComponent(url.pathname));
    if (file !== base && !file.startsWith(`${base}${path.sep}`)) {
      response.writeHead(400).end();
      return;
    }
    const send = (target: string, status = 200) => {
      const type = types[path.extname(target)] ?? "application/octet-stream";
      const encoding = encodingFor(type, String(request.headers["accept-encoding"] ?? ""));
      response.writeHead(status, {
        "Content-Type": type,
        Vary: "Accept-Encoding",
        ...(encoding && { "Content-Encoding": encoding }),
      });
      const body = createReadStream(target);
      const compressor = encoding === "br" ? createBrotliCompress() : encoding === "gzip" ? createGzip() : undefined;
      (compressor ? body.pipe(compressor) : body).pipe(response);
    };
    if (await isFile(file)) {
      send(file);
    } else if (await isDirectory(file)) {
      if (url.pathname.endsWith("/")) {
        send(path.join(file, "index.html"));
      } else {
        response.writeHead(301, { Location: `${url.pathname}/${url.search}` }).end();
      }
    } else {
      send(path.join(base, "404.html"), 404);
    }
  });
};

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
