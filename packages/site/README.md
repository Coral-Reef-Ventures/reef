# @coralreefventures/site

The shell a Coral Reef public site is built in: the frame every page shares (skip link, header, main, footer), the
section and split layouts, the closing call to action, the screenshot frame, the status tag, the social-card builder,
the metadata helpers and the server-only test helper. Everything is a server component: nothing here is a client
module or imports one, so a page built on it can ship no script at all. Mantine is never imported; the shell reads
the theme's CSS variables (`--mantine-primary-color-*`, radii, font sizes) and the site's own tokens.

Driftline's `apps/site` began as a copy of Streamlane's, and the two drifted. What differs between the sites as a
product difference (name, URL, navigation, actions, footer lines, the brand's mark, the cards) is a `SiteConfig`
the product passes once; what differed by drift was settled here, one way, and is listed at the end.

## Using it

Bind the shell to the site's config in one module, and import from there:

```tsx
// lib/site.tsx
import { createSite } from "@coralreefventures/site";
import { Lockup } from "@/components/brand/Lockup";
import { socialMark } from "@/components/brand/social-mark";
import { brand } from "@streamlane/theme";

export const site = createSite({
  name: "Streamlane",
  url: "https://streamlane.app",
  description: "Docs, work, ideas, and delivery in one place. Delivery state comes from GitHub, never from a person.",
  nav: [
    { key: "product", label: "Product", href: "/product/" },
    { key: "docs", label: "Docs", href: "/docs/" },
    // ...
  ],
  lockup: <Lockup height={24} />,
  actions: [
    { label: "Sign in", href: "https://app.streamlane.app", kind: "link", hideBelow: "md" },
    { label: "Start free", href: "/pricing/", kind: "primary" },
  ],
  // Optional: something in the bar that is not a link, such as a color-scheme control.
  headerTools: <SchemeControl />,
  footer: {
    maker: <>Streamlane · made by <a href="https://coralreefventures.com/">Coral Reef Ventures</a> · source on <a href="...">GitHub</a></>,
    links: [{ label: "Docs", href: "/docs/" }, { label: "Changelog", href: "/changelog/" } /* ... */],
    trademarks: ["Jira", "Confluence", "Linear", "Notion", "GitLab", "Plane"],
  },
  cards: { "/": { headline: "...", sentence: "..." }, "/pricing/": { headline: "..." } },
  socialCard: { background: brand.ink, text: brand.white, muted: brand.paper, accent: brand.signal, mark: socialMark },
  icons: { icon: [{ url: "/brand/favicon-32.png", sizes: "32x32", type: "image/png" }] },
  themeColor: brand.ink,
});

export const { SiteFrame, pageMetadata } = site;
```

```tsx
// app/(site)/pricing/page.tsx
import { page, Section } from "@coralreefventures/site";
import { pageMetadata, SiteFrame } from "@/lib/site";

export const metadata = pageMetadata({ title: "Pricing", description: "...", path: "/pricing/" });

const PricingPage = () => (
  <SiteFrame active="pricing">
    <Section size="hero">
      <h1 className={page.title}>One plan.</h1>
    </Section>
  </SiteFrame>
);
```

`headerTools` (optional, since 0.3.0) is for something in the header that is not a link, such as a color-scheme
control. It renders in the actions group after the actions and before the folded menu's button, vertically centered in
the 64 px bar, at every width: never hidden below a breakpoint and never copied into the folded menu. The header stays a
server component; the element is the product's own, and may be one of its client components. Without it, the header's
markup is what it was before the field existed, and a test holds that.

`stickyHeader` (optional, since 0.7.0) keeps the header at the top of the screen as a page scrolls. On a phone the
bar is 56 px rather than 64; on a screen under 30em tall (a phone held sideways) the header scrolls away again; the
page's anchors and focused controls land below it (`scroll-padding-top` on the root), the folded menu scrolls inside
the screen, and the skip link sits above it.

`SubNav` (since 0.7.0) is a section's pages as one row of tabs under the bar, passed to the frame as `subnav`, so it
sits inside the header and sticks with it, and every page of the section is one click away:

```tsx
<SiteFrame active="product" subnav={<SubNav items={areaTabs} current="delivery" label="Product areas" />}>
```

The row never wraps. Where it is wider than the screen it scrolls sideways with no scrollbar drawn, the edge with more
tabs fades (a scroll timeline, so a row that fits never fades), and one inline line of script, run as the row is
parsed, scrolls the current tab into view. Keep the labels short, one word where it can be, so the row fits the
column on a laptop. `AreaPage`'s `nav` is optional for a site that puts its areas there.

`active` is typed to the config's nav keys. The root layout takes `site.rootMetadata()` and `site.rootViewport()`;
`app/robots.ts` returns `site.robots()`, `app/sitemap.ts` returns `site.sitemap()` (with the docs pages added, for a
site that has them); and `app/og/[...card]/route.tsx` keeps its two literals and takes the rest:

```ts
export const dynamic = "force-static";
export const dynamicParams = false;
export const { generateStaticParams, GET } = site.socialCardRoute();
```

Import `@coralreefventures/site/base.css` in the root layout before the site's own `globals.css`. It carries the
shared rules (body, inline links, focus ring, skip link) and the layout tokens; `globals.css` keeps the colors:
`--site-text`, `--site-muted`, `--site-border`, `--site-paper`, `--site-link-underline`, `--site-shadow`, and for
the status tag's attention tone `--site-attention-tint`, `--site-attention-edge`, `--site-attention-text`.

## Product areas

Since 0.6.0, the product page's areas, as both sites present them: `AreaCards`, the overview's cards, a link each with
its blurb and an optional `tag` (Streamlane's "Planned"), the current one filled; `AreaNav`, the row of pills at the
top of each area page; and `AreaPage`, the area page template: the row, the status, the headline and lead with the
first screen under them, a section per claim with its screen on alternating sides and grounds, what is not here yet,
and the closing band. The areas and the copy are data the site passes; the row and the closing band are elements.

```tsx
// components/product/AreaPage.tsx in a site
import { AreaNav, AreaPage, CtaBand } from "@coralreefventures/site";
import { areas, overview, type AreaCopy } from "@/lib/areas";

export const ProductArea = ({ area }: { area: AreaCopy }) => (
  <AreaPage
    area={area}
    nav={<AreaNav areas={[overview, ...areas]} current={area.key} />}
    status={(status) => <AreaStatus status={status} />}
    closing={<CtaBand title="..." text="..." actions={<>{/* the site's buttons */}</>} />}
  />
);
```

`status` draws a status in the site's own tones (by default the attention-toned `Status`), and `screen` draws a screen
from its caption and shape (by default the labelled `Screenshot`, 16 / 8 under the lead and loaded at once, 16 / 10
beside a section), for a site that has captures of its own. `AreaCopy` is generic in the site's statuses. The
headings and paragraphs are plain elements with the page type scale, where the sites' copies used Mantine's `Title`
and `Text`, so the page reads the same without Mantine's styles for them.

## Installing

Ships TypeScript and CSS modules as source, with `exports` pointing at `src/`, and no build step. Add it to Next's
`transpilePackages` beside the product's theme:

```ts
transpilePackages: ["@streamlane/theme", "@coralreefventures/site"],
```

`react`, `react-dom`, `next` and `@mantine/core` are peers at the versions both sites use. Nothing here imports
Mantine; the peer says which theme variables the stylesheets expect.

## The server-only rule

`@coralreefventures/site/testing` exports `clientReach(entry, { root })`, the walk both sites' `server-only.test.ts`
ran: every "use client" module and every import of a client package (`@mantine/*`, `next/link`, `next/image`,
`next/script`, `next/dynamic`) reachable from an entry. A product's test keeps asserting it is empty for the root
layout and the 404 page, and not empty for a page that uses Mantine. This package's own test runs it over every file
in `src/`.

## What was settled, where the two sites had drifted

- The status tag is plain by default with an `attention` tone (Driftline's), rather than always colored
  (Streamlane's). Streamlane's `InsightCount` renders as `<Status tone="attention">9 insights · 4 companies</Status>`.
- The header's primary action can leave the bar on phones (`hideBelow: "sm"`, which Driftline added for its long
  label); any hidden action is listed in the folded menu, so it stays reachable. Streamlane's "Start free" fits and
  stays.
- The closing call to action takes `tone="band"` for Driftline's tinted ground under a rule; Streamlane's is plain.
- The social card's headline wraps at 920 px, Driftline's later width; Streamlane's was 880.
- The footer's trademark list is set by `Intl.ListFormat`, as Driftline's was; Streamlane's hand-written list reads
  the same.
- The font cache for the social card is `.next/cache/coral-reef/fonts`, shared, since both set Noto Sans.
