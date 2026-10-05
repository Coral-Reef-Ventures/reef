import { randomBytes } from "node:crypto";
import { createServer, type IncomingMessage, type RequestListener, type Server, type ServerResponse } from "node:http";
import { fileURLToPath } from "node:url";

import { sendFile, staticTarget } from "../serve.ts";
import { type GateConfig, readGateConfig } from "./config.ts";
import { canonicalNext, unsafe } from "./next.ts";
import { comingSoon } from "./page.ts";
import { verifyTicket } from "./verify.ts";

// The gate is the one thing in a locked site's compute bundle, and the bundle carries no node_modules, so this file
// and everything it imports use Node's own modules only (a test holds it).

/** The session: the door's JWS itself, for an hour at most. */
export const sessionCookie = "__Host-crv_door";
/** The nonce the gate sets before it sends a visitor to the door, which the ticket must name as `st`. */
export const stateCookie = "__Host-crv_door_state";
export const stateLifetimeSeconds = 600;
/**
 * A marker that this browser has held a session here, so that once the hour is up a page load bounces silently through
 * the door (which issues a fresh ticket while its own sign-in lives) instead of meeting the coming-soon page. It holds
 * no identity and opens nothing: without a valid session it changes only which way a page load is sent to sign in.
 */
export const seenCookie = "__Host-crv_door_seen";
export const seenLifetimeSeconds = 30 * 24 * 60 * 60;

const maxBodyBytes = 16 * 1024;
const encodedUnsafe = /%(5c|[01][0-9a-f]|7f)/i;

/** Every response, whatever its status: none of a locked site may be framed, sniffed or indexed. */
const securityHeaders = {
  "Strict-Transport-Security": "max-age=63072000",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "X-Robots-Tag": "noindex, nofollow",
};

const cookie = (name: string, value: string, maxAge: number, sameSite: "Lax" | "None") =>
  `${name}=${value}; Max-Age=${maxAge}; Path=/; Secure; HttpOnly; SameSite=${sameSite}`;
const clearSession = cookie(sessionCookie, "", 0, "Lax");
const clearState = cookie(stateCookie, "", 0, "None");
const markSeen = cookie(seenCookie, "1", seenLifetimeSeconds, "Lax");
const clearSeen = cookie(seenCookie, "", 0, "Lax");

/** One value of a cookie, or undefined when it is absent or sent twice (which a `__Host-` cookie never is). */
export const readCookie = (header: string | undefined, name: string): string | undefined => {
  const values = (header ?? "")
    .split(";")
    .map((pair) => pair.trim())
    .filter((pair) => pair.startsWith(`${name}=`))
    .map((pair) => pair.slice(name.length + 1));
  return values.length === 1 ? values[0] : undefined;
};

/**
 * Step 1 of every request: the raw path, refused (null) if it holds a backslash, a control character, or a `.` or
 * `..` segment, whether raw or percent-encoded, or does not decode. Otherwise the decoded path.
 */
export const normalizePath = (rawPath: string): string | null => {
  if (!rawPath.startsWith("/") || unsafe(rawPath) || encodedUnsafe.test(rawPath)) {
    return null;
  }
  let decoded: string;
  try {
    decoded = decodeURIComponent(rawPath);
  } catch {
    return null;
  }
  if (unsafe(decoded)) return null;
  if (decoded.split("/").some((segment) => segment === "." || segment === "..")) return null;
  return decoded;
};

/** The request target as received, split at its first `?`: the raw path, and the query with its `?`. */
export const splitTarget = (target: string): { rawPath: string; rawQuery: string } => {
  const at = target.indexOf("?");
  return at === -1 ? { rawPath: target, rawQuery: "" } : { rawPath: target.slice(0, at), rawQuery: target.slice(at) };
};

/** GET, HEAD and POST; the gate answers anything else with 405. */
const isGatedMethod = (method: string | undefined) => method === "GET" || method === "HEAD" || method === "POST";

/**
 * The challenge every 401 carries, as RFC 9110 requires of one. No registered scheme describes a session cookie from a
 * sign-in page, so this is the shape of the Cookie scheme drafted for exactly that (draft-broyer-http-cookie-auth):
 * where the sign-in starts, and the cookie it ends in. Browsers prompt only for the schemes they implement (Basic,
 * Digest, Negotiate, NTLM), so for this one they render the body, which for a page load is the coming-soon page.
 */
