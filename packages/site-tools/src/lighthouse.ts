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
  /**
   * How many more times a page under the threshold is measured; 2 by default, so a page gets three runs and the
   * median of each category's scores. Performance on a shared runner swings a few points between runs of the same
   * page, and one low run fails a gate that three agree would pass; a page every run finds low still fails.
   */
  retries?: number;
  /** The Lighthouse release `pnpm dlx` runs. */
  lighthouseVersion?: string;
  /** The Chrome binary; Playwright's Chromium when it is installed and nothing is given. */
  chrome?: string;
  /** Where progress is written. */
  log?: (line: string) => void;
};

export type PageResult = {
  path: string;
  /** Each category's score, 0 to 1: the median over the page's runs. */
  scores: Record<Category, number>;
  /** The categories under the threshold. */
  low: Category[];
  /** How many times the page was measured. */
  runs: number;
};

/** The median of the scores, which three runs with one low outlier put at the typical run. */
export const median = (values: readonly number[]): number => {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length === 0) {
    return 0;
  }
  return sorted.length % 2 === 1
    ? (sorted[middle] as number)
    : ((sorted[middle - 1] as number) + (sorted[middle] as number)) / 2;
};

/** The categories under the threshold, by the median of each one's scores over the runs so far. */
export const judge = (
  runs: readonly Record<Category, number>[],
  threshold: number,
): { scores: Record<Category, number>; low: Category[] } => {
  const scores = Object.fromEntries(
    categories.map((category) => [category, median(runs.map((run) => run[category]))]),
  ) as Record<Category, number>;
  return { scores, low: categories.filter((category) => scores[category] < threshold) };
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

type Measure = {
  origin: string;
  version: string;
  chrome: string | undefined;
  threshold: number;
  retries: number;
  log: (line: string) => void;
};

const shown = (scores: Record<Category, number>) =>
  categories.map((category) => Math.round(scores[category] * 100)).join("  ");

/** One page's verdict: measured again while under the threshold, up to `retries` more times; the median decides. */
const measurePage = async (pagePath: string, base: string, measure: Measure): Promise<PageResult> => {
  const runs: Record<Category, number>[] = [];
  let verdict = judge(runs, measure.threshold);
  while (runs.length === 0 || (verdict.low.length > 0 && runs.length <= measure.retries)) {
    await audit(`${measure.origin}${pagePath}`, base, measure.version, measure.chrome);
    const report = JSON.parse(await readFile(`${base}.report.json`, "utf8")) as Report;
    const scores = Object.fromEntries(
      categories.map((category) => [category, report.categories[category]?.score ?? 0]),
    ) as Record<Category, number>;
    runs.push(scores);
    verdict = judge(runs, measure.threshold);
    if (verdict.low.length > 0 && runs.length <= measure.retries) {
      measure.log(`again ${pagePath.padEnd(28)} ${shown(scores)}   (run ${runs.length} of ${measure.retries + 1})`);
    }
  }
  const over = runs.length > 1 ? `   (median of ${runs.length} runs)` : "";
  measure.log(`${verdict.low.length ? "FAIL" : "ok  "} ${pagePath.padEnd(28)} ${shown(verdict.scores)}${over}`);
  return { path: pagePath, scores: verdict.scores, low: verdict.low, runs: runs.length };
};

/**
 * The merge gate: Lighthouse on every page, each category at the threshold or above, with Lighthouse's default
 * mobile emulation and throttling, against the export served as the host serves it. A page under the threshold
 * keeps its report; a passing page's is removed.
 */
export const runLighthouse = async (options: LighthouseOptions = {}): Promise<PageResult[]> => {
  const root = options.root ?? "out";
  const reportDir = options.reportDir ?? "lighthouse";
  const threshold = options.threshold ?? 0.9;
  const retries = Math.max(0, options.retries ?? 2);
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
      const result = await measurePage(pagePath, base, { origin, version, chrome, threshold, retries, log });
      results.push(result);
      if (result.low.length === 0) {
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
