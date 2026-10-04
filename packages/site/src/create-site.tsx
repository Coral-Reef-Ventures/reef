import type { MetadataRoute } from "next";
import type { ReactNode } from "react";

import type { Card, SiteConfig } from "./config";
import { type PageMetadataInput, pageMetadata, rootMetadata, rootViewport } from "./metadata";
import { SiteFooter } from "./shell/SiteFooter";
import { SiteFrame } from "./shell/SiteFrame";
import { SiteHeader } from "./shell/SiteHeader";
import { socialCard, socialCardRoute } from "./social-card";

/**
 * The shell bound to one site's config, which a product does once in its `lib/site.tsx` and imports from there:
 * `const { SiteFrame, pageMetadata } = createSite({ ... })`. Server components need no provider, so binding is a
 * closure, and `active` is typed to the config's nav keys.
 */
export const createSite = <const Key extends string>(config: SiteConfig<Key>) => ({
  config,
  SiteFrame: ({ active, children }: { active?: Key | undefined; children: ReactNode }) => (
    <SiteFrame site={config} active={active}>
      {children}
    </SiteFrame>
  ),
  SiteHeader: ({ active }: { active?: Key | undefined }) => <SiteHeader site={config} active={active} />,
  SiteFooter: () => <SiteFooter site={config} />,
  pageMetadata: (page: PageMetadataInput) => pageMetadata(config, page),
  rootMetadata: () => rootMetadata(config),
  rootViewport: () => rootViewport(config),
  /** Everything is public; the sitemap lists every page. */
  robots: (): MetadataRoute.Robots => ({ rules: { userAgent: "*", allow: "/" }, sitemap: `${config.url}/sitemap.xml` }),
  /** Every page with a card, and any more the product lists (docs pages). */
  sitemap: (more: readonly string[] = []): MetadataRoute.Sitemap =>
    [...new Set([...Object.keys(config.cards), ...more])].map((path) => ({ url: `${config.url}${path}` })),
  socialCard: (card: Card) => socialCard(config, card),
  socialCardRoute: (more?: () => Promise<readonly (readonly [string, Card])[]>) => socialCardRoute(config, more),
});

export type Site<Key extends string = string> = ReturnType<typeof createSite<Key>>;
