import type { ReactNode } from "react";

import classes from "./Section.module.css";

type SectionProps = {
  children: ReactNode;
  /** `band` is the tinted background the pages alternate with white. */
  tone?: "plain" | "band";
  /** `hero` is the first section of a page, with more space above. */
  size?: "hero" | "default";
  /** The id of the section's heading, which names it for assistive technology. */
  labelledBy?: string;
};

/** A full-width band with the page container (`--site-max-width` wide with a `--site-gutter` either side). */
export const Section = ({ children, tone = "plain", size = "default", labelledBy }: SectionProps) => (
  <section className={classes.section} data-tone={tone} data-size={size} aria-labelledby={labelledBy}>
    <div className={classes.container}>{children}</div>
  </section>
);

/** Two columns that stack on phones and tablets. `mediaFirst` puts the media on the left from md up. */
export const Split = ({
  children,
  media,
  mediaFirst = false,
  align = "center",
}: {
  children: ReactNode;
  media: ReactNode;
  mediaFirst?: boolean;
  align?: "center" | "start";
}) => (
  <div className={classes.split} data-media-first={mediaFirst || undefined} data-align={align}>
    <div className={classes.text}>{children}</div>
    <div className={classes.media}>{media}</div>
  </div>
);
