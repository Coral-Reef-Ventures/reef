import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import classes from "./Screenshot.module.css";

/**
 * The file a screenshot is captured to, under public/screens: its name (the caption in the copy) as a slug, so
 * "Release v2.3 page: …" is release-v2-3-page-….png. A product's capture script writes the same names.
 */
export const screenshotFile = (name: string) =>
  `${name
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")}.png`;

// A PNG's width and height are the first two fields of its IHDR chunk, at bytes 16–23.
const pngSize = (file: string) => {
  const header = readFileSync(file).subarray(16, 24);
  return { width: header.readUInt32BE(0), height: header.readUInt32BE(4) };
};

type ScreenshotProps = {
  /** The caption from the copy; it names the file and is the image's alt text. */
  name: string;
  /** The placeholder's shape until the image exists, as a CSS aspect ratio. */
  aspect?: string;
  /** Load at once: the screenshot is in the first screen of the page. */
  priority?: boolean;
  /** Where screenshots are kept; the app's public/screens by default. */
  directory?: string;
};

/**
 * A screen from the product. Until public/screens/<name>.png exists (screens are captured by a script, never made
 * by hand), it renders a labeled gray frame with the caption. A server component: it checks for the file at build.
 */
export const Screenshot = ({
  name,
  aspect = "16 / 10",
  priority = false,
  directory = path.join(process.cwd(), "public", "screens"),
}: ScreenshotProps) => {
  const file = screenshotFile(name);
  const onDisk = path.join(directory, file);
  if (existsSync(onDisk)) {
    const { width, height } = pngSize(onDisk);
    return (
      // biome-ignore lint/performance/noImgElement: next/image is a client component, and a static export serves the file as it is.
      <img
        className={classes.image}
        src={`/screens/${file}`}
        alt={name}
        width={width}
        height={height}
        loading={priority ? "eager" : "lazy"}
        fetchPriority={priority ? "high" : "auto"}
        decoding="async"
      />
    );
  }
  return (
    <figure className={classes.frame} style={{ aspectRatio: aspect }} data-screenshot={file}>
      <figcaption className={classes.caption}>{name}</figcaption>
    </figure>
  );
};
