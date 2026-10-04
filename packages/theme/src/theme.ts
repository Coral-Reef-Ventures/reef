import { createTheme, DEFAULT_THEME, type MantineColorsTuple, type MantineThemeOverride } from "@mantine/core";

/**
 * A product's brand tokens (its `packages/brand/brand.tokens.json`): the name and the colors are all this package
 * reads. The file carries more (the mark's geometry, the lockup's proportions), which the product's own components
 * read and this package leaves alone.
 */
export type BrandTokens = {
  name: string;
  color: Record<string, string>;
};

/** Ten shades, each a hex color or the name of a brand color (`"ink"`, `"signal-soft"`), the brand's fixed points. */
export type Scale = readonly [string, string, string, string, string, string, string, string, string, string];

export type BrandThemeConfig = {
  /** Mantine's ten-shade scales, by the name a component asks for (`c="ink"`). */
  colors: Record<string, Scale>;
  /** The scale primary actions are filled with. */
  primaryColor: string;
  /** The shade of the primary scale a filled control takes, per scheme. */
  primaryShade: { light: MantineShade; dark: MantineShade };
  /**
   * The CSS variable an app sets when it loads a web font (`--streamlane-font-sans`); Mantine's system stack is the
   * fallback, so an app that sets nothing keeps the stack it had.
   */
  fontVariable: `--${string}`;
  /** Mantine's black, the text color in the light scheme: a brand color's name or a hex. Mantine's own when unset. */
  black?: string;
};

type MantineShade = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;

/** A brand color by name, or a hex as it is; an unknown name is a mistake in the config, not a color. */
export const brandColor = (tokens: BrandTokens, value: string): string => {
  if (value.startsWith("#")) {
    return value;
  }
  const color = tokens.color[value];
  if (color === undefined) {
    throw new Error(`${tokens.name}'s brand has no color named "${value}"`);
  }
  return color;
};

/** Mantine's system font stack behind the app's variable. */
export const brandFontFamily = (variable: `--${string}`) => `var(${variable}, ${DEFAULT_THEME.fontFamily})`;

/**
 * A product's theme: its scales with the brand colors at their fixed points, the primary color and shade, and the
 * font behind the app's variable, everything that becomes a CSS variable. It imports no stylesheet, so `themeCss`
 * can generate the stylesheet outside a bundler, and a product adds its components' class names on top (as
 * Streamlane's product theme does) without changing a variable.
 */
export const createBrandTheme = (tokens: BrandTokens, config: BrandThemeConfig): MantineThemeOverride => {
  const colors = Object.fromEntries(
    Object.entries(config.colors).map(([name, scale]) => [
      name,
      scale.map((shade) => brandColor(tokens, shade)) as unknown as MantineColorsTuple,
    ]),
  );
  if (!(config.primaryColor in colors)) {
    throw new Error(`primaryColor "${config.primaryColor}" is not one of the theme's scales`);
  }
  const fontFamily = brandFontFamily(config.fontVariable);
  return createTheme({
    colors,
    ...(config.black !== undefined && { black: brandColor(tokens, config.black) }),
    primaryColor: config.primaryColor,
    primaryShade: config.primaryShade,
    fontFamily,
    headings: { fontFamily, fontWeight: "700" },
  });
};
