import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { type AreaCard, AreaCards } from "../src/areas/AreaCards";
import { AreaNav } from "../src/areas/AreaNav";
import { type AreaCopy, AreaPage } from "../src/areas/AreaPage";
import { CtaBand } from "../src/page/CtaBand";
import { Status } from "../src/Status";

const render = renderToStaticMarkup;

/** A product's areas in the shape both sites pass: the overview first, then each area, one tagged. */
const areas: AreaCard[] = [
  { key: "overview", label: "Overview", href: "/product/", blurb: "One loop, release to release" },
  { key: "watches", label: "Release watches", href: "/product/watches/", blurb: "Started by each deployment" },
  {
    key: "compliance",
    label: "Compliance",
    href: "/product/compliance/",
    blurb: "Controls and evidence",
    tag: "Planned",
  },
];

describe("AreaCards", () => {
  it("draws a card per area, each a link with its blurb, the current one marked as the page", () => {
    const html = render(<AreaCards areas={areas} current="overview" />);
    expect(html).toContain('<nav aria-label="Product areas" class="nav"><ul class="cards">');
    expect(html).toContain(
      '<a href="/product/" class="card" aria-current="page"><span class="label">Overview</span><span class="blurb">One loop, release to release</span></a>',
    );
    expect(html).toContain(
      '<a href="/product/watches/" class="card"><span class="label">Release watches</span><span class="blurb">Started by each deployment</span></a>',
    );
    expect(html.match(/aria-current/g)).toHaveLength(1);
  });

  it("puts a card's tag beside its name, and nothing where a card has none", () => {
    const html = render(<AreaCards areas={areas} current="overview" />);
    expect(html).toContain('<span class="label">Compliance<span class="tag">Planned</span></span>');
    expect(html.match(/class="tag"/g)).toHaveLength(1);
  });

  it("takes the navigation's name", () => {
    expect(render(<AreaCards areas={areas} current="watches" label="Areas" />)).toContain('<nav aria-label="Areas"');
  });
});

describe("AreaNav", () => {
  it("draws the row of pills, the page you are on marked", () => {
    const html = render(<AreaNav areas={areas} current="watches" />);
    expect(html).toBe(
      '<nav aria-label="Product areas" class="nav"><ul class="list">' +
        '<li><a href="/product/" class="pill">Overview</a></li>' +
        '<li><a href="/product/watches/" class="pill" aria-current="page">Release watches</a></li>' +
        '<li><a href="/product/compliance/" class="pill">Compliance</a></li>' +
        "</ul></nav>",
    );
  });
});

type Tone = "Ships in the first version" | "Later";

const watches: AreaCopy<Tone> = {
  key: "watches",
  title: "Know whether each release worked.",
  lead: "A release reaching production starts a watch on what it changed.",
  status: "Ships in the first version",
  hero: { screen: "Release watch for v2.4" },
  sections: [
    {
      id: "starts",
      title: "Started by the deployment.",
      text: ["When a production deployment succeeds, the watch starts.", "There is no New watch button."],
      screen: "Home on a Monday",
      aspect: "16 / 9",
    },
    {
      id: "health",
      title: "A weekly note.",
      text: ["Every Monday the watches write one note."],
      status: "Later",
      link: { href: "/product/streamlane/", label: "Where findings go" },
    },
  ],
  notYet: ["Session replay"],
};

const nav = <AreaNav areas={areas} current="watches" />;
const closing = <CtaBand title="Tell us what you would watch first." text="Early access." actions={null} />;

