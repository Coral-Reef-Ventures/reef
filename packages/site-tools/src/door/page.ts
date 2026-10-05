import { createHash } from "node:crypto";

/**
 * The coming-soon page: what a locked site answers a page load with when the visitor holds no session. It is the
 * gate's own HTML and carries nothing of the site: one inline stylesheet, the mark as a data URI, no script and no
 * request to anywhere. It is the same bytes for every path but one, the canonical next its sign-in link carries.
 */

/** An image the page shows, carried in gate.config.json as base64 so the page needs no request for it. */
export type PageImage = { type: "image/svg+xml" | "image/png"; data: string };

/** gate.config.json's `page`: everything a site says about its coming-soon page. All optional. */
export type PageConfigFile = {
  /** The product's display name, as the page writes it. The site id, capitalized, by default. */
  name?: string;
  /** The mark, shown beside the name. None by default, and the name stands alone. */
  mark?: PageImage;
  /** The mark for a dark scheme. Without it the dark scheme shows `mark` on a light tile. */
  markDark?: PageImage;
  /** The button's color in the light scheme, `#rrggbb`. */
  accent?: string;
  /** The button's color in the dark scheme, `#rrggbb`. */
  accentDark?: string;
};

export type PageConfig = Required<Pick<PageConfigFile, "name" | "accent" | "accentDark">> &
  Pick<PageConfigFile, "mark" | "markDark">;

/** The page's own surfaces; a site's accent has to stand out from these. */
export const surfaces = {
  light: { background: "#ffffff", text: "#1a1f24", muted: "#4b5560" },
  dark: { background: "#11161b", text: "#e6e9ec", muted: "#a9b3bc" },
};

export const defaultAccent = "#1f2933";
export const defaultAccentDark = "#d5dbe1";
/** A mark larger than this is not a mark; the page is answered to every visitor without a session. */
export const maxMarkBytes = 64 * 1024;

const hexColor = /^#[0-9a-f]{6}$/i;
const base64 = /^[A-Za-z0-9+/]+={0,2}$/;

