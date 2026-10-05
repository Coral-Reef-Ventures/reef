import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  comingSoon,
  contrast,
  defaultAccent,
  defaultAccentDark,
  parsePageConfig,
  surfaces,
  textOn,
} from "../src/door/page.ts";

/**
 * The coming-soon page on its own: what it says, what it may load, and the colors it accepts. The gate's tests drive
 * it over HTTP; these pin the page's bytes and its configuration.
 */
const door = "https://door.example";
const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><rect width="1" height="1"/></svg>');
const mark = { type: "image/svg+xml" as const, data: svg.toString("base64") };
const markDark = { type: "image/svg+xml" as const, data: Buffer.from("<svg dark></svg>").toString("base64") };

const styleOf = (html: string) => /<style>([^<]*)<\/style>/.exec(html)?.[1] ?? "";

describe("comingSoon", () => {
  const page = comingSoon(
    parsePageConfig({ name: "Driftline", mark, accent: "#2a5a8c" }, "driftline"),
    door,
    "driftline",
  );
  const html = page.html("/docs/?tab=api&x=1");

  it("says the approved words: the name, coming soon, invited guests, a sign-in button and Get involved", () => {
    expect(html).toContain("<title>Driftline is coming soon</title>");
    expect(html).toContain("<h1>Driftline is coming soon.</h1>");
    expect(html).toContain('<p class="lede">Open for now to invited guests.</p>');
    expect(html).toContain(
      '<a class="button" href="/_door/signin?next=%2Fdocs%2F%3Ftab%3Dapi%26x%3D1">Have an invitation? Sign in</a>',
    );
    expect(html).toContain('<a class="link" href="https://door.example/get-involved/?site=driftline">Get involved</a>');
    expect(html).toMatch(/^<!doctype html><html lang="en">/);
    expect(html).toContain('<meta name="viewport" content="width=device-width, initial-scale=1">');
    expect(html).toContain('<meta name="robots" content="noindex, nofollow">');
  });

  it("carries the mark inline and runs nothing: no script, no stylesheet link, no URL it would fetch", () => {
    expect(html).toContain(`<img class="mark-light" src="data:image/svg+xml;base64,${mark.data}" alt="">`);
    expect(html).not.toMatch(/<script|<link|<iframe|<object|<embed|<form|\son\w+=/i);
    expect(html).not.toMatch(/style="/);
    // Every src is a data URI, and the only absolute URL is the door's Get involved link, which is a navigation.
    for (const [, src] of html.matchAll(/\ssrc="([^"]*)"/g)) expect(src).toMatch(/^data:image\//);
    expect([...html.matchAll(/https?:\/\/[^"<\s]+/g)].map(([url]) => url)).toEqual([
      "https://door.example/get-involved/?site=driftline",
    ]);
    expect(styleOf(html)).not.toMatch(/url\(|@import/);
  });

  it("allows exactly its own stylesheet, by hash, and data: images, and nothing else", () => {
    const hash = createHash("sha256").update(styleOf(html)).digest("base64");
    expect(page.csp).toBe(
      `default-src 'none'; style-src 'sha256-${hash}'; img-src data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`,
    );
    const plain = comingSoon(parsePageConfig(undefined, "alpha"), door, "alpha");
    expect(plain.csp).not.toContain("img-src");
  });

  it("is the same bytes for every next but the link that carries it", () => {
    const placeholder = (text: string) => text.replace(/href="\/_door\/signin\?next=[^"]*"/, 'href="NEXT"');
    expect(placeholder(page.html("/"))).toBe(placeholder(page.html("/a/b/?c=d")));
    expect(page.html("/")).not.toBe(page.html("/a/"));
  });

  it("escapes the name and the next it is given", () => {
    const odd = comingSoon(parsePageConfig({ name: `A<b> & "c"` }, "alpha"), door, "alpha");
    const text = odd.html(`/"><script>x</script>`);
    expect(text).toContain("<h1>A&lt;b&gt; &amp; &quot;c&quot; is coming soon.</h1>");
    expect(text).not.toContain("<script>");
    expect(text).toContain('href="/_door/signin?next=%2F%22%3E%3Cscript%3Ex%3C%2Fscript%3E"');
  });

  it("follows the reader's scheme, with the product's color in each, and a dark mark when there is one", () => {
    const css = styleOf(html);
    expect(css).toContain("color-scheme:light dark");
    expect(css).toContain("--accent:#2a5a8c;--on-accent:#ffffff");
    expect(css).toContain("@media (prefers-color-scheme:dark)");
    expect(css).toContain(`--accent:${defaultAccentDark};--on-accent:#000000`);
    // No dark mark: the one mark sits on a light tile in the dark scheme.
    expect(css).toContain(".mark-light{background:#ffffff;");
    const both = comingSoon(parsePageConfig({ mark, markDark }, "alpha"), door, "alpha").html("/");
    expect(both).toContain(`<img class="mark-dark" src="data:image/svg+xml;base64,${markDark.data}" alt="">`);
    expect(styleOf(both)).toContain(".mark-light{display:none}.mark-dark{display:block}");
  });

  it("renders a correct page with no configuration at all: the site id as the name, no mark, a neutral button", () => {
    const plain = comingSoon(parsePageConfig(undefined, "alpha"), door, "alpha").html("/");
    expect(plain).toContain("<h1>Alpha is coming soon.</h1>");
    expect(plain).toContain('<p class="lockup"><span>Alpha</span></p>');
    expect(plain).not.toContain("<img");
    expect(styleOf(plain)).toContain(`--accent:${defaultAccent};--on-accent:#ffffff`);
  });
});

describe("the page's colors", () => {
  it("measures contrast as WCAG 2 does", () => {
    expect(contrast("#ffffff", "#000000")).toBeCloseTo(21, 5);
    expect(contrast("#777777", "#ffffff")).toBeCloseTo(4.48, 2);
  });

  it("puts the button's label at 4.5:1 or better on any accent", () => {
    for (let gray = 0; gray < 256; gray += 1) {
      const hex = `#${gray.toString(16).padStart(2, "0").repeat(3)}`;
      expect(contrast(hex, textOn(hex)), hex).toBeGreaterThanOrEqual(4.5);
    }
    for (const hex of ["#2a5a8c", "#123a3c", "#f2a93b", "#a8c6e8", "#ff0000", "#00ff00", "#0000ff", "#808000"]) {
      expect(contrast(hex, textOn(hex)), hex).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("keeps the page's own text at AA in both schemes", () => {
    for (const scheme of [surfaces.light, surfaces.dark]) {
      expect(contrast(scheme.text, scheme.background)).toBeGreaterThanOrEqual(7);
      expect(contrast(scheme.muted, scheme.background)).toBeGreaterThanOrEqual(4.5);
    }
    expect(contrast(defaultAccent, surfaces.light.background)).toBeGreaterThanOrEqual(3);
    expect(contrast(defaultAccentDark, surfaces.dark.background)).toBeGreaterThanOrEqual(3);
  });
});

describe("parsePageConfig", () => {
  it("fills in the defaults and keeps what a site sets", () => {
    expect(parsePageConfig(undefined, "driftline")).toEqual({
      name: "Driftline",
      accent: defaultAccent,
      accentDark: defaultAccentDark,
    });
    expect(parsePageConfig({ name: "Streamlane", accent: "#123A3C", accentDark: "#F2A93B", mark }, "s")).toEqual({
      name: "Streamlane",
      accent: "#123a3c",
      accentDark: "#f2a93b",
      mark,
    });
  });

  it.each([
    ["no object", "x"],
    ["an empty name", { name: "" }],
    ["a name padded with spaces", { name: " Alpha " }],
    ["a name over 60 characters", { name: "a".repeat(61) }],
    ["a name with a newline", { name: "Al\npha" }],
    ["a color that is not #rrggbb", { accent: "red" }],
    ["a short hex color", { accent: "#123" }],
    ["an accent too faint on white", { accent: "#f2a93b" }],
    ["a dark accent too faint on the dark page", { accentDark: "#123a3c" }],
    ["a mark of another type", { mark: { type: "image/jpeg", data: "AAAA" } }],
    ["a mark that is not base64", { mark: { type: "image/png", data: "<svg>" } }],
    ["a mark over 64 KB", { mark: { type: "image/png", data: Buffer.alloc(65 * 1024).toString("base64") } }],
    ["a dark mark with no mark", { markDark }],
  ])("refuses %s", (_name, value) => {
    expect(() => parsePageConfig(value, "alpha")).toThrow();
  });
});
