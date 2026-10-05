# reef

Shared packages for the Coral Reef family of products, Streamlane and Driftline. The products stay in their own
repositories; what both of them use lives here and is published to npm under the `@coralreefventures` scope.
It also holds the conventions Markset and Intentset follow, in [`docs/conventions.md`](docs/conventions.md).

Driftline's public site was created by copying Streamlane's, and a clone detector then found 87 cross-repository
clones, 2,191 lines, between the two. The packages hold what that measurement pointed at. Brand assets (marks,
wordmarks, colors) are each product's own and are not here. Product code is not here either.

## Status

Released, at `0.4.0`, and used by both product sites. Four packages are published under the `@coralreefventures`
scope: `site`, `site-tools`, `theme` and `contact`. Every one is public and MIT, released together at one version.

## Develop

Node 24 and pnpm (the version is pinned in `package.json`; `corepack enable` provides it). No build step in
development: sources are TypeScript, and three of the four packages ship them as they are. `site-tools` alone is
compiled, on `prepack`, because a bin has to be JavaScript.

```sh
pnpm install
pnpm test               # every package's tests, and the repository's own
pnpm run typecheck
pnpm run lint           # Biome: formatting and lint rules; pnpm run format applies them
pnpm run smoke:packed   # pack every package and install them into an empty project, as a consumer would
pnpm run e2e            # the door gate in Chromium, Firefox and WebKit (once: pnpm exec playwright install chromium firefox webkit)
```

Every dependency is pinned exactly and is MIT, Apache-2.0, BSD or ISC.

## Documentation

- [`CLAUDE.md`](CLAUDE.md): the invariants, the layout, how a release and a first publish work, and how a product
  consumes each package.
- [`docs/conventions.md`](docs/conventions.md): the family's rules for commits, releases, changelogs, decision records,
  READMEs, CLAUDE.md files and sites.
- Each package's README, which is its page on npm.

## Layout

| Package | What |
| --- | --- |
| [`@coralreefventures/site`](packages/site) | The shell both public sites share: frame, header, footer, sections, call to action, screenshot frame, status tag, social-card builder, metadata helpers, the server-only test helper, parametrized by one `SiteConfig` |
| [`@coralreefventures/site-tools`](packages/site-tools) | `reef-serve`, which serves a static export the way Amplify Hosting does; `reef-lighthouse`, the Lighthouse 90+ gate; and `reef-door-bundle`, which locks an export behind the door with a gate that serves every byte |
| [`@coralreefventures/theme`](packages/theme) | The Mantine theme builder and the CSS-variables generator, taking a product's brand tokens |
| [`@coralreefventures/contact`](packages/contact) | The contact-form Lambda handler, parametrized by the form's fields and what to do with a message |

[`tools/sites/`](tools/sites) is family tooling rather than a package: `sites` (or `pnpm sites` here) starts every
site on the family's port map, 3000 to 3006, under one [dekit](https://github.com/pvolok/dekit) runner, and opens one
terminal UI where each site's output shows and each can be stopped, killed and restarted. Its README has the map, the
keys and why dekit. It publishes nothing and adds no dependency (`brew install mprocs` provides dekit).

## Licence

MIT, Copyright (c) 2026 Coral Reef Ventures, LLC.
