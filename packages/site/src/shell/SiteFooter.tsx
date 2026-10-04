import type { SiteConfig } from "../config";
import classes from "./SiteFooter.module.css";

const list = new Intl.ListFormat("en-US", { type: "conjunction" });

/**
 * The footer: who makes the product, its links, the family's no-trackers line, and the trademark disclaimer for the
 * vendors the site names. A server component, like the header.
 */
export const SiteFooter = ({ site }: { site: SiteConfig }) => (
  <footer className={classes.footer}>
    <div className={classes.inner}>
      <p className={classes.maker}>{site.footer.maker}</p>
      <p className={classes.links}>
        {site.footer.links.map((link) => (
          <span key={link.href}>
            <a href={link.href}>{link.label}</a> ·{" "}
          </span>
        ))}
        No trackers
        {site.footer.trademarks.length > 0 && (
          <>
            {" "}
            · {list.format(site.footer.trademarks)} are trademarks of their owners; {site.name} is not affiliated with
            them
          </>
        )}
      </p>
    </div>
  </footer>
);
