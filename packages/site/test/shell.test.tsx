import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { createSite } from "../src/create-site";
import { CtaBand } from "../src/page/CtaBand";
import { Status } from "../src/Status";
import { Section, Split } from "../src/shell/Section";
import { SiteFooter } from "../src/shell/SiteFooter";
import { SiteHeader } from "../src/shell/SiteHeader";
import { driftlineLike, streamlaneLike } from "./fixtures";

const render = renderToStaticMarkup;

describe("SiteHeader", () => {
  it("shows the lockup as the way home, the sections, and marks the current one", () => {
    const html = render(<SiteHeader site={streamlaneLike} active="pricing" />);
    expect(html).toContain('<a href="/" class="home"><span role="img" aria-label="Streamlane">Streamlane</span></a>');
    expect(html).toContain('<a href="/product/" class="link">Product</a>');
    expect(html).toContain('<a href="/pricing/" class="link" aria-current="page">Pricing</a>');
    expect(html).not.toContain('aria-current="page">Product');
  });

  it("draws a primary action as the filled button and a link action as a link, each hidden where asked", () => {
    const html = render(<SiteHeader site={streamlaneLike} />);
    expect(html).toContain('<a href="https://app.streamlane.app" class="link" data-hide-below="md">Sign in</a>');
    expect(html).toContain('<a href="/pricing/" class="primary">Start free</a>');
    const driftline = render(<SiteHeader site={driftlineLike} />);
    expect(driftline).toContain(
      '<a href="/early-access/" class="primary" data-hide-below="sm">Request early access</a>',
    );
    expect(driftline).not.toContain("Sign in");
  });

  it("folds the sections into a details menu that also lists every action the bar hides", () => {
    const html = render(<SiteHeader site={streamlaneLike} />);
    const menu = html.slice(html.indexOf("<details"));
    expect(menu).toContain('<summary class="menuButton" aria-label="Menu">');
    expect(menu).toContain('<nav aria-label="Main" class="menuPanel">');
    expect(menu).toContain(">Pricing</a>");
    expect(menu).toContain('<a href="https://app.streamlane.app" class="link">Sign in</a>');
    // Start free stays in the bar at every width, so the menu does not repeat it.
    expect(menu).not.toContain("Start free");
    const driftline = render(<SiteHeader site={driftlineLike} />);
    expect(driftline.slice(driftline.indexOf("<details"))).toContain(">Request early access</a>");
  });

  it("puts the header tools after the actions and before the menu button, in the bar and never in the menu", () => {
    const tools = (
      <fieldset className="scheme">
        <legend>Color scheme</legend>
      </fieldset>
    );
    const html = render(<SiteHeader site={{ ...streamlaneLike, headerTools: tools }} />);
    const slot = '<div class="tools"><fieldset class="scheme"><legend>Color scheme</legend></fieldset></div>';
    expect(html).toContain(slot);
    const actions = html.slice(html.indexOf('<div class="actions">'));
    expect(actions.indexOf(">Start free</a>")).toBeLessThan(actions.indexOf(slot));
    expect(actions.indexOf(slot)).toBeLessThan(actions.indexOf("<details"));
    expect(html.slice(html.indexOf("<details"))).not.toContain("Color scheme");
    expect(html.match(/Color scheme/g)).toHaveLength(1);
  });

  it("renders exactly as before when a site has no header tools", () => {
    // The markup 0.2.0 rendered for this fixture, before the slot existed.
    const before =
      '<header class="header"><div class="inner"><a href="/" class="home"><span role="img" aria-label="Driftline">Driftline</span></a><nav aria-label="Main" class="nav"><a href="/product/" class="link">Product</a><a href="/pricing/" class="link">Pricing</a></nav><div class="actions"><a href="/early-access/" class="primary" data-hide-below="sm">Request early access</a><details class="menu"><summary class="menuButton" aria-label="Menu"><svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true"><path d="M3 5h14M3 10h14M3 15h14" stroke="currentColor" stroke-width="2" stroke-linecap="round"></path></svg></summary><nav aria-label="Main" class="menuPanel"><a href="/product/" class="link">Product</a><a href="/pricing/" class="link">Pricing</a><a href="/early-access/" class="link">Request early access</a></nav></details></div></div></header>';
    expect(render(<SiteHeader site={driftlineLike} />)).toBe(before);
    expect(render(<SiteHeader site={{ ...driftlineLike, headerTools: null }} />)).toBe(before);
  });
});

