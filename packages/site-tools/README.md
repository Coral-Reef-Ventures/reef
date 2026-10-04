# @coralreefventures/site-tools

Two command-line tools for a Coral Reef public site, which is a Next.js static export served by Amplify Hosting.
Both sites carried them as `scripts/serve.ts` and `scripts/lighthouse.ts`; they are bins now, and the products' scripts
go.

```sh
reef-serve [--root out] [--port 3140]
reef-lighthouse [--root out] [--reports lighthouse] [--port 3160] [--threshold 90] [--chrome <path>] [path ...]
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

The library entry exports `serve`, `createStaticServer`, `runLighthouse` and `pagesFromSitemap` for a script that
wants them in-process.

This is the one package in the repository with a build: a bin has to be JavaScript, because Node refuses to strip
types from a file under `node_modules`. `tsc` writes `dist/` on `prepack`.
