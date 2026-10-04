import type { Metadata, Viewport } from "next";

import { type Card, cardPath, socialCardSize } from "./cards";
import type { SiteConfig } from "./config";

export type PageMetadataInput = {
  title: string;
  description: string;
  /** The page's path, with its trailing slash. */
  path: string;
  /** The social card's headline; the pages in the config's `cards` have theirs there. */
  card?: Card | undefined;
};

/**
 * A page's title, description, canonical URL, and social card. URLs are absolute against metadataBase (the site's
 * origin), with the trailing slash every page's URL has. A page's openGraph replaces the root layout's rather than
 * merging with it, so the site-wide fields are repeated here.
 */
export const pageMetadata = (
  site: SiteConfig,
  { title, description, path, card = site.cards[path] }: PageMetadataInput,
): Metadata => {
  const images = [{ url: cardPath(path), ...socialCardSize, type: "image/png", alt: card?.headline ?? title }];
  return {
    title: path === "/" ? { absolute: title } : title,
    description,
    alternates: { canonical: path },
    openGraph: { siteName: site.name, type: "website", locale: "en_US", title, description, url: path, images },
    twitter: { card: "summary_large_image", title, description, images },
  };
};

/** The root layout's metadata: the title template, the default description, the icons, and the site-wide card fields. */
export const rootMetadata = (site: SiteConfig): Metadata => ({
  metadataBase: new URL(site.url),
  title: { default: site.name, template: `%s · ${site.name}` },
  description: site.description,
  applicationName: site.name,
  openGraph: { siteName: site.name, type: "website", locale: "en_US" },
  twitter: { card: "summary_large_image" },
  icons: site.icons,
});

/** The root layout's viewport: the brand's color in the browser chrome, and a light-only site. */
export const rootViewport = (site: SiteConfig): Viewport => ({ themeColor: site.themeColor, colorScheme: "light" });
