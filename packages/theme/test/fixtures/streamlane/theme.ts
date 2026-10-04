/**
 * Streamlane's theme as its packages/theme/src/theme.ts builds it (coral-reef-ventures/streamlane, read 2026-10-04),
 * written against this package's builder. A fixture: the scales, the primary color and shade and the font variable
 * are what Streamlane's theme.ts becomes once it consumes @coralreefventures/theme, and the committed theme.css
 * beside this file is what that theme.ts generates today. Nothing here is shared code.
 */
import type { BrandThemeConfig, BrandTokens } from "../../../src/index";
import tokens from "./brand.tokens.json" with { type: "json" };

export const streamlaneTokens: BrandTokens = tokens;

export const streamlaneConfig: BrandThemeConfig = {
  colors: {
    // Ink sits at shade 8 and ink-soft at 7; the lighter shades step toward paper for hovers, fills, and borders.
    ink: ["#EEF4F4", "#D8E5E5", "#B3CBCC", "#8BAFB0", "#669496", "#4A7C7E", "#336567", "ink-soft", "ink", "#0B2728"],
    // Signal sits at shade 5 and signal-soft at 3: the dot and the one attention color, never a primary action.
    signal: [
      "#FEF6EA",
      "#FCEBD0",
      "#FADAA5",
      "signal-soft",
      "#F4B658",
      "signal",
      "#DB9425",
      "#B97A17",
      "#94610F",
      "#704908",
    ],
  },
  black: "text",
  primaryColor: "ink",
  primaryShade: { light: 8, dark: 5 },
  fontVariable: "--streamlane-font-sans",
};