export const challenge = (site: string) =>
  `Cookie realm="${site}", form-action="/_door/signin", cookie-name="${sessionCookie}"`;

/** The paths the gate answers itself, with or without a session: robots.txt and its own /_door/ endpoints. */
const isOwnPath = (path: string) => path === "/robots.txt" || path.startsWith("/_door/");

/** Whether a request is a page load, which gets the door, rather than a fetch, which gets a bare 401. */
export const isDocumentRequest = (request: IncomingMessage): boolean => {
  if (request.method !== "GET" && request.method !== "HEAD") return false;
  const mode = request.headers["sec-fetch-mode"];
  if (mode !== undefined) return mode === "navigate";
  return String(request.headers.accept ?? "").includes("text/html");
};

/**
 * A page load in the window itself: a document request whose `Sec-Fetch-Dest`, when sent, is `document`. Only this
 * may start a sign-in, so an image, a frame or a fetch from another site cannot overwrite a visitor's state cookie.
 */
export const isTopLevelNavigation = (request: IncomingMessage): boolean => {
  if (!isDocumentRequest(request)) return false;
  const dest = request.headers["sec-fetch-dest"];
  return dest === undefined || dest === "document";
};

/**
 * The form body, or null once it passes 16 KB. The rest of an oversized body is read and thrown away rather than the
 * socket destroyed, so the visitor still gets the redirect back to the door; that response closes the connection.
 */
const readBody = (request: IncomingMessage): Promise<string | null> =>
  new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    const collect = (chunk: Buffer) => {
      size += chunk.length;
      if (size > maxBodyBytes) {
        request.off("data", collect);
        chunks.length = 0;
        request.resume();
        resolve(null);
        return;
      }
      chunks.push(chunk);
    };
    request.on("data", collect);
    request.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    request.on("error", reject);
  });

/** One form field, present exactly once. */
const field = (form: URLSearchParams, name: string): string | undefined => {
  const values = form.getAll(name);
  return values.length === 1 ? values[0] : undefined;
};

export type GateOptions = {
  config: GateConfig;
  /** The static export the gate serves from. */
  site: string;
  /** Seconds since the epoch; the clock by default. */
  now?: () => number;
};

/**
 * The gate: every request to a locked site, in this order. (1) A path with a backslash, a control character or a dot
 * segment, raw or encoded, is a 400; a method other than GET, HEAD or POST is a 405. (2) A host not on the list is a
 * 403. (3) robots.txt disallows everything, and /_door/health answers ok. (4) POST /_door verifies a ticket from the
 * door and sets the session; /_door/signin starts a sign-in at the door. (5) /_door/signout clears the door's cookies and walks
 * a fixed map. (6) A request with a valid session is served from the export. (7) Without one, a page load gets the
 * coming-soon page, a 401 whose sign-in link carries the canonical next (or, from a browser that has had a session
 * here, a silent bounce through the door), and anything else gets an empty 401. (8) An
 * exception is a 500 with nothing in it: the gate fails closed.
 */
