import type { ReactNode } from "react";

import classes from "./Status.module.css";

/**
 * When a capability ships, beside the section that describes it ("Ships with the GitHub integration", "Later"). A
 * Coral Reef site describes how a product works and never says a feature is available, so anything not yet shipped
 * carries one of these. `attention` draws it in the site's attention color (--site-attention-*). A server component.
 */
export const Status = ({ children, tone = "plain" }: { children: ReactNode; tone?: "plain" | "attention" }) => (
  <span className={classes.status} data-tone={tone}>
    {children}
  </span>
);
