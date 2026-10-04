import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { ImageResponse } from "next/og";

import { type Card, cardSegments, socialCardSize } from "./cards";
import type { SiteConfig } from "./config";

/*
 * A page's social card: 1200 × 630, the brand's ground, the product's mark and wordmark, the headline, one sentence,
 * and the domain in the accent, drawn by next/og at build (the product's app/og/[...card]/route.tsx).
 */

const weights = [400, 600, 700] as const;
const fontCache = path.join(process.cwd(), ".next", "cache", "coral-reef", "fonts");

// next/og needs TrueType; Google Fonts serves it to clients that are not browsers. Kept between builds with the
// rest of .next/cache.
const loadFont = async (family: string, weight: number) => {
  const slug = family.toLowerCase().replaceAll(" ", "-");
  const file = path.join(fontCache, `${slug}-${weight}.ttf`);
  const cached = await readFile(file).catch(() => undefined);
  if (cached) {
    return cached;
  }
  const query = family.replaceAll(" ", "+");
  const css = await (await fetch(`https://fonts.googleapis.com/css2?family=${query}:wght@${weight}`)).text();
  const url = /src:\s*url\(([^)]+\.ttf)\)/.exec(css)?.[1];
  if (!url) {
    throw new Error(`Google Fonts returned no TrueType ${family} ${weight}`);
  }
  const data = Buffer.from(await (await fetch(url)).arrayBuffer());
  await mkdir(fontCache, { recursive: true });
  await writeFile(file, data);
  return data;
};

type Font = { name: string; data: Buffer; weight: (typeof weights)[number]; style: "normal" };
const fonts = new Map<string, Promise<Font[]>>();

const loadFonts = (family: string) => {
  let loading = fonts.get(family);
  if (!loading) {
    loading = Promise.all(
      weights.map(async (weight) => ({
        name: family,
        data: await loadFont(family, weight),
        weight,
        style: "normal" as const,
      })),
    );
    fonts.set(family, loading);
  }
  return loading;
};

/** The card's markup, which next/og draws; a function of its own so a test can read it without a renderer. */
export const socialCardElement = (site: SiteConfig, { headline, sentence }: Card) => {
  const {
    background,
    text,
    muted,
    accent,
    mark,
    domain = new URL(site.url).host,
    font = "Noto Sans",
  } = site.socialCard;
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        padding: "96px 96px 64px",
        background,
        fontFamily: font,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 28 }}>
        {mark}
        <div style={{ fontSize: 60, fontWeight: 700, letterSpacing: -0.6, color: text }}>{site.name}</div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", marginTop: "auto" }}>
        <div
          style={{ maxWidth: 920, fontSize: 52, fontWeight: 700, lineHeight: 1.25, letterSpacing: -0.5, color: text }}
        >
          {headline}
        </div>
        {sentence && (
          <div style={{ marginTop: 20, fontSize: 30, lineHeight: 1.35, color: muted, opacity: 0.85 }}>{sentence}</div>
        )}
        <div style={{ marginTop: 40, fontSize: 24, fontWeight: 600, color: accent }}>{domain}</div>
      </div>
    </div>
  );
};

/** The card as a PNG response. */
export const socialCard = async (site: SiteConfig, card: Card) =>
  new ImageResponse(socialCardElement(site, card), {
    ...socialCardSize,
    fonts: await loadFonts(site.socialCard.font ?? "Noto Sans"),
  });

/**
 * The two exports a static route needs to write every page's card at build (/og/pricing.png): the product's
 * route.tsx keeps `dynamic = "force-static"` and `dynamicParams = false` as literals, which Next reads statically,
 * and takes these from here. `more` adds cards for pages outside the config, such as docs pages titled at build.
 */
export const socialCardRoute = (site: SiteConfig, more?: () => Promise<readonly (readonly [string, Card])[]>) => {
  const allCards = async (): Promise<Map<string, Card>> => {
    const entries: (readonly [string, Card])[] = [...Object.entries(site.cards), ...((await more?.()) ?? [])];
    return new Map(entries.map(([pagePath, card]) => [cardSegments(pagePath).join("/"), card]));
  };
  return {
    generateStaticParams: async () => [...(await allCards()).keys()].map((key) => ({ card: key.split("/") })),
    GET: async (_request: Request, { params }: { params: Promise<{ card: string[] }> }) => {
      const card = (await allCards()).get((await params).card.join("/"));
      if (!card) {
        return new Response("Not found", { status: 404 });
      }
      return socialCard(site, card);
    },
  };
};
