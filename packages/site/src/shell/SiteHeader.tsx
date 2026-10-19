import type { ReactNode } from "react";

import type { HeaderAction, SiteConfig } from "../config";
import classes from "./SiteHeader.module.css";

const links = (site: SiteConfig, active: string | undefined) =>
  site.nav.map((item) => (
    <a key={item.key} href={item.href} className={classes.link} aria-current={item.key === active ? "page" : undefined}>
      {item.label}
    </a>
  ));

const action = ({ label, href, kind, hideBelow }: HeaderAction) => (
  <a key={href} href={href} className={kind === "primary" ? classes.primary : classes.link} data-hide-below={hideBelow}>
    {label}
  </a>
);

/**
 * The header: lockup, the sections, the actions, and the site's header tools if it has any. A server component with plain links, so a page that ships no
 * client code can carry it; below the md breakpoint the sections fold into a <details> menu, which needs no script,
 * and any action hidden at some width is listed there too. `subnav` (a SubNav, since 0.7.0) is a second row under the
 * bar for the page's own section, inside the header so that it sticks with it; a site with `stickyHeader` keeps both
 * in view as the page scrolls.
 */
export const SiteHeader = <Key extends string>({
  site,
  active,
  subnav,
}: {
  site: SiteConfig<Key>;
  active?: Key | undefined;
  subnav?: ReactNode;
}) => (
  <header className={classes.header} data-sticky={site.stickyHeader ? "true" : undefined}>
    <div className={classes.inner}>
      <a href="/" className={classes.home}>
        {site.lockup}
      </a>
      <nav aria-label="Main" className={classes.nav}>
        {links(site, active)}
      </nav>
      <div className={classes.actions}>
        {site.actions.map(action)}
        {site.headerTools == null ? null : <div className={classes.tools}>{site.headerTools}</div>}
        <details className={classes.menu}>
          <summary className={classes.menuButton} aria-label="Menu">
            <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">
              <path d="M3 5h14M3 10h14M3 15h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </summary>
          <nav aria-label="Main" className={classes.menuPanel}>
            {links(site, active)}
            {site.actions
              .filter((item) => item.hideBelow !== undefined)
              .map((item) => (
                <a key={item.href} href={item.href} className={classes.link}>
                  {item.label}
                </a>
              ))}
          </nav>
        </details>
      </div>
    </div>
    {subnav == null ? null : <div className={classes.subnav}>{subnav}</div>}
  </header>
);
