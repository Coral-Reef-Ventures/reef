# @coralreefventures/theme

Builds a product's Mantine theme from its brand tokens, and generates the stylesheet of CSS variables that
`MantineProvider` would inject for it, so a page that renders as server components only still gets the theme.

Both Coral Reef sites carried the same `theme.ts` and `generate-css.ts`, differing only in their scales, primary
color and font variable. Each product's `packages/theme` is now its tokens file plus a call into this package, and
the stylesheet it generates is byte-identical to what it generated before: a test here runs the builder over both
products' token files and compares the output with their committed `theme.css`.

```ts
// packages/theme/src/theme.ts in a product
import { createBrandTheme } from "@coralreefventures/theme";
import tokens from "@streamlane/brand/tokens";

export const brand = tokens.color;

export const theme = createBrandTheme(tokens, {
  colors: {
    // Ten shades, each a hex or the name of a brand color: ink is shade 8, ink-soft shade 7.
    ink: ["#EEF4F4", "#D8E5E5", "#B3CBCC", "#8BAFB0", "#669496", "#4A7C7E", "#336567", "ink-soft", "ink", "#0B2728"],
    signal: ["#FEF6EA", "#FCEBD0", "#FADAA5", "signal-soft", "#F4B658", "signal", "#DB9425", "#B97A17", "#94610F", "#704908"],
  },
  black: "text",
  primaryColor: "ink",
  primaryShade: { light: 8, dark: 5 },
  fontVariable: "--streamlane-font-sans",
});
```

```ts
// packages/theme/scripts/generate-css.ts in a product
import { themeCss, writeThemeCss } from "@coralreefventures/theme";
import { cssVariablesResolver, theme } from "../src/theme";

await writeThemeCss(
  new URL("../theme.css", import.meta.url),
  themeCss(theme, { generatedBy: "packages/theme (pnpm --filter @streamlane/theme generate)", resolver: cssVariablesResolver }),
);
```

`resolver` is a product's own `CSSVariablesResolver` (Streamlane's tones and ink surface) and stays in the product;
Driftline passes none. `generatedBy` is the first line of the stylesheet, which tells a reader what to run.

## What it exports

- `createBrandTheme(tokens, config)`: the `MantineThemeOverride`. `config.colors` are the scales, `primaryColor` and
  `primaryShade` as Mantine takes them, `fontVariable` the CSS variable an app sets to its web font (Mantine's system
  stack is the fallback), and `black` the light-scheme text color, each color a hex or a brand color's name.
- `themeCss(theme, { generatedBy?, resolver? })`: the stylesheet.
- `writeThemeCss(file, css)`: writes it.
- `brandColor(tokens, nameOrHex)`, `brandFontFamily(variable)`, and the types `BrandTokens`, `BrandThemeConfig`,
  `Scale`, `ThemeCssOptions`.

## Installing

This package ships TypeScript source and `@mantine/core` 9.6.3 is a peer. The code that imports it has to be
transpiled: a product's theme package runs under `tsx` and Vitest and is bundled by Next through
`transpilePackages`, all of which handle it. Add `@coralreefventures/theme` to `transpilePackages` where the product
theme already is.
