import type { SiteConfig } from "../src/config";

/**
 * Two configs in the shape of the two sites, without their brands: the marks are plain circles, the colors are
 * placeholders. The point is that every field a product would set reaches the markup it should.
 */
const mark = (fill: string) => (
  <svg width="72" height="72" viewBox="0 0 24 24" aria-hidden="true">
    <circle cx="12" cy="12" r="10" fill={fill} />
  </svg>
);

export const streamlaneLike = {
  name: "Streamlane",
  url: "https://streamlane.app",
  description: "Docs, work, ideas, and delivery in one place.",
  nav: [
    { key: "product", label: "Product", href: "/product/" },
    { key: "docs", label: "Docs", href: "/docs/" },
    { key: "pricing", label: "Pricing", href: "/pricing/" },
  ],
  lockup: (
    <span role="img" aria-label="Streamlane">
      Streamlane
    </span>
  ),
  actions: [
    { label: "Sign in", href: "https://app.streamlane.app", kind: "link", hideBelow: "md" },
    { label: "Start free", href: "/pricing/", kind: "primary" },
  ],
  footer: {
    maker: (
      <>
        Streamlane · made by <a href="https://coralreefventures.com/">Coral Reef Ventures</a>
      </>
    ),
    links: [
      { label: "Docs", href: "/docs/" },
      { label: "Contact", href: "/contact/" },
    ],
    trademarks: ["Jira", "Confluence", "Linear", "Notion", "GitLab", "Plane"],
  },
  cards: {
    "/": { headline: "Docs, work, ideas, and delivery in one place.", sentence: "Delivery state comes from GitHub." },
    "/pricing/": { headline: "One plan." },
    "/contact/": { headline: "Talk to us" },
  },
  socialCard: { background: "#123A3C", text: "#FFFFFF", muted: "#F4F7F6", accent: "#F2A93B", mark: mark("#FFFFFF") },
  icons: { icon: [{ url: "/brand/favicon-32.png", sizes: "32x32", type: "image/png" }] },
  themeColor: "#123A3C",
} satisfies SiteConfig<"product" | "docs" | "pricing">;

export const driftlineLike = {
  name: "Driftline",
  url: "https://driftline.app",
  description: "Every release, watched from the moment it ships.",
  nav: [
    { key: "product", label: "Product", href: "/product/" },
    { key: "pricing", label: "Pricing", href: "/pricing/" },
  ],
  lockup: (
    <span role="img" aria-label="Driftline">
      Driftline
    </span>
  ),
  actions: [{ label: "Request early access", href: "/early-access/", kind: "primary", hideBelow: "sm" }],
  footer: {
    maker: <>Driftline · a Coral Reef Ventures product · source on GitHub when it ships</>,
    links: [{ label: "Continuity", href: "/continuity/" }],
    trademarks: ["PostHog", "Amplitude"],
  },
  cards: {
    "/": { headline: "Every release, watched from the moment it ships." },
    "/early-access/": { headline: "Request early access", sentence: "Tell us what you would watch first." },
  },
  socialCard: {
    background: "#2A5A8C",
    text: "#FFFFFF",
    muted: "#F3F6FA",
    accent: "#A8C6E8",
    mark: mark("#FFFFFF"),
    domain: "driftline.app",
  },
  icons: { icon: [{ url: "/brand/mark.svg", type: "image/svg+xml" }] },
  themeColor: "#2A5A8C",
} satisfies SiteConfig<"product" | "pricing">;
