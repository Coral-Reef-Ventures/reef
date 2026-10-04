import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { categories, pagesFromSitemap, reportBase } from "../src/lighthouse.ts";

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
