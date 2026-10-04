import type { ReactNode } from "react";

import type { SiteConfig } from "../config";
import { SiteFooter } from "./SiteFooter";
import { SiteHeader } from "./SiteHeader";

/**
 * Every page's frame: skip link, header with the page's section marked current, main, and footer. Pages render it
 * themselves because a layout cannot know which section is current without a client component.
 */
export const SiteFrame = <Key extends string>({
  site,
  active,
  children,
}: {
  site: SiteConfig<Key>;
  active?: Key | undefined;
  children: ReactNode;
}) => (
  <>
    <a href="#main" className="skip-link">
      Skip to content
    </a>
    <SiteHeader site={site} active={active} />
    <main id="main">{children}</main>
    <SiteFooter site={site} />
  </>
);
