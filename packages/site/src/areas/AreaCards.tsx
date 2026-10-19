import classes from "./AreaCards.module.css";
import type { AreaLink } from "./AreaNav";

/** An area as its card shows it: its link, what is in it in a few words, and an optional tag beside its name. */
export type AreaCard = AreaLink & {
  blurb: string;
  /** A word beside the name in the attention tone, such as "Planned" for an area whose page is not built yet. */
  tag?: string | undefined;
};

/**
 * The overview's navigation: a card for the overview and one per area, each a link, the selected one filled, so it
 * says the others can be chosen. Two rows of eight on a wide screen, as many as fit below that, and on a phone one row
 * that scrolls sideways, with the selected card first when it is the overview. `areas` is every card in order, the
 * overview first; `current` is the key of the page they are on.
 */
export const AreaCards = ({
  areas,
  current,
  label = "Product areas",
}: {
  areas: readonly AreaCard[];
  current: string;
  /** The navigation's accessible name. */
  label?: string;
}) => (
  <nav aria-label={label} className={classes.nav}>
    <ul className={classes.cards}>
      {areas.map((area) => (
        <li key={area.key}>
          <a href={area.href} className={classes.card} aria-current={area.key === current ? "page" : undefined}>
            <span className={classes.label}>
              {area.label}
              {area.tag && <span className={classes.tag}>{area.tag}</span>}
            </span>
            <span className={classes.blurb}>{area.blurb}</span>
          </a>
        </li>
      ))}
    </ul>
  </nav>
);