export const createGate = ({
  config,
  site,
  now = () => Math.floor(Date.now() / 1000),
}: GateOptions): RequestListener => {
  const empty = (response: ServerResponse, status: number, headers: Record<string, string | string[]> = {}) => {
    response.writeHead(status, { ...securityHeaders, "Cache-Control": "no-store", "Content-Length": "0", ...headers });
    response.end();
  };
  const redirect = (response: ServerResponse, status: number, location: string, cookies: string[] = []) =>
    empty(response, status, { Location: location, ...(cookies.length > 0 && { "Set-Cookie": cookies }) });
  const text = (response: ServerResponse, request: IncomingMessage, body: string) => {
    response.writeHead(200, {
      ...securityHeaders,
      "Cache-Control": "no-store",
      "Content-Type": "text/plain; charset=utf-8",
      "Content-Length": String(Buffer.byteLength(body)),
    });
    response.end(request.method === "HEAD" ? undefined : body);
  };
  const doorSignout = `${config.door}/signout/`;
  const page = comingSoon(config.page, config.door, config.site);
  const unauthorized = challenge(config.site);

  /** Where `then` leads: the next stop's gate, or the door's sign-out page. Never a URL from the query. */
  const signoutTarget = (then: string | null): string => {
    const index = config.signout.findIndex((stop) => stop.id === then);
    const stop = config.signout[index];
    if (!stop) return doorSignout;
    const following = config.signout[index + 1]?.id ?? "door";
    return `https://${stop.host}/_door/signout?then=${following}`;
  };

  const toDoorWithError = (response: ServerResponse, close = false) =>
    empty(response, 303, {
      Location: `${config.door}/?error=ticket`,
      "Set-Cookie": [clearState],
      ...(close && { Connection: "close" }),
    });

  /** Step 4: a ticket the door posted, which becomes the session, or a refusal that sends the visitor back. */
  const acceptTicket = async (request: IncomingMessage, response: ServerResponse, host: string) => {
    if (request.method !== "POST") return empty(response, 405, { Allow: "POST" });
    if (!String(request.headers["content-type"] ?? "").startsWith("application/x-www-form-urlencoded")) {
      return toDoorWithError(response);
    }
    const body = await readBody(request);
    if (body === null) return toDoorWithError(response, true);
    const form = new URLSearchParams(body);
    const state = readCookie(request.headers.cookie, stateCookie);
    if (!state) return toDoorWithError(response);
    const ticket = field(form, "ticket");
    const verdict = verifyTicket(ticket, {
      keys: config.keys,
      issuer: config.issuer,
      audience: host,
      now: now(),
      state,
    });
    if (!verdict.ok) return toDoorWithError(response);
    const formNext = canonicalNext(field(form, "next"), host);
    const claimNext = canonicalNext(verdict.claims.next, host);
    if (formNext === null || claimNext === null || formNext !== claimNext) return toDoorWithError(response);
    const maxAge = verdict.claims.exp - now();
    return redirect(response, 303, claimNext, [
      cookie(sessionCookie, ticket ?? "", maxAge, "Lax"),
      clearState,
      markSeen,
    ]);
  };

  /**
   * Step 4's sign-in start, which the coming-soon page's button links to: a fresh state cookie and a 302 to the door,
   * naming this site, this host and where to come back to. `next` is taken from the query only after *Canonical next*;
   * one that fails, or is missing or sent twice, becomes `/`. Only a top-level navigation starts one; anything else
   * gets an empty 401 and no cookie.
   */
  const startSignin = (request: IncomingMessage, response: ServerResponse, rawQuery: string, host: string) => {
    if (!isTopLevelNavigation(request)) return empty(response, 401, { "WWW-Authenticate": unauthorized });
    const asked = new URLSearchParams(rawQuery).getAll("next");
    const next = (asked.length === 1 ? canonicalNext(asked[0], host) : null) ?? "/";
    return toDoor(response, next, host);
  };

  /** A fresh state cookie and a 302 to the door, for an already canonical `next`. */
  const toDoor = (response: ServerResponse, next: string, host: string) => {
    const nonce = randomBytes(32).toString("base64url");
    const query = new URLSearchParams({ site: config.site, host, next, state: nonce });
    return redirect(response, 302, `${config.door}/?${query}`, [
      cookie(stateCookie, nonce, stateLifetimeSeconds, "None"),
    ]);
  };

  /**
   * Step 7: no session. A page load gets the coming-soon page, which is the gate's own and holds none of the site;
   * its sign-in link carries the raw request target after *Canonical next*, or `/`. Anything else is a bare 401.
   * Both are 401, so a request without a session never gets a 2xx with anything of the site's in it, and a probe can
   * tell locked from open by the status alone. A page load from a browser that has held a session here (the seen
   * cookie) is sent straight to the door instead, which renews the session silently while the door's sign-in lives.
   */
  const refuse = (request: IncomingMessage, response: ServerResponse, target: string, host: string) => {
    if (!isDocumentRequest(request)) return empty(response, 401, { "WWW-Authenticate": unauthorized });
    const next = canonicalNext(target, host) ?? "/";
    if (readCookie(request.headers.cookie, seenCookie) === "1" && isTopLevelNavigation(request)) {
      return toDoor(response, next, host);
    }
    const body = page.html(next);
    response.writeHead(401, {
      ...securityHeaders,
      "Cache-Control": "no-store",
      "Content-Type": "text/html; charset=utf-8",
      "Content-Length": String(Buffer.byteLength(body)),
      "Content-Security-Policy": page.csp,
      "WWW-Authenticate": unauthorized,
    });
    response.end(request.method === "HEAD" ? undefined : body);
  };

  /** Step 6: the export, as Amplify maps it, private to the browser that holds the session. */
  const serveSite = async (
    request: IncomingMessage,
    response: ServerResponse,
    path: string,
    location: { rawPath: string; rawQuery: string; host: string },
  ) => {
    const found = await staticTarget(site, path);
    if (found.kind === "outside") return empty(response, 400);
    if (found.kind === "directory") {
      const withSlash = canonicalNext(`${location.rawPath}/${location.rawQuery}`, location.host);
      return withSlash === null ? empty(response, 404) : redirect(response, 308, withSlash);
    }
    if (found.kind === "missing") {
      return sendFile(request, response, found.notFound, 404, {
        ...securityHeaders,
        "Cache-Control": "private, no-store",
      });
    }
    const cacheControl = path.startsWith("/_next/static/")
      ? "private, max-age=31536000, immutable"
      : "private, no-store";
    return sendFile(request, response, found.file, 200, { ...securityHeaders, "Cache-Control": cacheControl });
  };

  /** Steps 3, 4's sign-in start and 5: what the gate answers itself, which holds nothing of the site. */
  const answerOwn = (
    request: IncomingMessage,
    response: ServerResponse,
    path: string,
    rawQuery: string,
    host: string,
  ) => {
    if (path === "/robots.txt") return text(response, request, "User-agent: *\nDisallow: /\n");
    if (path === "/_door/health") return text(response, request, "ok");
    if (path === "/_door/signin") return startSignin(request, response, rawQuery, host);
    if (path === "/_door/signout") {
      const then = new URLSearchParams(rawQuery).get("then");
      return redirect(response, 303, signoutTarget(then), [clearSession, clearState, clearSeen]);
    }
    return empty(response, 404);
  };

  /** The host the request names, lowercased, if it is one this gate answers on. */
  const allowedHost = (request: IncomingMessage): string | undefined => {
    const value = request.headers[config.hostHeader];
    const host = typeof value === "string" ? value.toLowerCase() : "";
    return config.hosts.includes(host) ? host : undefined;
  };

  /** Whether the request carries a session the door issued for this host, still live. */
  const hasSession = (request: IncomingMessage, host: string) => {
    const session = readCookie(request.headers.cookie, sessionCookie);
    return (
      session !== undefined &&
      verifyTicket(session, { keys: config.keys, issuer: config.issuer, audience: host, now: now() }).ok
    );
  };

  const handle = async (request: IncomingMessage, response: ServerResponse) => {
    const target = request.url ?? "";
    const { rawPath, rawQuery } = splitTarget(target);
    const path = normalizePath(rawPath);
    if (path === null) return empty(response, 400);
    if (!isGatedMethod(request.method)) return empty(response, 405, { Allow: "GET, HEAD, POST" });
    const host = allowedHost(request);
    if (host === undefined) return empty(response, 403);

    if (path === "/_door") return acceptTicket(request, response, host);
    if (request.method === "POST") return empty(response, 405, { Allow: "GET, HEAD" });
    if (isOwnPath(path)) return answerOwn(request, response, path, rawQuery, host);

    if (!hasSession(request, host)) return refuse(request, response, target, host);
    return serveSite(request, response, path, { rawPath, rawQuery, host });
  };

  return (request, response) => {
    handle(request, response).catch((error: unknown) => {
      console.error("gate: request failed", error instanceof Error ? error.name : typeof error);
      if (response.headersSent) {
        response.destroy();
      } else {
        empty(response, 500);
      }
    });
  };
};

export type StartGateOptions = {
  /** gate.config.json. */
  config: string | URL;
  /** The static export. */
  site: string | URL;
  /** 3000 by default, the port Amplify's deployment specification names. */
  port?: number;
};

/** Reads the configuration, refusing to start on a bad one, and listens. The bundle's server.mjs calls this. */
export const startGate = async ({ config, site, port = 3000 }: StartGateOptions): Promise<Server> => {
  const parsed = await readGateConfig(config);
  const root = typeof site === "string" ? site : fileURLToPath(site);
  const server = createServer(createGate({ config: parsed, site: root }));
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, () => resolve());
  });
  console.log(`gate: ${parsed.site} listening on ${port}`);
  return server;
};
