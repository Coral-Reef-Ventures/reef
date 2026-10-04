import page from "./page/Page.module.css";

export { type Card, cardPath, cardSegments, socialCardSize } from "./cards";
export type { FooterLink, HeaderAction, NavItem, SiteConfig, SocialCardStyle } from "./config";
export { createSite, type Site } from "./create-site";
export { type PageMetadataInput, pageMetadata, rootMetadata, rootViewport } from "./metadata";
export { CtaBand } from "./page/CtaBand";
export { Screenshot, screenshotFile } from "./Screenshot";
export { Status } from "./Status";
export { Section, Split } from "./shell/Section";
export { SiteFooter } from "./shell/SiteFooter";
export { SiteFrame } from "./shell/SiteFrame";
export { SiteHeader } from "./shell/SiteHeader";
export { socialCard, socialCardElement, socialCardRoute } from "./social-card";

/** The marketing pages' type scale (display, title, lead, h2, h3, subhead, body, small, actions, card, eyebrow). */
export { page };
