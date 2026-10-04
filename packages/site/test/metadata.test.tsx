import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { cardPath, cardSegments } from "../src/cards";
import { createSite } from "../src/create-site";
import { socialCardElement } from "../src/social-card";
import { driftlineLike, streamlaneLike } from "./fixtures";

describe("cards", () => {
  it("publishes a page's card under /og, the home page as home", () => {
    expect(cardPath("/")).toBe("/og/home.png");
    expect(cardPath("/pricing/")).toBe("/og/pricing.png");
    expect(cardPath("/docs/concepts/teams/")).toBe("/og/docs/concepts/teams.png");
    expect(cardSegments("/docs/concepts/teams/")).toEqual(["docs", "concepts", "teams.png"]);
  });
});

describe("pageMetadata", () => {
  const site = createSite(streamlaneLike);

  it("gives a page its title, description, canonical path and card, with the site-wide fields repeated", () => {
    const metadata = site.pageMetadata({ title: "Pricing", description: "One plan.", path: "/pricing/" });
    expect(metadata.title).toBe("Pricing");
    expect(metadata.alternates).toEqual({ canonical: "/pricing/" });
    const image = { url: "/og/pricing.png", width: 1200, height: 630, type: "image/png", alt: "One plan." };
    expect(metadata.openGraph).toEqual({
      siteName: "Streamlane",
      type: "website",
      locale: "en_US",
      title: "Pricing",
      description: "One plan.",
      url: "/pricing/",
      images: [image],
    });
    expect(metadata.twitter).toEqual({
      card: "summary_large_image",
      title: "Pricing",
      description: "One plan.",
      images: [image],
    });
  });

  it("keeps the home page's title absolute, so the template does not double the name", () => {
    const metadata = site.pageMetadata({ title: "Streamlane", description: "d", path: "/" });
    expect(metadata.title).toEqual({ absolute: "Streamlane" });
  });

  it("falls back to the title as the card's alt text when the page has no card", () => {
    const metadata = site.pageMetadata({ title: "Demo", description: "d", path: "/demo/" });
    expect(metadata.openGraph).toMatchObject({ images: [{ url: "/og/demo.png", alt: "Demo" }] });
  });
});

describe("the root layout's metadata", () => {
  const site = createSite(driftlineLike);

  it("names the product everywhere and lists the icons", () => {
    const metadata = site.rootMetadata();
    expect(metadata.metadataBase).toEqual(new URL("https://driftline.app"));
    expect(metadata.title).toEqual({ default: "Driftline", template: "%s · Driftline" });
    expect(metadata.description).toBe("Every release, watched from the moment it ships.");
    expect(metadata.applicationName).toBe("Driftline");
    expect(metadata.openGraph).toEqual({ siteName: "Driftline", type: "website", locale: "en_US" });
    expect(metadata.icons).toEqual({ icon: [{ url: "/brand/mark.svg", type: "image/svg+xml" }] });
    expect(site.rootViewport()).toEqual({ themeColor: "#2A5A8C", colorScheme: "light" });
  });

  it("lists every page with a card in the sitemap, plus the ones the product adds, and points robots at it", () => {
    expect(site.sitemap()).toEqual([{ url: "https://driftline.app/" }, { url: "https://driftline.app/early-access/" }]);
    expect(site.sitemap(["/docs/", "/"])).toHaveLength(3);
    expect(site.robots()).toEqual({
      rules: { userAgent: "*", allow: "/" },
      sitemap: "https://driftline.app/sitemap.xml",
    });
  });
});

describe("the social card", () => {
  it("draws the brand's ground, the mark, the wordmark, the headline, the sentence and the domain", () => {
    const html = renderToStaticMarkup(
      socialCardElement(streamlaneLike, { headline: "One plan.", sentence: "Every feature." }),
    );
    expect(html).toContain("background:#123A3C");
    expect(html).toContain('<circle cx="12" cy="12" r="10" fill="#FFFFFF">');
    expect(html).toContain(">Streamlane</div>");
    expect(html).toContain(">One plan.</div>");
    expect(html).toContain("color:#F4F7F6;opacity:0.85");
    expect(html).toContain(">Every feature.</div>");
    // The domain is the site's host unless the config names another.
    expect(html).toContain('color:#F2A93B">streamlane.app</div>');
    expect(html).toContain("font-family:Noto Sans");
  });

  it("leaves the sentence out when a card has none, and takes the domain from the config when given", () => {
    const html = renderToStaticMarkup(socialCardElement(driftlineLike, { headline: "Roadmap" }));
    expect(html).not.toContain("opacity:0.85");
    expect(html).toContain(">driftline.app</div>");
  });

  it("lists every card's segments for the static route, and answers an unknown one with 404", async () => {
    const site = createSite(streamlaneLike);
    const route = site.socialCardRoute(async () => [["/docs/security/", { headline: "Security" }]]);
    expect(await route.generateStaticParams()).toEqual([
      { card: ["home.png"] },
      { card: ["pricing.png"] },
      { card: ["contact.png"] },
      { card: ["docs", "security.png"] },
    ]);
    const missing = await route.GET(new Request("http://localhost/og/nope.png"), {
      params: Promise.resolve({ card: ["nope.png"] }),
    });
    expect(missing.status).toBe(404);
  });
});
