/**
 * Streamlane's own CSS variables (its tones, its ink surface, its dark-scheme corrections), copied from
 * packages/theme/src/theme.ts in coral-reef-ventures/streamlane on 2026-10-04 so the fixture test can regenerate its
 * theme.css byte for byte. This is product code and stays Streamlane's: the shared builder takes a resolver like
 * this one as an option and never defines one. Driftline has none.
 */
import { alpha, type CSSVariablesResolver } from "@mantine/core";

import { streamlaneConfig, streamlaneTokens } from "./theme";

const brand = streamlaneTokens.color;
const ink = streamlaneConfig.colors.ink ?? [];

const tones = ["good", "attention", "bad", "closed"] as const;
type Tone = (typeof tones)[number];

const toneHues: Record<Exclude<Tone, "closed">, "teal" | "signal" | "red"> = {
  good: "teal",
  attention: "signal",
  bad: "red",
};

const lightTones: Record<Tone, [string, string, string]> = {
  good: ["teal-0", "teal-8", "teal-9"],
  attention: ["signal-0", "signal-7", "signal-8"],
  bad: ["red-0", "red-6", "red-9"],
  closed: ["gray-1", "gray-6", "gray-7"],
};

const shade = (name: string) => `var(--mantine-color-${name})`;

const toneColors = (scheme: "light" | "dark", tone: Tone, colors: Record<string, readonly string[]>) => {
  if (scheme === "light") {
    const [tint, edge, text] = lightTones[tone];
    return { tint: shade(tint), edge: shade(edge), text: shade(text) };
  }
  if (tone === "closed") {
    return { tint: shade("dark-5"), edge: shade("dark-2"), text: shade("dark-1") };
  }
  const hue = toneHues[tone];
  return { tint: alpha(colors[hue]?.[5] ?? "", 0.2), edge: shade(`${hue}-5`), text: shade(`${hue}-3`) };
};

const toneVariables = (scheme: "light" | "dark", colors: Record<string, readonly string[]>): Record<string, string> =>
  Object.fromEntries(
    tones.flatMap((tone) =>
      Object.entries(toneColors(scheme, tone, colors)).map(([part, value]) => [
        `--streamlane-tone-${tone}-${part}`,
        value,
      ]),
    ),
  );

const inkSurface = (scheme: "light" | "dark"): Record<string, string> => ({
  "--streamlane-ink-surface": shade(scheme === "light" ? "ink-8" : "ink-9"),
  "--streamlane-on-ink": scheme === "light" ? (brand.paper ?? "") : shade("ink-0"),
  "--streamlane-on-ink-dimmed": shade(scheme === "light" ? "ink-2" : "ink-3"),
  "--streamlane-on-ink-hover": alpha(brand.white ?? "", 0.08),
  "--streamlane-on-ink-active": alpha(brand.white ?? "", 0.12),
  "--streamlane-on-ink-bar": brand.paper ?? "",
  "--streamlane-sidebar": "var(--streamlane-ink-surface)",
});

export const streamlaneResolver: CSSVariablesResolver = (resolved) => ({
  variables: {},
  light: {
    ...inkSurface("light"),
    "--streamlane-lockup": brand.ink ?? "",
    "--streamlane-title": shade("ink-8"),
    "--streamlane-selected": shade("ink-0"),
    "--streamlane-selected-edge": shade("ink-5"),
    ...toneVariables("light", resolved.colors),
  },
  dark: {
    ...inkSurface("dark"),
    "--streamlane-lockup": brand.white ?? "",
    "--streamlane-title": shade("ink-1"),
    "--mantine-color-ink-light": alpha(ink[4] ?? "", 0.25),
    "--mantine-color-ink-light-hover": alpha(ink[4] ?? "", 0.32),
    "--streamlane-selected": "var(--mantine-color-ink-light)",
    "--streamlane-selected-edge": shade("ink-4"),
    ...toneVariables("dark", resolved.colors),
    ...Object.fromEntries(
      Object.values(toneHues).flatMap((hue) => [
        [`--mantine-color-${hue}-light`, alpha(resolved.colors[hue]?.[5] ?? "", 0.2)],
        [`--mantine-color-${hue}-light-hover`, alpha(resolved.colors[hue]?.[5] ?? "", 0.27)],
      ]),
    ),
    "--mantine-color-gray-light": shade("dark-5"),
    "--mantine-color-gray-light-hover": shade("dark-4"),
  },
});
