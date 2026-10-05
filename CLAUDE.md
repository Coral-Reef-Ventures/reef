# reef

Shared packages for the Coral Reef family: Streamlane (`coral-reef-ventures/streamlane`) and Driftline
(`Coral-Reef-Ventures/driftline`). The two products stay in their own repositories; what both use lives here and is
published to npm under the `@coralreefventures` scope, public, MIT, copyright Coral Reef Ventures, LLC. The scope is
`@coralreefventures` because `@coral-reef` was taken and the company's domain is coralreefventures.com. It also holds
the conventions Markset and Intentset follow, in `docs/conventions.md`: the family's rules for commits, releases,
changelogs, decision records, READMEs, CLAUDE.md files and sites, written once. Invariant 4 governs packages, not
documents, so the conventions need no second consumer to live here.

The reason it exists: Driftline's `apps/site` was created by copying Streamlane's, and jscpd then measured 87
cross-repository clones, 2,191 lines, between the two sites (10 files byte-identical, about 40 near-identical). The
four packages of 0.1.0 are the ones that measurement pointed at. Once both sites consume them, 38 of those 87 clones
(983 lines) go; the rest are the products' own pages, pricing meters and forms, which are product copy, not shared
code.

## Invariants

These are non-negotiable. If a proposed change conflicts with one, the change loses.

1. **Shared code is MIT.** The products carry a family source licence; nothing here does. A file that belongs under
   that licence belongs in a product repository.
2. **Nothing product-specific.** No brand asset (mark, wordmark, color), no copy, no price, no product name in anything
   that ships. A test holds that no `@streamlane/` or `@driftline/` reference appears in a package's manifest or
   source. Test fixtures may name a product, since they exist to prove a product's output is reproduced.
3. **Nothing imports a product.** A package here has no dependency on a product's package, and a product configures a
   package by passing data (a `SiteConfig`, a tokens file, a field table), never by being imported.
4. **A package exists only when both products use it, or will within a release.** One product's convenience is that
   product's code. The clone report is the evidence a package needs.
5. **Every dependency is MIT, Apache-2.0, BSD or ISC, and pinned exactly.** Lighthouse is run through `pnpm dlx`
   rather than depended on because it bundles axe-core (MPL-2.0). A test holds the pins.
6. **The public site shell ships no client component.** Nothing in `packages/site` is a "use client" module or imports
   one (`@mantine/*`, `next/link`, `next/image`, `next/script`, `next/dynamic`); its own test walks every file, and
   it exports the walk for the products' tests. Mantine is a peer for its CSS variables and is never imported.

## Layout

```
packages/
  site/        the shell both public sites share, as server components: SiteFrame, SiteHeader, SiteFooter, Section,
               Split, CtaBand, Screenshot, Status, the page type scale (Page.module.css, exported as `page`), the
               social-card builder, pageMetadata/rootMetadata/robots/sitemap, and createSite(config), which binds
               them to one SiteConfig. `/testing` is clientReach, the server-only walk. `/base.css` is the shared
               global rules and layout tokens; a site's globals.css keeps the colors. Ships .tsx and .module.css as
               source: consumers add it to Next's transpilePackages.
  site-tools/  reef-serve, reef-lighthouse and reef-door-bundle, bins. The one package with a build (tsc on prepack),
               because Node refuses to strip types from a file under node_modules, and a bin is run by Node.
               src/door/ is the gate that locks a site behind coralreefventures.com's door (0.2.0): verify.ts (ES256
               JWS against a JWKS), next.ts (canonicalNext), config.ts (gate.config.json), server.ts (the gate's
               request order) and package.ts (bundleDoor, which writes .amplify-hosting with one route, /* to
               Compute). The gate imports Node's modules and its own files only, because the compute bundle carries
               no node_modules: bundleDoor copies those compiled files (gateFiles, held against the imports by a
               test) beside a server.mjs entry. e2e/ runs it in three browsers (below).
  theme/       createBrandTheme(tokens, config) and themeCss(theme, { generatedBy, resolver }). A product's
               packages/theme is its tokens file plus a call. test/fixtures/ holds both products' tokens files and
               committed theme.css, copied 2026-10-04 and named by origin, and the test regenerates each byte for
               byte. Streamlane's cssVariablesResolver is there as a fixture too: it is product code, and the
               builder takes a resolver as an option rather than defining one.
  contact/     createContactHandler(config): the form Lambda, parametrized by its fields, the required ones, the
               honeypot and `deliver`. Both sites' stubs log the message; a product that wires it somewhere passes a
               deliver function. (The brief guessed recipient, subject and origin as the parameters; the two
               handlers differed only in their field tables, and CORS lives on the function URL in each product's
               backend.ts, so those are not here.)
docs/
  conventions.md    the conventions Markset, Intentset and reef follow (2026-10-05); under 300 lines, a test holds it
test/
  tooling.test.ts   the repository's shape: scope, version, pins, licence, release order, no product scope in src
  consumer/         smoke.ts packs every package and installs them into an empty pnpm project; consumer-entry.tsx is
                    bundled there with esbuild (as a consumer's Next, tsx or Vitest would transpile the source) and
                    consumer.mjs checks every package and runs both bins
.github/workflows/  ci.yml (lint, typecheck, test, smoke on pull requests and main) and release.yml (on a v* tag)
```

