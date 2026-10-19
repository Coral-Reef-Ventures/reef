import type { ReactNode } from "react";

import page from "../page/Page.module.css";
import { Screenshot } from "../Screenshot";
import { Status } from "../Status";
import { Section, Split } from "../shell/Section";
import classes from "./AreaPage.module.css";

/** One section of an area page: a claim, two or three paragraphs, and the screen that shows it. */
export type AreaSection<S extends string = string> = {
  /** The heading's id, unique on the page; it names the section for assistive technology. */
  id: string;
  title: string;
  text: readonly string[];
  /** The screen's caption, which `screen` draws beside the text; none, and the section has no media. */
  screen?: string | undefined;
  /** The screen's shape, as a CSS aspect ratio. */
  aspect?: string | undefined;
  /** The section's status, above its heading, when it differs from the page's. */
  status?: S | undefined;
  /** A page that says more, under the text. */
  link?: { href: string; label: string } | undefined;
};

/** An area page's copy: the headline and lead, the page's status, the screen under the lead, the sections. */
export type AreaCopy<S extends string = string> = {
  key: string;
  title: string;
  lead: string;
  /** The page's status, above its headline. A page whose sections each carry their own has none. */
  status?: S | undefined;
  /** The screen under the lead, before the sections. */
  hero?: { screen: string; aspect?: string | undefined } | undefined;
  sections: readonly AreaSection<S>[];
  /** What the area does not do, or not yet, said plainly under the sections. */
  notYet?: readonly string[] | undefined;
};

/** Draws a screen: its caption, its shape if the copy gives one, and whether it is the hero under the lead. */
export type ScreenRenderer = (screen: { name: string; aspect: string | undefined; hero: boolean }) => ReactNode;

/**
 * Until the product has a screen to show, the shell's labelled frame: 16 / 8 under the lead, 16 / 10 beside a section.
 * The hero loads at once with high priority, because on a phone its top edge is in the first screenful and is the
 * page's largest paint (Streamlane #830); the others are lazy.
 */
const screenshot: ScreenRenderer = ({ name, aspect, hero }) => (
  <Screenshot name={name} aspect={aspect ?? (hero ? "16 / 8" : "16 / 10")} priority={hero} />
);

const attention = (status: string) => <Status tone="attention">{status}</Status>;

/**
 * The area page template both sites build their product areas with: the area row (`nav`, an AreaNav), the status, the
 * headline and lead with the first screen under them, one section per claim with its screen, the screens alternating
 * sides on alternating grounds, what is not here yet, and the closing band (`closing`, usually a CtaBand with the
 * site's own buttons). Rendered inside the page's SiteFrame. Plain elements with the shell's type scale, so it imports
 * no Mantine; `status` draws a status in the site's own tones (the attention tone by default), and `screen` draws a
 * screen (the labelled frame by default) for a site with captures of its own.
 */
export const AreaPage = <S extends string>({
  area,
  nav,
  closing,
  status = attention,
  screen = screenshot,
  notYetTitle = "Not here yet",
}: {
  area: AreaCopy<S>;
  /** The area row above the headline; none where the site puts the areas in the header's row (SubNav, 0.7.0). */
  nav?: ReactNode;
  closing: ReactNode;
  status?: (status: S) => ReactNode;
  screen?: ScreenRenderer;
  /** The heading over `notYet`. */
  notYetTitle?: string;
}) => (
  <>
    <Section size="hero">
      {nav}
      {area.status && <div className={classes.status}>{status(area.status)}</div>}
      <h1 className={page.title}>{area.title}</h1>
      <p className={page.lead}>{area.lead}</p>
      {area.hero && (
        <div className={classes.heroScreen}>
          {screen({ name: area.hero.screen, aspect: area.hero.aspect, hero: true })}
        </div>
      )}
    </Section>

    {area.sections.map((section, index) => (
      <Section key={section.id} tone={index % 2 === 0 ? "band" : "plain"} labelledBy={section.id}>
        <Split
          mediaFirst={index % 2 === 1}
          align="start"
          media={section.screen ? screen({ name: section.screen, aspect: section.aspect, hero: false }) : null}
        >
          {section.status && <div className={classes.status}>{status(section.status)}</div>}
          <h2 id={section.id} className={page.h2}>
            {section.title}
          </h2>
          {section.text.map((paragraph) => (
            <p key={paragraph} className={classes.paragraph}>
              {paragraph}
            </p>
          ))}
          {section.link && (
            <p className={classes.link}>
              <a href={section.link.href}>{section.link.label} →</a>
            </p>
          )}
        </Split>
      </Section>
    ))}

    {area.notYet && area.notYet.length > 0 && (
      <Section labelledBy={`${area.key}-not-yet`}>
        <h2 id={`${area.key}-not-yet`} className={page.h3}>
          {notYetTitle}
        </h2>
        <ul className={classes.notYet}>
          {area.notYet.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      </Section>
    )}

    {closing}
  </>
);
