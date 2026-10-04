import type { ReactNode } from "react";

import classes from "./CtaBand.module.css";

/**
 * The closing call to action on Home and Product: a heading and a sentence, with the buttons to the right. `band`
 * sets it on the tinted ground under a rule, as Driftline's pages do.
 */
export const CtaBand = ({
  title,
  text,
  actions,
  tone = "plain",
}: {
  title: string;
  text: string;
  actions: ReactNode;
  tone?: "plain" | "band";
}) => (
  <section className={classes.band} data-tone={tone} aria-labelledby="cta-title">
    <div className={classes.inner}>
      <div className={classes.copy}>
        <h2 id="cta-title" className={classes.title}>
          {title}
        </h2>
        <p className={classes.text}>{text}</p>
      </div>
      <div className={classes.actions}>{actions}</div>
    </div>
  </section>
);