describe("SiteFooter", () => {
  it("carries the maker line, the links, the no-trackers line and the trademark disclaimer", () => {
    const html = render(<SiteFooter site={streamlaneLike} />);
    expect(html).toContain('made by <a href="https://coralreefventures.com/">Coral Reef Ventures</a>');
    expect(html).toContain('<a href="/docs/">Docs</a> · ');
    expect(html).toContain('<a href="/contact/">Contact</a> · ');
    expect(html).toContain(
      "No trackers · Jira, Confluence, Linear, Notion, GitLab, and Plane are trademarks of their owners;",
    );
    expect(html).toContain("Streamlane is not affiliated with them");
  });

  it("names each product in its own disclaimer, and leaves the disclaimer out when nothing is named", () => {
    const html = render(<SiteFooter site={driftlineLike} />);
    expect(html).toContain("PostHog and Amplitude are trademarks of their owners; Driftline is not affiliated");
    const bare = render(
      <SiteFooter site={{ ...driftlineLike, footer: { ...driftlineLike.footer, trademarks: [] } }} />,
    );
    expect(bare).toContain("No trackers</p>");
    expect(bare).not.toContain("trademarks");
  });
});

describe("createSite", () => {
  const site = createSite(streamlaneLike);

  it("binds the frame to the config: skip link, header, main, footer", () => {
    const html = render(<site.SiteFrame active="docs">Body</site.SiteFrame>);
    expect(html.startsWith('<a href="#main" class="skip-link">Skip to content</a><header')).toBe(true);
    expect(html).toContain('<a href="/docs/" class="link" aria-current="page">Docs</a>');
    expect(html).toContain('<main id="main">Body</main>');
    expect(html).toMatch(/<footer class="footer">.*Streamlane is not affiliated with them.*<\/footer>$/);
  });

  it("binds the header and footer on their own too", () => {
    expect(render(<site.SiteHeader active="product" />)).toContain('aria-current="page">Product');
    expect(render(<site.SiteFooter />)).toContain("No trackers");
  });

  it("types the active section to the config's keys", () => {
    // @ts-expect-error "changelog" is not a nav key of this site.
    render(<site.SiteFrame active="changelog">Body</site.SiteFrame>);
  });
});

describe("Section and Split", () => {
  it("renders a section with its tone and size, and the container inside", () => {
    expect(render(<Section labelledBy="h">x</Section>)).toBe(
      '<section class="section" data-tone="plain" data-size="default" aria-labelledby="h"><div class="container">x</div></section>',
    );
    expect(
      render(
        <Section tone="band" size="hero">
          x
        </Section>,
      ),
    ).toContain('data-tone="band" data-size="hero"');
  });

  it("renders two columns, media first when asked", () => {
    expect(render(<Split media={<svg aria-hidden="true" />}>text</Split>)).toBe(
      '<div class="split" data-align="center"><div class="text">text</div><div class="media"><svg aria-hidden="true"></svg></div></div>',
    );
    expect(
      render(
        <Split media="m" mediaFirst align="start">
          t
        </Split>,
      ),
    ).toContain('data-media-first="true" data-align="start"');
  });
});

describe("CtaBand and Status", () => {
  it("renders the closing call to action, plain or on the band", () => {
    const html = render(<CtaBand title="Start today." text="Free." actions={<a href="/pricing/">Go</a>} />);
    expect(html).toContain('<section class="band" data-tone="plain" aria-labelledby="cta-title">');
    expect(html).toContain('<h2 id="cta-title" class="title">Start today.</h2>');
    expect(html).toContain('<div class="actions"><a href="/pricing/">Go</a></div>');
    expect(render(<CtaBand title="t" text="x" actions={null} tone="band" />)).toContain('data-tone="band"');
  });

  it("renders a status tag, plain unless it asks for attention", () => {
    expect(render(<Status>Later</Status>)).toBe('<span class="status" data-tone="plain">Later</span>');
    expect(render(<Status tone="attention">Open idea</Status>)).toContain('data-tone="attention"');
  });
});
