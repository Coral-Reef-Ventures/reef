import { spawn } from "node:child_process";
import { mkdir, readFile, rm } from "node:fs/promises";
import path from "node:path";

import { serve } from "./serve.ts";

export const categories = ["performance", "accessibility", "best-practices", "seo"] as const;
export type Category = (typeof categories)[number];

export type LighthouseOptions = {
  /** The static export; `out` by default. */
  root?: string;
  /** Where a failing page's report is left; `lighthouse` by default. */
  reportDir?: string;
  /** The port the export is served on for the run; a free one when not given, so a busy 3160 cannot end the run. */
  port?: number;
  /** The least score, 0 to 1, every category must reach on every page; 0.9 by default. */
  threshold?: number;
  /** The pages to audit; every page in the export's sitemap when none are given. */
  paths?: readonly string[];
  /** The Lighthouse release `pnpm dlx` runs. */
  lighthouseVersion?: string;
  /** The Chrome binary; Playwright's Chromium when it is installed and nothing is given. */
  chrome?: string;
  /** Where progress is written. */
  log?: (line: string) => void;
};

export type PageResult = {
  path: string;
  /** Each category's score, 0 to 1. */
  scores: Record<Category, number>;
  /** The categories under the threshold. */
  low: Category[];
};

type Report = { categories: Record<string, { score: number | null } | undefined> };

/** Every page's path from the export's sitemap, whatever origin the sitemap names. */
export const pagesFromSitemap = async (root: string): Promise<string[]> => {
  const sitemap = await readFile(path.join(root, "sitemap.xml"), "utf8");
  return [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => new URL(match[1] ?? "").pathname);
};

/** The report file a page's audit is written to: `/` is `home`, `/docs/security/` is `docs-security`. */
export const reportBase = (reportDir: string, pagePath: string) =>
  path.join(reportDir, pagePath.replace(/^\/|\/$/g, "").replaceAll("/", "-") || "home");

/**
 * Playwright's Chromium, when the site has Playwright for its screen tests. Resolved at run time rather than
 * imported, so the tool has no dependency on it.
 */
const playwrightChromium = async (): Promise<string | undefined> => {
  const specifier = "@playwright/test";
  try {
    const playwright = (await import(specifier)) as { chromium: { executablePath: () => string } };
    return playwright.chromium.executablePath();
  } catch {
    return undefined;
  }
};

/**
 * One Lighthouse run; writes <base>.report.json and <base>.report.html. Lighthouse is not a dependency: it bundles
 * axe-core (MPL-2.0), which is outside the family's licence allowlist, so its command line runs through `pnpm dlx`,
 * pinned.
 */
const audit = (url: string, base: string, version: string, chrome: string | undefined) =>
  new Promise<void>((resolve, reject) => {
    const run = spawn(
      "pnpm",
      [
        "dlx",
        `lighthouse@${version}`,
        url,
        `--only-categories=${categories.join(",")}`,
        "--output=json",
        "--output=html",
        `--output-path=${base}`,
        "--chrome-flags=--headless=new --no-sandbox",
        "--quiet",
      ],
      { stdio: ["ignore", "ignore", "inherit"], env: { ...process.env, ...(chrome && { CHROME_PATH: chrome }) } },
    );
    run.on("error", reject);
    run.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`Lighthouse exited with ${code} on ${url}`))));
  });

/**
 * The merge gate: Lighthouse on every page, each category at the threshold or above, with Lighthouse's default
 * mobile emulation and throttling, against the export served as the host serves it. A page under the threshold
 * keeps its report; a passing page's is removed.
 */
export const runLighthouse = async (options: LighthouseOptions = {}): Promise<PageResult[]> => {
  const root = options.root ?? "out";
  const reportDir = options.reportDir ?? "lighthouse";
  const threshold = options.threshold ?? 0.9;
  const version = options.lighthouseVersion ?? "13.5.0";
  const log = options.log ?? console.log;
  const paths = options.paths?.length ? options.paths : await pagesFromSitemap(root);
  const chrome = options.chrome ?? (await playwrightChromium());
  const { server, url: origin } = await serve({ root, port: options.port ?? 0 });
  const results: PageResult[] = [];
  try {
    await mkdir(reportDir, { recursive: true });
    for (const pagePath of paths) {
      const base = reportBase(reportDir, pagePath);
      await audit(`${origin}${pagePath}`, base, version, chrome);
      const report = JSON.parse(await readFile(`${base}.report.json`, "utf8")) as Report;
      const scores = Object.fromEntries(
        categories.map((category) => [category, report.categories[category]?.score ?? 0]),
      ) as Record<Category, number>;
      const low = categories.filter((category) => scores[category] < threshold);
      results.push({ path: pagePath, scores, low });
      const shown = categories.map((category) => Math.round(scores[category] * 100)).join("  ");
      log(`${low.length ? "FAIL" : "ok  "} ${pagePath.padEnd(28)} ${shown}`);
      if (low.length === 0) {
        await rm(`${base}.report.json`);
        await rm(`${base}.report.html`);
      }
    }
  } finally {
    server.close();
  }
  log(`\n${categories.join(", ")}; ${paths.length} pages, threshold ${threshold * 100}`);
  return results;
};
