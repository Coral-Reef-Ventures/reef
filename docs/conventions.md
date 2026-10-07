# Family conventions

The rules Markset (`markset-lang/markset`), Intentset (`intentset/intentset`) and reef (`Coral-Reef-Ventures/reef`)
follow, written once. Each repository worked most of these out on its own, and the copies drifted; this file is the
one statement. A repository's CLAUDE.md links here and records only where it departs, and why. Where a rule names a
repository, that is where it was learned; "Origin" says which file to read for the history.

The two product repositories are in separate GitHub organisations, so nothing here can be inherited from an org-level
`.github` repository. It is plain text, read by people and agents, and changed by a pull request to reef that says why.

Adopted 2026-10-05, from the Markset and Intentset consistency review of that day (Gary's answer to its first
question: the conventions live in reef).

## Commits and pull requests

- **A commit message is one plain sentence saying what changed and why.** Not a type prefix, not a list of files.
  The why is the part a later reader cannot reconstruct. Agents add their co-author trailer after a blank line.
  Origin: reef CLAUDE.md, Intentset CLAUDE.md ("as in Markset", though Markset's CLAUDE.md never wrote it down).
- **Spec, tests and implementation change in the same commit.** A rule's text, the cases that pin it and the code that
  meets it are one thought. In reef, a package change and the test that pins it. Origin: all three CLAUDE.md files.
- **Don't add a dependency without asking.** The approval is recorded (below) with its date. Origin: all three.
- **Agents working in parallel do not run `pnpm install` at the root they share**; whoever owns the root does. An agent
  in its own worktree installs there. Origin: Intentset CLAUDE.md.
- **A pull request opened by an agent Gary runs merges once it is green, without waiting for his review**, and a
  release is tagged when ready. Every other pull request, a fork's included, waits for a human: all three repositories
  are public, so green CI on an outside contributor's branch is not a review. Origin: Gary's standing instruction to
  the agents he runs, 2026-10-04.

## Releasing

Every published repository releases the same way, through `.github/workflows/release.yml` on a `v*` tag.

1. Bump the version in every manifest. A tooling test holds that every copy agrees (packages, root, spec status line,
   README status line, CHANGELOG heading, wherever the repository writes it).
2. Write the CHANGELOG entry (below). Merge.
3. Tag `v<version>` on `main` and push the tag. The workflow re-proves the whole gate rather than trusting that CI ran
   on that commit, checks the tag against the version, runs `smoke:packed` (pack every package, install into an empty
   pnpm project, use every entry point), and publishes.
4. Publishing walks the packages **in dependency order** and skips each version the registry already has, checked over
   plain HTTPS so a credential problem cannot read as "not published". Stopping at the first failure is right, because
   everything published then points only at versions that exist. A re-pushed tag or a re-run is therefore safe. A test
   holds that the list is complete and in dependency order.
5. After it publishes, `smoke:registry <version>` installs the release from npm and uses it. A packed-tarball check can
   install a sibling from the workspace rather than the registry, which is how tiptap 0.3.1 shipped broken.

Authentication is **npm trusted publishing over OIDC**: `pnpm publish --provenance`, `id-token: write`, and no secret
anywhere. The workflow configures **no credential**, deliberately: an `.npmrc` with an empty `_authToken` (which
`setup-node`'s `registry-url` writes) makes the client try it, get refused, and never reach the OIDC path. Each package
is set to require 2FA and disallow bypass tokens. `--provenance` is CI-only and fails locally with `provider: null`.
Origin: Markset CLAUDE.md (0.2.0, 0.3.0), reef CLAUDE.md "Publishing, and the trap".

### The first-publish trap

**A package npm has never seen cannot be published by CI.** Trusted publishing is configured per package on
npmjs.com, and a package that does not exist cannot have a publisher. So a new package needs, before the tag:

1. One publish by hand, in a terminal, with the passkey: `npm login --auth-type=web`, then
   `pnpm --filter <name> publish` (`--no-git-checks` if the tree is not clean).
2. Its trusted publisher configured on npmjs.com: Settings, Publishing access, GitHub Actions, this repository,
   `release.yml`, no environment; and require 2FA with no bypass tokens.
3. `smoke:registry` against what was just published.

Skip either step and the release stops with `ENEEDAUTH` at that package, and every package after it waits for a re-run.
Markset met this on 0.3.0 and three times on 0.3.1 (a package published by hand whose publisher was never configured
afterwards is the same trap) and Intentset on 0.2.0; reef published all of 0.1.0 by hand because of it. Before calling
a new package done, install it from the registry.

**Registry reads lag publication by minutes.** The workflow log printing `+ name@version` is the signal; `dist-tags`
naming the old version right afterwards is nothing. It has looked like a failure at least twice.

**A scope you do not own answers 404, not 403.** Markset's first attempt under `@markset` read as "package not found"
and meant "not yours".

## CHANGELOG

`CHANGELOG.md` at the root, newest first, one section per release. Origin: Markset's, back to 0.0.0-rc.1.

```md
## 0.4.1 — 2026-10-04

**One bold sentence on what changed for a user, then what did not.** Nothing in the grammar or the spec changed.

- **Each bullet opens with a bold sentence**, then the reason and what a consumer has to do, if anything.
```

- The heading is `## <version> — <date>` with an em dash. A tooling test requires a section for the current version.
- The lead says whether the spec, the conformance suite or a contract version (Intentset's export) moved. A change that
  makes an existing valid input invalid says **breaking** in its bullet and names the dated revision.
- When consumers must upgrade, the entry says so in those words.
- Release history goes here, not in CLAUDE.md's Status list. CLAUDE.md keeps open work.

## Decision records

One file per decision, `docs/decisions/NNNN-slug.md`, cited as "ADR NNNN" from specs, schemas and code. Origin:
Intentset's ADRs, plus Markset's "Rejected" paragraph, which Intentset's shape lacked. Markset's D1 to D14 stay in
`docs/decisions.md` because code cites "D14"; its decisions from D15 on use this shape.

```md
# ADR 0013: The decision, as a sentence

**Status:** accepted, 2026-10-05

## Context
What forced a decision, and what was true at the time.

## Decision
What was decided, one bullet per part, each with its reason.

## Rejected
Each alternative that was seriously considered, and why it lost.

## Consequences
What changed because of it: cases, files, versions, what a consumer meets.
```

A decision is never edited to reverse it. A new record supersedes it, and the old one's Status line says
"superseded by ADR NNNN".

## README

One order, so a reader who knows one repository finds the same thing in the next. Sections a repository has no use for
are left out, not reordered:

1. The pitch: the name, one paragraph on what it is and the problem it solves, and an example if one fits.
2. **Status**: the stage, the current version (in backticks, which a test reads), where it is published.
3. **Install** or **Try it**, with npm and pnpm side by side.
4. **Develop**: install, test, typecheck, lint, the site; `pnpm run <script>`, never `npm run`, and no `--` after it.
5. **Documentation**: the spec, the site, the agent guide.
6. **Layout**: a table of packages and what each is.
7. **Licence**: `MIT, Copyright (c) 2026 Coral Reef Ventures, LLC.`

Origin: Intentset's README (Status up front, Licence last) and Markset's (Layout table, Documentation). The sentence
that lists the published packages names every one of them, and a test counts it.

## CLAUDE.md

The file every agent session loads whole, so it holds what an agent needs before it touches anything, and no more.

- **Shape:** H1 and a paragraph on what the repository is; the source-of-truth line ("the spec wins, or changes first
  in the same commit"); Design invariants, opening "These are non-negotiable. If a proposed change conflicts with one,
  the change loses."; Working rules, with Approved dependencies; Conventions; Layout; Toolchain; Status. Origin: the
  skeleton both product repositories already share, and reef's invariants preface.
- **Cap: 300 lines**, everything in the file counted, including a block a tool injects, because every session pays for
  every line. Intentset is at 294 with the AWS Agent Toolkit block; Markset is at 513 and trims to it.
- **Status is open work, not a done-log.** A finished item leaves once its lesson has a home: the CHANGELOG for what
  shipped, an ADR for why, a rule in Toolchain or here for what to do next time. A lesson buried in a done item is
  lost; Markset's first-publish trap was its first Status bullet.
- **Links here** in Working rules: "Family conventions: reef's `docs/conventions.md`. Departures:" and then only the
  departures, each with its reason.
- **Layout lists every top-level file and folder**, including `docs/` contents. Both product repositories omitted some.

### Approved dependencies

A list under Working rules, one line per dependency, in this shape:

```md
- `@playwright/test` (dev, root), 2026-09-28: the editor's browser tests in Chromium, Firefox and WebKit.
```

Name, where it is declared, the date it was approved, what it is for. A dependency used only by one script says so,
so nobody imports it elsewhere. Origin: Intentset lists approvals in Working rules, Markset inline in Toolchain with
dates, reef pins exactly and allowlists licences (MIT, Apache-2.0, BSD, ISC).

## Tooling tests every published repository carries

`test/tooling.test.ts` holds the repository's shape, so a rule here is checked rather than remembered. A published
repository carries each of these, adjusted for its scope:

- Every copy of the version agrees with the root manifest, and the CHANGELOG has a section for it.
- Every published package is public (`publishConfig.access`), carries the root's `homepage` and repository, and its
  manifest is already in the form npm would rewrite it into.
- Every package asks for its siblings at the version being released; an exact pin where one is declared (Intentset
  pins `@markset-lang/*` exactly).
- The release script or workflow names every published package and nothing else, each after everything it depends on;
  the build compiles in the same order.
- The release workflow proves the build before it publishes, and can be run a second time without failing.
- Every dependency in the lockfile resolves to the public registry.
- Every published package has a README whose H1 is its name; the root README names every published package.
- The development workflow asks for the repository's source export condition (`markset-source`, `intentset-source`)
  in every script that runs node, and `tsc` by `customConditions`.
- A conformance-suite package depends on nothing.
- The Biome config is `biome.jsonc`, not `biome.json` (a `//` comment in a `.json` silently drops the members after
  it), and a test parses it and asserts the settings survived.
- `tsconfig.json`'s `include` covers the root `test/`, so the tests are typechecked.
- Anything that imports `@markset-lang/parser` runs its tests, conformance and smoke test under both export conditions,
  production and `development` (micromark's asserting build, which Vite, Vitest and Next resolve by default). Markset
  0.3.3 passed every test under production and threw on any link under development.

Origin: Markset's `test/tooling.test.ts` (19 tests), Intentset's (8), reef's; the two lists were compared on 2026-10-05.

## Sites

markset.org and intentset.org are Markset documents rendered by `@markset-lang/render-html`, from one `site/build.ts`
each. coralreefventures.com is the company site. The three are read side by side as one family.

### Baseline

Every page of a family site has, and a test holds:

- A skip link (`<a class="site-skip" href="#main">Skip to content</a>`) as the first focusable element, and
  `<main id="main" tabindex="-1">` for it to land on.
- A visible focus ring: `:focus-visible { outline: 3px solid var(--site-focus); outline-offset: 3px; }`, with
  `main:focus { outline: none; }`.
- Metadata: `<meta name="description">` from the page's first paragraph, `<link rel="canonical">`, `og:type`,
  `og:site_name`, `og:title`, `og:description`, `og:url`, and `twitter:card` set to `summary`.
- `sitemap.xml` and `robots.txt` generated from the page list, and a `404.html` in the site's own shell, so GitHub's
  bare 404 is never served. With a sitemap, reef's `reef-lighthouse` and `reef-serve` work on the site unchanged.
- A `{{version}}` token substituted from `package.json`, with a test, wherever a page names the version. Hand-written
  versions go stale: Intentset's hero said 0.4 while its package was 0.6.0.
- Playwright checks at **390px and 1440px**: nothing scrolls sideways, nothing is clipped, every link at least 24px
  tall, primary calls to action at least 44px, the skip link and focus ring work from the keyboard, and the navigation
  wraps below the brand at phone width. Each check opens a Playwright page with a viewport of that width
  (`newPage({ viewport: { width, height: 900 } })`), as Intentset's test does; no iframe is needed.
- The color-scheme control (three radios read by `body:has()`, `data-scheme` on `<body>`), whose one script sits
  outside `<main>`; nothing inside `<main>` has a script.

Origin: Intentset's shell and `site/test/browser.test.ts` for the first three and the Playwright checks; the consistency
review for sitemap, robots, 404 and `{{version}}`, which neither site had.

### Footer

Every product site's footer is, in this order:

1. **A link row**, `<nav class="site-footer-nav" aria-label="Footer">`: the site's menu links, then the one "about"
   page the menu does not carry (Markset's Why Markset, Intentset's About). The row is styled as Intentset's
   `.site-footer-nav`.
2. **One line, one `<p>`**:

   ```
   <strong>Name</strong> · one-sentence statement · Source on GitHub · A Coral Reef Ventures project · Sibling project: <sibling>
   ```

The statement is one sentence saying what the product is: Markset's "A strict superset of CommonMark with a closed
layout vocabulary.", Intentset's "Keep control of what your agents build." The link texts are exactly "Source on
GitHub" (the repository) and "A Coral Reef Ventures project" (`https://coralreefventures.com/`), the family line on
every site. Each product site links its sibling once, on the same line: markset.org to intentset.org and back.
Nothing in the format's own pages names the sibling; Markset stays a neutral format. The footer's family figure
(`.site-family`) stays as it is. Origin: Gary's decision of 2026-10-06.

### Status labels and voice

- **Copy can be written and changed without approval** (Gary, 2026-10-06): no copy log, no proposed status for
  wording, no test that asks for an entry. It never invents a fact: no domain, link, contact address, price, legal or
  privacy claim, or claim that is not true today. A decision that is itself proposed, such as a price, stays marked
  proposed.
- **Status labels are coralreefventures.com's**, used on each home page: Markset `Open source · v0`, Intentset
  `Open source · Early release`, Streamlane `Product · In development`, Driftline `Product · In planning`. The precise
  version goes in a badge or `{{version}}`, not in the label.
  The source is `apps/web/lib/product-facts.ts` in coral-reef-site.
- **Headlines end with a period**: "Keep control of what your agents build." The tab-title code strips it. Home-page
  taglines match the CRV cards word for word.
- **The guide an agent reads is "the agent guide"**, printed by `<tool> guide`.
- Dates are written `2026-10-05`.

### Color

- **Type is shared, neutrals are not.** The system sans and one type scale on all three; no font from another origin.
- **Each site's neutral tint is deliberate**: coralreefventures.com warm cream (`#fbf5ed`, dark `#141a19`), intentset.org
  green-tinted (`#f7f8f1`, dark `#121917`), markset.org cool white (`#fff`, dark `#15181c`). Markset's chart palette was
  validated against its own surfaces, so moving them means validating it again. Do not "fix" the difference.
- **Accents are CRV's tokens**: Markset violet `#664d93`; Intentset's accent text `#2c6a54`
  (`--crv-intentset-text`). A product's color is a small accent on the family's type, not a theme of its own.

Origin: Gary's answer of 2026-10-05 to the consistency review's third question.

## Differences to keep

These look like drift and are not. Leave them.

- **Diagnostic codes**: Markset's are `AREA_NAME` (`DIRECTIVE_UNCLOSED`), Intentset's `AREA###` (`CORE003`). The
  shapes keep the origin visible and cannot collide when a host merges the two lists. A host never renames the other's.
- **The agent guide**: Markset's is one static file, the same everywhere; Intentset's is generated per repository,
  because it embeds that repository's scope.
- **The CLI model**: Markset works on files (`check <file...>`, `-` for stdin), Intentset on a repository (`--root`).
- **Pins**: Intentset pins `@markset-lang/*` exactly, since two parsers for one document is the risk; Markset's own
  siblings ask for each other at a caret range. A Markset release considers Intentset, its one known consumer.
- **Version declarations**: `markset: 0` is an integer, major only; `intentset.spec: "0.1"` is a string for drafts.
- **Source conditions** are per project, so one repository's scripts never opt the other's packages into source.
- **The playground and the visual editor** are Markset's alone: Markset is a format someone types into.
- **Diagrams and charts** are drawn on markset.org; intentset.org has none and turns drawing off.

## Changing this file

A pull request to reef that says why, like any other. When a rule here changes, the repositories that follow it change
in their own pull requests, linked from the reef one. A rule that only one repository follows is that repository's
departure, and belongs in its CLAUDE.md instead.
