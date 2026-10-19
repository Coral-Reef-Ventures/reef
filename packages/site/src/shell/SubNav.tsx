import classes from "./SubNav.module.css";

/** One page of a section's tabs: its key, its name in the row, and its page. */
export type SubNavItem = {
  key: string;
  label: string;
  href: string;
};

/*
 * Scrolls the row so the current tab is centered when the row is wider than the screen, as it is on a phone, so the
 * page you are on is in view without a swipe. Inline and run as the row is parsed, before the first paint; with no
 * script the row starts at its first tab, which is still one swipe from every page.
 */
const centerCurrent =
  '(function(s){var l=s&&s.parentElement.querySelector("ul"),c=l&&l.querySelector(\'[aria-current="page"]\');' +
  "if(c&&l.scrollWidth>l.clientWidth)l.scrollLeft=c.offsetLeft-(l.clientWidth-c.offsetWidth)/2})(document.currentScript)";

// biome-ignore lint/style/useNamingConvention: React's own name for raw markup.
const script = { __html: centerCurrent };

/**
 * A section's pages as one row of tabs under the header's bar, passed to SiteFrame as `subnav`, so it stays in view
 * with a sticky header and every page of the section is one click away. The row never wraps: where it is wider than
 * the screen it scrolls sideways, fading at the edge that has more, with the current tab scrolled into view. Keep the
 * labels short (one word where it can be) so the row fits the column on a laptop.
 */
export const SubNav = ({
  items,
  current,
  label,
}: {
  items: readonly SubNavItem[];
  /** The key of the page it is on; none, and no tab is marked. */
  current?: string | undefined;
  /** The navigation's accessible name. */
  label: string;
}) => (
  <nav aria-label={label} className={classes.nav}>
    <ul className={classes.list}>
      {items.map((item) => (
        <li key={item.key}>
          <a href={item.href} className={classes.tab} aria-current={item.key === current ? "page" : undefined}>
            {item.label}
          </a>
        </li>
      ))}
    </ul>
    {/* biome-ignore lint/security/noDangerouslySetInnerHtml: a fixed string of the shell's own, no input reaches it. */}
    <script dangerouslySetInnerHTML={script} />
  </nav>
);
