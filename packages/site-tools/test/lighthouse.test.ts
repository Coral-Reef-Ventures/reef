import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { categories, judge, median, pagesFromSitemap, parseShard, reportBase, shardOf } from "../src/lighthouse.ts";

describe("pagesFromSitemap", () => {
  it("reads every page's path, whatever origin the sitemap names", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "reef-sitemap-"));
    try {
      await writeFile(
        path.join(root, "sitemap.xml"),
        [
          '<?xml version="1.0" encoding="UTF-8"?>',
          '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
          "<url><loc>https://streamlane.app/</loc></url>",
          "<url><loc>https://streamlane.app/pricing/</loc></url>",
          "<url><loc>https://driftline.app/docs/security/</loc></url>",
          "</urlset>",
        ].join("\n"),
      );
      expect(await pagesFromSitemap(root)).toEqual(["/", "/pricing/", "/docs/security/"]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe("reportBase", () => {
  it("names a page's report after its path, and the home page home", () => {
    expect(reportBase("lighthouse", "/")).toBe(path.join("lighthouse", "home"));
    expect(reportBase("lighthouse", "/pricing/")).toBe(path.join("lighthouse", "pricing"));
    expect(reportBase("reports", "/docs/concepts/teams/")).toBe(path.join("reports", "docs-concepts-teams"));
  });
});

describe("the gate", () => {
  it("measures the four categories the sites hold at 90", () => {
    expect(categories).toEqual(["performance", "accessibility", "best-practices", "seo"]);
  });
});

describe("the median over a page's runs", () => {
  it("is the middle score, or the mean of the two middle ones, and 0 with no run", () => {
    expect(median([0.89, 0.92, 0.91])).toBe(0.91);
    expect(median([0.88, 0.9])).toBe(0.89);
    expect(median([0.95])).toBe(0.95);
    expect(median([])).toBe(0);
  });

  it("lets one low run pass when the other two clear the threshold, and fails a page every run finds low", () => {
    const run = (performance: number) => ({ performance, accessibility: 1, "best-practices": 1, seo: 1 });
    expect(judge([run(0.89), run(0.92), run(0.91)], 0.9).low).toEqual([]);
    expect(judge([run(0.89), run(0.92), run(0.91)], 0.9).scores.performance).toBe(0.91);
    expect(judge([run(0.88), run(0.89), run(0.91)], 0.9).low).toEqual(["performance"]);
    expect(judge([run(0.89)], 0.9).low).toEqual(["performance"]);
  });
});

describe("a category's own floor", () => {
  it("stands in for the threshold for that category alone", () => {
    const run = (performance: number) => ({ performance, accessibility: 0.9, "best-practices": 1, seo: 1 });
    expect(judge([run(0.86)], 0.9, { performance: 0.85 }).low).toEqual([]);
    expect(judge([run(0.84)], 0.9, { performance: 0.85 }).low).toEqual(["performance"]);
    expect(judge([{ ...run(0.95), accessibility: 0.89 }], 0.9, { performance: 0.85 }).low).toEqual(["accessibility"]);
  });
});

describe("a shard of the pages", () => {
  const pages = ["/", "/a/", "/b/", "/c/", "/d/", "/e/", "/f/"];

  it("takes every count-th page from the index-th, so the shards together are every page once", () => {
    expect(shardOf(pages, { index: 1, count: 3 })).toEqual(["/", "/c/", "/f/"]);
    expect(shardOf(pages, { index: 2, count: 3 })).toEqual(["/a/", "/d/"]);
    expect(shardOf(pages, { index: 3, count: 3 })).toEqual(["/b/", "/e/"]);
    const all = [1, 2, 3].flatMap((index) => shardOf(pages, { index, count: 3 }));
    expect([...all].sort()).toEqual([...pages].sort());
    expect(shardOf(pages, { index: 1, count: 1 })).toEqual(pages);
  });

  it("reads 2/3, and refuses an index outside 1 to the count or anything but two whole numbers", () => {
    expect(parseShard("2/3")).toEqual({ index: 2, count: 3 });
    expect(parseShard(" 1/1 ")).toEqual({ index: 1, count: 1 });
    for (const bad of ["0/3", "4/3", "1/0", "2", "a/b", "1.5/3", "-1/3", ""]) {
      expect(() => parseShard(bad), bad).toThrow(/--shard takes <index>\/<count>/);
    }
  });
});
