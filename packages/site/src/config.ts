import type { Metadata } from "next";
import type { ReactNode } from "react";

/** A header section: `key` is what a page passes as `active` to mark it current. */
export type NavItem<Key extends string = string> = { key: Key; label: string; href: string };

/**
 * A header action beside the navigation. `primary` is the filled button (Start free, Request early access); `link`
 * is a plain link (Sign in). An action with `hideBelow` leaves the bar at that breakpoint (`sm` 36em, `md` 62em) and
 * is listed in the folded menu instead, so it stays reachable on a phone.
 */
export type HeaderAction = { label: string; href: string; kind: "primary" | "link"; hideBelow?: "sm" | "md" };

export type FooterLink = { label: string; href: string };

/** A page's social card: its headline and one sentence from its copy. */
export type Card = { headline: string; sentence?: string };

/**
 * How the social card is drawn (1200 × 630): the ground, the headline's color, the sentence's, the domain's, and the
 * product's mark at 72 px, each from the brand. `domain` is the site's host unless another is given.
 */
export type SocialCardStyle = {
  background: string;
  text: string;
  muted: string;
  accent: string;
  mark: ReactNode;
  domain?: string;
  /** The Google Fonts family the card is set in; Noto Sans, the family's wordmark face, by default. */
  font?: string;
};

export type SiteConfig<Key extends string = string> = {
  /** The product: the title template, the footer's trademark line, the social card's wordmark. */
  name: string;
  /** The public origin, no trailing slash; canonical URLs and the social cards are absolute against it. */
  url: string;
  /** The default description, for the root layout and any page that gives none. */
  description: string;
  /** The header's sections, in order. */
  nav: readonly NavItem<Key>[];
  /** The lockup the header shows at 24 px, the way home. The product's own component, since the mark is the brand. */
  lockup: ReactNode;
  /** The header's actions, in order. */
  actions: readonly HeaderAction[];
  /**
   * Something in the header that is not a link, such as a color-scheme control: rendered in the actions group after
   * the actions and before the folded menu's button, vertically centered in the bar, at every width. It is never
   * hidden below a breakpoint and never copied into the folded menu. The header stays a server component, so this is
   * the product's own element (a client component of the product's is fine; the shell imports none). Absent, the
   * header renders exactly as it did without it.
   */
  headerTools?: ReactNode;
  footer: {
    /** The footer's first line: who makes the product and where its source is. */
    maker: ReactNode;
    links: readonly FooterLink[];
    /** The vendors the site names, disclaimed in the footer: "X, Y, and Z are trademarks of their owners". */
    trademarks: readonly string[];
  };
  /** Each page's social card by path (`"/"`, `"/pricing/"`); every page in the sitemap has one. */
  cards: Record<string, Card>;
  socialCard: SocialCardStyle;
  /** The favicon set, as the root layout's metadata lists it. */
  icons: Metadata["icons"];
  /** The browser chrome's color on a phone. */
  themeColor: string;
};