describe("AreaPage", () => {
  const html = render(<AreaPage area={watches} nav={nav} closing={closing} />);

  it("opens with the area row, the status, the headline and lead, and the hero screen loaded at once", () => {
    const hero = html.slice(0, html.indexOf("</section>"));
    expect(hero.indexOf('aria-label="Product areas"')).toBeLessThan(hero.indexOf("Ships in the first version"));
    expect(hero).toContain(
      '<div class="status"><span class="status" data-tone="attention">Ships in the first version</span></div>',
    );
    expect(hero).toContain('<h1 class="title">Know whether each release worked.</h1>');
    expect(hero).toContain('<p class="lead">A release reaching production starts a watch on what it changed.</p>');
    expect(hero).toContain(
      '<div class="heroScreen"><figure class="frame" style="aspect-ratio:16 / 8" data-screenshot="release-watch-for-v2-4.png">',
    );
  });

  it("gives each section its heading, paragraphs, link and screen, on alternating grounds and sides", () => {
    expect(html).toContain('<section class="section" data-tone="band" data-size="default" aria-labelledby="starts">');
    expect(html).toContain('<section class="section" data-tone="plain" data-size="default" aria-labelledby="health">');
    expect(html).toContain('<h2 id="starts" class="h2">Started by the deployment.</h2>');
    expect(html).toContain('<p class="paragraph">There is no New watch button.</p>');
    expect(html).toContain('style="aspect-ratio:16 / 9" data-screenshot="home-on-a-monday.png"');
    expect(html).toContain('<p class="link"><a href="/product/streamlane/">Where findings go →</a></p>');
    expect(html).toContain('<div class="split" data-media-first="true" data-align="start">');
    // A section with no screen has no media.
    expect(html).toContain('<div class="media"></div>');
  });

  it("says a section's own status above its heading", () => {
    const health = html.slice(html.indexOf('aria-labelledby="health"'));
    expect(health.indexOf('data-tone="attention">Later</span>')).toBeLessThan(health.indexOf('<h2 id="health"'));
  });

  it("closes with what is not here yet, then the closing band", () => {
    expect(html).toContain('<h2 id="watches-not-yet" class="h3">Not here yet</h2>');
    expect(html).toContain('<ul class="notYet"><li>Session replay</li></ul>');
    expect(html.indexOf("watches-not-yet")).toBeLessThan(html.indexOf("Tell us what you would watch first."));
  });

  it("draws statuses and screens the site's own way when it passes them", () => {
    const own = render(
      <AreaPage
        area={watches}
        nav={nav}
        closing={closing}
        status={(value) => <Status tone={value === "Later" ? "attention" : "plain"}>{value}</Status>}
        screen={({ name, aspect, hero }) => <figure title={name} data-aspect={aspect ?? "none"} data-hero={hero} />}
        notYetTitle="What it does not do"
      />,
    );
    expect(own).toContain('data-tone="plain">Ships in the first version</span>');
    expect(own).toContain('data-tone="attention">Later</span>');
    expect(own).toContain('<figure title="Release watch for v2.4" data-aspect="none" data-hero="true"></figure>');
    expect(own).toContain('<figure title="Home on a Monday" data-aspect="16 / 9" data-hero="false"></figure>');
    expect(own).toContain('<h2 id="watches-not-yet" class="h3">What it does not do</h2>');
  });

  it("leaves out the status, the hero and what is not here when the copy has none", () => {
    const { status: _status, hero: _hero, notYet: _notYet, ...bare } = watches;
    const plain = render(<AreaPage area={bare} nav={nav} closing={null} />);
    const hero = plain.slice(0, plain.indexOf("</section>"));
    expect(hero).not.toContain('class="status"');
    expect(hero).not.toContain("heroScreen");
    expect(plain).not.toContain("not-yet");
  });

  it("opens on the headline when the areas are in the header's row instead", () => {
    const headerRow = render(<AreaPage area={watches} closing={closing} />);
    expect(headerRow).not.toContain('aria-label="Product areas"');
    expect(headerRow).toMatch(
      /^<section class="section" data-tone="plain" data-size="hero"[^>]*><div class="container"><div class="status">/,
    );
  });

  it("uses no Mantine class: the template is plain elements with the shell's type scale", () => {
    expect(html).not.toMatch(/mantine-/);
  });
});