## Toolchain

- Node 24 (`.nvmrc`), pnpm workspaces with `packageManager` pinned in `package.json` and `linkWorkspacePackages: true`
  in `pnpm-workspace.yaml`. `pnpm install`, then `pnpm test` (Vitest, one config at the root for every package),
  `pnpm run typecheck` (one `tsconfig.json` over every `src/` and `test/`), `pnpm run lint` and `pnpm run format`
  (Biome). `minimumReleaseAge: 3` as the products have it; the smoke test lifts it for what it has just packed.
- `biome.jsonc`, deliberately not `biome.json`: a `//` comment in a `biome.json` silently drops the members that follow
  it in that object. A test parses the config and asserts the rules survived. Biome 2.5 uses `preset: "recommended"`;
  the products' 2.4 configs say `recommended: true`, which 2.5 deprecates.
- `tsconfig.base.json` is the products' compiler settings, word for word, with `jsx: react-jsx` added. This matters
  more than usual: three packages ship TypeScript source, and a consumer's `tsc` type-checks that source with the
  consumer's settings (`skipLibCheck` skips only `.d.ts`), so the source has to be clean under `exactOptionalPropertyTypes`
  and `noUncheckedIndexedAccess`. Imports in those packages are extensionless, because a consumer without
  `allowImportingTsExtensions` would refuse `./x.ts`; `site-tools` uses `.ts` specifiers, which its build rewrites.
- **No build step in development.** `site-tools` compiles to `dist/` on `prepack`, so `pnpm pack` and `pnpm publish`
  build it, and nothing else does. Its tests import `src/`.
