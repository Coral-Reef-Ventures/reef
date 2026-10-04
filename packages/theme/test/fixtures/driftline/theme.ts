/**
 * Driftline's theme as its packages/theme/src/theme.ts builds it (Coral-Reef-Ventures/driftline, read 2026-10-04),
 * written against this package's builder. A fixture, as Streamlane's is: what Driftline's theme.ts becomes once it
 * consumes @coralreefventures/theme, beside the theme.css it generates today.
 */
import type { BrandThemeConfig, BrandTokens } from "../../../src/index";
import tokens from "./brand.tokens.json" with { type: "json" };

export const driftlineTokens: BrandTokens = tokens;

export const driftlineConfig: BrandThemeConfig = {
  colors: {
    // Deep sits at shade 7 and deep-soft at 6; the lighter shades step toward foam, the two darker ones are for
    // pressed states and text on tinted surfaces.
    deep: ["#EEF3F9", "#D9E4F0", "#B7CCE3", "#8FB0D3", "#6A95C2", "#4C7CAE", "deep-soft", "deep", "#204770", "#163453"],
    // Tide sits at shade 5 and tide-soft at 3: the attention color, never a primary action.
    tide: ["#F2F7FC", "#E2ECF7", "#C7DAEF", "tide-soft", "#86AFD9", "tide", "#4A7AB0", "#3B6494", "#2C4C72", "#1E3651"],
  },
  primaryColor: "deep",
  primaryShade: { light: 7, dark: 4 },
  fontVariable: "--driftline-font-sans",
};
