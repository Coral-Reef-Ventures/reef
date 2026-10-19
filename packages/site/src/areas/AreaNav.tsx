import classes from "./AreaNav.module.css";

/** One area a site presents under its product page: its key, its name, and its page. */
export type AreaLink = {
  key: string;
  label: string;
  href: string;
};

/**
 * The row of pills at the top of every area page: the overview, then each area, the page you are on selected, so a
 * reader moves between areas without going back and sees at once that the others can be chosen. The overview carries
 * the same choices as cards (AreaCards); here they stay one compact row, so the page's headline is not pushed down.
 * `areas` is the whole row in order, the overview first; `current` is the key of the page it is on.
 */
export const AreaNav = ({
  areas,
  current,
  label = "Product areas",
}: {
  areas: readonly AreaLink[];
  current: string;
  /** The navigation's accessible name. */
  label?: string;
}) => (
  <nav aria-label={label} className={classes.nav}>
    <ul className={classes.list}>
      {areas.map((area) => (
        <li key={area.key}>
          <a href={area.href} className={classes.pill} aria-current={area.key === current ? "page" : undefined}>
            {area.label}
          </a>
        </li>
      ))}
    </ul>
  </nav>
);