/** WCAG 2's relative luminance of `#rrggbb`. */
export const luminance = (hex: string): number => {
  const channel = (offset: number) => {
    const value = Number.parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
};

/** WCAG 2's contrast ratio between two `#rrggbb` colors, 1 to 21. */
export const contrast = (a: string, b: string): number => {
  const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (high + 0.05) / (low + 0.05);
};

/**
 * The button's text on an accent: white or black, whichever reads better. One of the two always reaches 4.5:1 (the
 * worst accent, where they tie, gives 4.58), so the label meets AA whatever color a site picks. Not a softer near-black:
 * #111111 ties at 4.35, under the line.
 */
export const textOn = (accent: string): string =>
  contrast(accent, "#ffffff") >= contrast(accent, "#000000") ? "#ffffff" : "#000000";

/** The site id as a display name: `driftline` becomes `Driftline`. */
export const defaultName = (site: string): string => site.charAt(0).toUpperCase() + site.slice(1);

const checkImage = (value: unknown, label: string): PageImage | undefined => {
  if (value === undefined) return undefined;
  const image = value as Partial<PageImage> | null;
  if (image?.type !== "image/svg+xml" && image?.type !== "image/png") {
    throw new Error(`the page's ${label} must be an SVG or a PNG`);
  }
  if (typeof image.data !== "string" || !base64.test(image.data)) {
    throw new Error(`the page's ${label} is not base64`);
  }
  if (Buffer.byteLength(image.data, "base64") > maxMarkBytes) {
    throw new Error(`the page's ${label} is over ${maxMarkBytes} bytes`);
  }
  return { type: image.type, data: image.data };
};

const checkColor = (value: unknown, fallback: string, label: string, surface: string): string => {
  if (value === undefined) return fallback;
  if (typeof value !== "string" || !hexColor.test(value))
    throw new Error(`the page's ${label} is not #rrggbb: ${value}`);
  // WCAG 1.4.11: the button's edge and the focus ring are drawn in the accent, so it must reach 3:1 on the page.
  const ratio = contrast(value, surface);
  if (ratio < 3) {
    throw new Error(`the page's ${label} ${value} is ${ratio.toFixed(2)}:1 on ${surface}; it needs 3:1`);
  }
  return value.toLowerCase();
};

/**
 * Checks gate.config.json's `page` and fills in the defaults, or throws naming what is wrong. With no `page` at all
 * the result still renders a correct page: the site id as the name, no mark, and a neutral button.
 */
export const parsePageConfig = (value: unknown, site: string): PageConfig => {
  if (value !== undefined && (typeof value !== "object" || value === null)) {
    throw new Error("the page configuration is not an object");
  }
  const file = (value ?? {}) as PageConfigFile;
  const name = file.name ?? defaultName(site);
  if (typeof name !== "string" || name.trim() !== name || name.length === 0 || name.length > 60) {
    throw new Error(`the page's name must be 1 to 60 characters with no space at either end: ${JSON.stringify(name)}`);
  }
  if ([...name].some((c) => c <= "\u001f" || c === "\u007f"))
    throw new Error("the page's name has a control character");
  const mark = checkImage(file.mark, "mark");
  const markDark = checkImage(file.markDark, "dark mark");
  if (markDark && !mark) throw new Error("the page has a dark mark but no mark");
  return {
    name,
    accent: checkColor(file.accent, defaultAccent, "accent", surfaces.light.background),
    accentDark: checkColor(file.accentDark, defaultAccentDark, "dark accent", surfaces.dark.background),
    ...(mark && { mark }),
    ...(markDark && { markDark }),
  };
};

const escapeHtml = (value: string) =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const dataUri = (image: PageImage) => `data:${image.type};base64,${image.data}`;

/** The stylesheet, which depends only on the configuration, so its hash is fixed for the gate's life. */
const stylesheet = (page: PageConfig): string => {
  const { light, dark } = surfaces;
  // The dark scheme shows the dark mark if there is one; otherwise the one mark, on a light tile so a dark-ink mark
  // stays visible.
  const darkMark = page.markDark
    ? ".mark-light{display:none}.mark-dark{display:block}"
    : `.mark-light{background:${light.background};border-radius:10px;padding:4px}`;
  return [
    ":root{color-scheme:light dark;",
    `--bg:${light.background};--text:${light.text};--muted:${light.muted};`,
    `--accent:${page.accent};--on-accent:${textOn(page.accent)}}`,
    "@media (prefers-color-scheme:dark){:root{",
    `--bg:${dark.background};--text:${dark.text};--muted:${dark.muted};`,
    `--accent:${page.accentDark};--on-accent:${textOn(page.accentDark)}}${darkMark}}`,
    "*{box-sizing:border-box}",
    "html{-webkit-text-size-adjust:100%;text-size-adjust:100%}",
    "body{margin:0;min-height:100vh;min-height:100dvh;display:flex;align-items:center;justify-content:center;",
    "padding:48px 24px;background:var(--bg);color:var(--text);",
    'font:400 1.0625rem/1.55 system-ui,-apple-system,"Segoe UI",Roboto,"Noto Sans",sans-serif}',
    "main{width:100%;max-width:34rem}",
    ".lockup{display:flex;align-items:center;gap:12px;margin:0 0 40px;font-weight:700;font-size:1.25rem;",
    "letter-spacing:-0.01em}",
    ".lockup img{display:block;height:48px;width:auto;max-width:96px}",
    ".mark-dark{display:none}",
    "h1{margin:0 0 12px;font-size:clamp(1.75rem,6vw,2.5rem);line-height:1.15;letter-spacing:-0.02em;",
    "font-weight:700;overflow-wrap:anywhere}",
    ".lede{margin:0 0 32px;color:var(--muted)}",
    ".actions{display:flex;flex-wrap:wrap;align-items:center;gap:16px 24px}",
    ".button{display:inline-flex;align-items:center;min-height:48px;padding:12px 20px;border-radius:8px;",
    "background:var(--accent);color:var(--on-accent);font-weight:600;text-decoration:none;",
    "border:2px solid var(--accent)}",
    ".button:hover{text-decoration:underline;text-underline-offset:3px}",
    ".link{color:var(--text);font-weight:600;text-decoration:underline;text-decoration-color:var(--accent);",
    "text-decoration-thickness:2px;text-underline-offset:4px;padding:12px 0}",
    ".link:hover{text-decoration-thickness:3px}",
    "a:focus-visible{outline:3px solid var(--accent);outline-offset:3px}",
    "@media (max-width:480px){body{padding:32px 16px;align-items:flex-start}.lockup{margin-bottom:32px}}",
  ].join("");
};

export type ComingSoon = {
  /** The page for one canonical next: the only part that differs between paths. */
  html: (next: string) => string;
  /** The Content-Security-Policy that allows exactly what the page uses. */
  csp: string;
};

/**
 * Builds the coming-soon page for a site once, as the gate starts. `door` is the door's origin, which the "Get
 * involved" link points into; `site` is the id the door knows the site by.
 */
export const comingSoon = (page: PageConfig, door: string, site: string): ComingSoon => {
  const css = stylesheet(page);
  const styleHash = createHash("sha256").update(css).digest("base64");
  const name = escapeHtml(page.name);
  const getInvolved = escapeHtml(`${door}/get-involved/?${new URLSearchParams({ site })}`);
  const marks = page.mark
    ? `<img class="mark-light" src="${dataUri(page.mark)}" alt="">` +
      (page.markDark ? `<img class="mark-dark" src="${dataUri(page.markDark)}" alt="">` : "")
    : "";
  const csp = [
    "default-src 'none'",
    `style-src 'sha256-${styleHash}'`,
    ...(page.mark ? ["img-src data:"] : []),
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
  ].join("; ");
  const head =
    '<!doctype html><html lang="en"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width, initial-scale=1">' +
    '<meta name="color-scheme" content="light dark">' +
    '<meta name="robots" content="noindex, nofollow">' +
    '<meta name="referrer" content="strict-origin-when-cross-origin">' +
    `<title>${name} is coming soon</title><style>${css}</style></head>`;
  const before =
    `<body><main><p class="lockup">${marks}<span>${name}</span></p>` +
    `<h1>${name} is coming soon.</h1><p class="lede">Open for now to invited guests.</p>` +
    '<p class="actions"><a class="button" href="';
  const after = `">Have an invitation? Sign in</a><a class="link" href="${getInvolved}">Get involved</a></p></main></body></html>`;
  return {
    html: (next) => `${head}${before}${escapeHtml(`/_door/signin?${new URLSearchParams({ next })}`)}${after}`,
    csp,
  };
};
