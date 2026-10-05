# @coralreefventures/site-tools

Three command-line tools for a Coral Reef public site, which is a Next.js static export served by Amplify Hosting.
Both sites carried the first two as `scripts/serve.ts` and `scripts/lighthouse.ts`; they are bins now, and the
products' scripts go. The third locks a site behind the door.

```sh
reef-serve [--root out] [--port 3140]
reef-lighthouse [--root out] [--reports lighthouse] [--port 3160] [--threshold 90] [--chrome <path>] [path ...]
reef-door-bundle --site <id> [--out out] --door-url <url> --hosts <h1,h2> --jwks-url <url> [--signout-chain id=host,...]
```

`reef-serve` serves the export the way Amplify does, for Playwright and Lighthouse: a directory answers with its
`index.html`, a directory path without its slash redirects to it, anything else is the 404 page with status 404,
and text is compressed as the CDN compresses it. `PORT` is read when `--port` is not given, so a Playwright
`webServer` command can pass either:

```ts
webServer: { command: `pnpm exec reef-serve --port ${port}`, port },
```

`reef-lighthouse` is the merge gate: Lighthouse on every page in the export's sitemap (or the paths given), with its
default mobile emulation, each of performance, accessibility, best practices and SEO at the threshold or above. A
page under it fails the run and leaves its report in `--reports`. Lighthouse itself is not a dependency, because it
bundles axe-core (MPL-2.0), which is outside the family's licence allowlist; it runs through `pnpm dlx`, pinned
(`--lighthouse-version`). Chrome is Playwright's Chromium when `@playwright/test` is installed beside this package,
or `--chrome`.

## The door gate

`reef-door-bundle` turns a static export into an Amplify deployment that serves nothing without a session from the
door. It writes `.amplify-hosting/` with the export inside the gate's compute bundle and a deployment manifest with
exactly one route, `/*` to Compute, and no static route, so every byte (pages, RSC payloads, `_next/static` chunks,
images, social cards, the 404 page) is answered by the gate. The app runs on platform `WEB_COMPUTE` with the cache
type `AMPLIFY_MANAGED`, so cookies are in the CDN's cache key.

```sh
reef-door-bundle --site <id> --door-url https://<door> --hosts <host> --jwks-url https://<door>/.well-known/crv-door-jwks.json \
  --signout-chain <id>=<host>,<id>=<host>
```

Each flag falls back to an environment variable, so a build spec can set them per app: `CRV_DOOR_URL`,
`CRV_DOOR_HOSTS`, `CRV_DOOR_JWKS_URL`, `CRV_DOOR_SIGNOUT_CHAIN` and `CRV_DOOR_HOST_HEADER` (`host`, the default, or
`x-forwarded-host` if the platform rewrites Host). The bin fetches the JWKS and fails the build if it is unreachable,
empty, or anything but P-256 public keys; it refuses a `static/` directory, a second route and a bundle over 200 MB.

The gate is a Node server with no dependencies (it imports Node's own modules and nothing else, which a test holds),
listening on port 3000. For every request, in order:

1. A path with `..`, a backslash or a control character, raw or percent-encoded, is a 400; a method other than GET,
   HEAD or POST is a 405.
2. A Host not in `--hosts` is an empty 403.
3. `/robots.txt` disallows everything; `/_door/health` answers `ok`.
4. `POST /_door` takes the door's ticket from a form body: an ES256 JWS whose `kid` is in the JWKS, issued by the door
   for this exact host, unexpired and living at most an hour, bound to the `__Host-crv_door_state` cookie, and naming
   the same canonical `next` as the form. It becomes the `__Host-crv_door` cookie (`HttpOnly; Secure; SameSite=Lax`,
   for the ticket's remaining life) and a 303 to `next`. Anything wrong is a 303 back to the door with `?error=ticket`.
5. `/_door/signout?then=<id>` clears both cookies and goes on by a fixed map: to the gate of the site `<id>` in
   `--signout-chain`, naming the site after it, or, for anything else (`door`, the last stop), to the door's
   `/signout/`. It never redirects to a URL from the query.
6. With a valid session the export is served as Amplify maps it, HTML and `.txt` as `private, no-store` and
   `/_next/static/**` as `private, max-age=31536000, immutable`.
7. Without one, a page load gets a fresh state cookie and a 302 to the door with `site`, `host`, `next` and `state`;
   anything else gets an empty 401.
8. An exception is an empty 500. The gate fails closed.

Every response carries `X-Robots-Tag: noindex, nofollow`, HSTS, `nosniff`, `X-Frame-Options: DENY` and a
`Cache-Control` with `no-store` or `private`. `next` is canonicalised by parsing it against the host, re-serialising
it as path and query, and refusing it if it leaves the origin or holds a backslash or control character
(`canonicalNext`, exported, so the door's ticket issuer can run the same steps).

The gate holds only public keys, takes all of its configuration as data and names no product. The ticket issuer, the
door and the site registry are the door's own.

## The library

The library entry exports `serve`, `createStaticServer`, `runLighthouse` and `pagesFromSitemap` for a script that
wants them in-process, and the gate's parts: `createGate`, `startGate`, `verifyTicket`, `parseJwks`,
`canonicalNext`, `parseGateConfig` and `bundleDoor`.

This is the one package in the repository with a build: a bin has to be JavaScript, because Node refuses to strip
types from a file under `node_modules`. `tsc` writes `dist/` on `prepack`, and the door bundle copies the gate's
compiled files from there.
