import type { Card } from "./config";

export type { Card };

/** Where a page's card is published: "/" is /og/home.png, "/docs/concepts/teams/" is /og/docs/concepts/teams.png. */
export const cardPath = (pagePath: string) => `/og/${pagePath.replace(/^\/|\/$/g, "") || "home"}.png`;

/** The route segments of a card's path, as app/og/[...card] receives them. */
export const cardSegments = (pagePath: string) =>
  cardPath(pagePath)
    .replace(/^\/og\//, "")
    .split("/");

/** The social card is 1200 × 630, the size every network reads. */
export const socialCardSize = { width: 1200, height: 630 };