- Dependencies, all exact: `@biomejs/biome` 2.5.15, `typescript` 5.9.3, `vitest` 4.1.11, `@types/node` 24.19.0 and
  `esbuild` 0.28.2 at the root (esbuild only for the smoke test's bundle); `react`, `react-dom`, `@types/react*` 19.3.0,
  `next` 16.3.6 and `@mantine/core`/`hooks` 9.6.3 as the packages' dev and peer dependencies, the versions both sites
  use; `@types/aws-lambda` 8.10.163 as `contact`'s one dependency, since its signature is typed with it.
  `@playwright/test` 1.63.0 is an optional peer of `site-tools`, resolved at run time for Chromium's path, and since
  0.2.0 a root dev dependency too, for the door gate's browser suite (Apache-2.0; the door plan names it).
- `pnpm run e2e` (once: `pnpm exec playwright install chromium firefox webkit`) runs `packages/site-tools/e2e/` in
  Chromium, Firefox and WebKit. Global setup builds site-tools, runs the real `reef-door-bundle` twice into a
  temporary directory (fetching the JWKS over https from a stand-in door, trusted through `NODE_EXTRA_CA_CERTS`),
  starts each bundle's `server.mjs` there with no node_modules above it, and puts TLS in front of each, as Amplify's
  CDN does. The two gates are `localhost` and `127.0.0.1` and the door is `127.0.0.1` on another port: the two names
  are different sites to a browser, so the door's POST is cross-site, and cookies ignore ports, so two gates need two
  names. The certificate is made with `openssl` per run. Firefox reports an empty response to a navigation as a
  network error, so a test of an empty 400 or 403 asserts the status through `page.request` and only that a
  navigation went nowhere else. Global setup must not block its event loop while the bin runs (`execFile`, not
  `execFileSync`): the door answering the bin's JWKS fetch is in the same process.
- Vitest's `css.modules.classNameStrategy: "non-scoped"` keeps a CSS module's class names as written, so a rendering
  test reads `class="section"` off the markup. React 19 puts a `<link rel="preload">` before an eager, high-priority
  `<img>`; a test that pins the Screenshot's markup expects it.
- The release publishes with `pnpm publish --provenance` over npm trusted publishing: no secret anywhere. The job asks
  for `id-token: write` and configures no credential, because an `.npmrc` with an empty `_authToken` makes the npm
  client try it, get refused, and never reach the OIDC path. It walks the packages in the `release` script's order,
  skipping each version the registry already has (checked over plain HTTPS, so a credential problem cannot read as
  "not published"), and a test holds that the order is dependency order and complete. No package depends on a sibling
  yet; the first one that does must come after it in that list.

## Publishing, and the trap

The family's release procedure and the trap are in `docs/conventions.md`; this section is reef's own values.

**A package npm has never seen cannot be published by CI.** Trusted publishing is configured per package on
npmjs.com, a package that does not exist cannot have a publisher configured, and the first publish of a new package
therefore has to be done by hand, in a terminal, with the passkey: `pnpm --filter @coralreefventures/<name> publish`
(`--no-git-checks` if the tree is not clean; `--provenance` is CI-only and fails locally). Then configure the trusted
publisher for that package on npmjs.com: repository `Coral-Reef-Ventures/reef`, workflow `release.yml`, no
environment. Only after both steps does a `v*` tag release it with the rest. Markset met this three times, on every
new package, because the release step stops at the first `ENEEDAUTH` and the packages after it wait for a re-run.
Stopping at the first failure is the right design as long as the list is in dependency order: everything published
points only at versions that exist.

For 0.1.0 none of the four exists on npm, so the whole first release is by hand, in this order:

1. Create the npm organization `coralreefventures` (npmjs.com, Add Organization, free), and `npm login --auth-type=web`.
2. `pnpm install && pnpm test && pnpm run smoke:packed` on the tagged commit.
3. `pnpm --filter @coralreefventures/theme publish`, then `contact`, `site-tools`, `site` (the `release` script's order).
4. On npmjs.com, for each of the four: Settings, Publishing access, add a trusted publisher (GitHub Actions,
   `Coral-Reef-Ventures/reef`, `release.yml`), and require 2FA with no bypass tokens.
5. `pnpm run smoke:registry 0.1.0`, which installs the release from the registry and uses it.
6. From then on: bump the version in every manifest (a test holds that they agree), tag `v<version>`, push the tag.

Registry reads lag publication by minutes: the workflow log printing `+ name@version` is the signal, and
`dist-tags` saying the old version right after is nothing.

## Consuming a package from a product

- `site`: `transpilePackages: [..., "@coralreefventures/site"]` in `next.config.ts`; one `lib/site.tsx` that calls
  `createSite(config)` and exports what the pages import; `import "@coralreefventures/site/base.css"` in the root
  layout before `globals.css`, which keeps the color tokens (`--site-text`, `--site-muted`, `--site-border`,
  `--site-paper`, `--site-link-underline`, `--site-shadow`, `--site-attention-{tint,edge,text}`). `app/og/[...card]/
  route.tsx` keeps `dynamic` and `dynamicParams` as literals (Next reads them statically) and takes
  `generateStaticParams` and `GET` from `site.socialCardRoute()`.
- `site-tools`: `"serve": "reef-serve"`, `"lighthouse": "reef-lighthouse"`; Playwright's `webServer.command` becomes
  `pnpm exec reef-serve --port N`.
- `theme`: `transpilePackages` where the product theme already is; `theme.ts` becomes tokens plus `createBrandTheme`,
  `generate-css.ts` becomes `writeThemeCss(file, themeCss(theme, { generatedBy, resolver }))`. The committed
  `theme.css` does not change.
- `contact`: `handler.ts` becomes `export const handler = createContactHandler({ fields, required, email })`.
- A product whose `pnpm-workspace.yaml` sets `minimumReleaseAge` (both do, 3 days) cannot install a release made
  today without `minimumReleaseAgeExclude: ["@coralreefventures/*"]`; the packages are the family's own, so the
  exclusion is right, not a workaround.

## Working rules

Family conventions: `docs/conventions.md`, which this repository follows. Departures: no CHANGELOG or decision records
yet, so release history is the Status list below until the first of either; no site, so the site rules do not apply.

- Commit messages are one plain sentence saying what changed and why.
- A change to a package and the test that pins it land in the same commit. When a shared component changes in a way a
  site would see, both sites are the ones to check; `packages/site/README.md` lists what was settled where they had
  drifted.
- Don't add dependencies without asking, and never one outside the licence allowlist.

## Status

- [x] 0.1.0 built, 2026-10-04: the four packages, their tests (the theme fixture test proves both products' theme.css
      byte for byte; the site package renders every component through react-dom/server and walks its own source
      for client components), the smoke test, CI and release workflows. **Not published**: the npm organization does
      not exist yet, and the first publish is by hand (above).
- [x] First publish by hand, 2026-10-04: all four at 0.1.0, trusted publishers configured, `smoke:registry 0.1.0` passed.
      Both sites consume them (Streamlane #319, Driftline #2): 21 files and about 1,400 lines gone from each, theme.css
      unchanged by a byte, pages pixel-identical but for one Status pill and one folded-menu entry.
- [x] 0.1.1, 2026-10-04: the contact handler infers its fields from `fields` alone (Driftline met the inference bug),
      `reef-lighthouse` serves on a free port unless `--port` pins one (Streamlane met EADDRINUSE on 3160), and the
      release-age note for consumers. The first release through `release.yml` and trusted publishing.
- [ ] 0.2.0, the door gate in `site-tools` (`reef-door-bundle`, `src/door/`), 2026-10-04: unit tests for every
      step of the gate's request order, the bundle's shape and the canonical-next cases; the browser suite in three
      browsers; the smoke test runs the packed bin and starts the bundle it writes away from any node_modules. Released
      from CI on the `v0.2.0` tag after merge: `site-tools` already has its trusted publisher, so no hand publish.
- [ ] Streamlane and Driftline consume the four packages; their copies go.
- [ ] Candidates the report also pointed at and this version leaves in the products: the Playwright specs
      (`pages.spec.ts`, `mobile.spec.ts`), `playwright.config.ts`, `PricingMeter` and the two forms. The meter and the
      forms are product UI with product copy; the specs would need the site's page list as data.
