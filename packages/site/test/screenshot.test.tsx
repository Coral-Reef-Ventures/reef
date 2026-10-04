import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { Screenshot, screenshotFile } from "../src/Screenshot";

/** A PNG header: signature, IHDR length and type, then width 1280 and height 800 big-endian. */
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]),
  Buffer.from("IHDR"),
  Buffer.from([0, 0, 0x05, 0x00, 0, 0, 0x03, 0x20]),
]);

let screens: string;

beforeAll(async () => {
  screens = await mkdtemp(path.join(tmpdir(), "reef-screens-"));
  await writeFile(path.join(screens, "task-page-delivery-section.png"), png);
});

afterAll(() => rm(screens, { recursive: true, force: true }));

describe("screenshotFile", () => {
  it("slugs the caption", () => {
    expect(screenshotFile("Release v2.3 page: tasks → PRs")).toBe("release-v2-3-page-tasks-prs.png");
    expect(screenshotFile("  Café  ")).toBe("cafe.png");
  });
});

describe("Screenshot", () => {
  it("renders a labeled frame until the file exists", () => {
    const html = renderToStaticMarkup(<Screenshot name="Release page" aspect="16 / 9" directory={screens} />);
    expect(html).toBe(
      '<figure class="frame" style="aspect-ratio:16 / 9" data-screenshot="release-page.png"><figcaption class="caption">Release page</figcaption></figure>',
    );
  });

  it("renders the image with its size read from the PNG once it exists, eager when it is first on the page", () => {
    const html = renderToStaticMarkup(<Screenshot name="Task page, Delivery section" directory={screens} priority />);
    // React 19 preloads an eager, high-priority image itself; the link before the img is its doing.
    expect(html).toBe(
      '<link rel="preload" as="image" href="/screens/task-page-delivery-section.png" fetchPriority="high"/>' +
        '<img class="image" src="/screens/task-page-delivery-section.png" alt="Task page, Delivery section" width="1280" height="800" loading="eager" fetchPriority="high" decoding="async"/>',
    );
    const lazy = renderToStaticMarkup(<Screenshot name="Task page, Delivery section" directory={screens} />);
    expect(lazy).toContain('loading="lazy" fetchPriority="auto"');
  });
});
