import { readdirSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { clientPackages, clientReach, importsOf } from "../src/testing/index";

const src = path.join(import.meta.dirname, "..", "src");

const files = (directory: string): string[] =>
  readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(directory, entry.name);
    return entry.isDirectory()
      ? files(file)
      : /\.tsx?$/.test(entry.name) && !entry.name.endsWith(".d.ts")
        ? [file]
        : [];
  });

/**
 * The rule both sites hold, carried into the package that now holds their frame: nothing here is a client module or
 * imports a client-only package, so a page built on this shell can ship no script at all.
 */
describe("server components only", () => {
  it.each(files(src).map((file) => path.relative(src, file)))("%s reaches no client component", (name) => {
    expect(clientReach(path.join(src, name), { root: src })).toEqual([]);
  });

  it("imports nothing from Mantine: the shell reads the theme's CSS variables and nothing else", () => {
    for (const file of files(src)) {
      expect(
        importsOf(file).filter((specifier) => /^@mantine\//.test(specifier)),
        file,
      ).toEqual([]);
    }
  });
});

describe("the helper the products' tests use", () => {
  const fixtures = path.join(import.meta.dirname, "server-only");

  it("names a client module, and a client package, wherever the walk reaches them", () => {
    expect(clientReach(path.join(fixtures, "app/page.tsx"), { root: fixtures })).toEqual([
      "components/Meter.tsx is a client module",
      "components/Meter.tsx imports @mantine/core",
      "components/Link.tsx imports next/link",
    ]);
  });

  it("follows the alias and relative imports, and sees nothing wrong in a server-only page", () => {
    expect(clientReach(path.join(fixtures, "app/clean.tsx"), { root: fixtures })).toEqual([]);
  });

  it("knows the packages that are client components", () => {
    expect(clientPackages.some((pattern) => pattern.test("@mantine/core"))).toBe(true);
    expect(clientPackages.some((pattern) => pattern.test("next/link"))).toBe(true);
    expect(clientPackages.some((pattern) => pattern.test("next/og"))).toBe(false);
  });
});
