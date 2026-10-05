# reef

Shared packages for the Coral Reef family of products, Streamlane and Driftline. The products stay in their own
repositories; what both of them use lives here and is published to npm under the `@coralreefventures` scope.
It also holds the conventions Markset and Intentset follow, in [`docs/conventions.md`](docs/conventions.md).

Driftline's public site was created by copying Streamlane's, and a clone detector then found 87 cross-repository
clones, 2,191 lines, between the two. The first version holds the four things the measurement pointed at:

| Package | What |
| --- | --- |
| [`@coralreefventures/site`](packages/site) | The shell both public sites share: frame, header, footer, sections, call to action, screenshot frame, status tag, social-card builder, metadata helpers, the server-only test helper, parametrized by one `SiteConfig` |
| [`@coralreefventures/site-tools`](packages/site-tools) | `reef-serve`, which serves a static export the way Amplify Hosting does; `reef-lighthouse`, the Lighthouse 90+ gate; and `reef-door-bundle`, which locks an export behind the door with a gate that serves every byte |
| [`@coralreefventures/theme`](packages/theme) | The Mantine theme builder and the CSS-variables generator, taking a product's brand tokens |
| [`@coralreefventures/contact`](packages/contact) | The contact-form Lambda handler, parametrized by the form's fields and what to do with a message |

Brand assets (marks, wordmarks, colors) are each product's own and are not here. Product code is not here either.

## Working on it

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

Every dependency is pinned exactly and is MIT, Apache-2.0, BSD or ISC. `CLAUDE.md` holds the invariants, the layout,
and how a release and a first publish work.

## Licence

MIT, Copyright (c) 2026 Coral Reef Ventures, LLC.
