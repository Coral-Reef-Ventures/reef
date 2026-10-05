/** A backslash or any control character (U+0000 to U+001F, U+007F), which a browser's URL parser reads as something else. */
export const unsafe = (value: string): boolean => [...value].some((c) => c === "\\" || c <= "\u001f" || c === "\u007f");

/**
 * *Canonical next*: the same-origin path and query `next` names on `https://<host>`, re-serialised, or null when it
 * names anything else. "Starts with / and not //" is not enough on its own: browsers resolve `/\evil.com` and
 * `/<TAB>/evil.com` to the host evil.com, `/.//evil.com` normalises to `//evil.com`, and Node's setHeader accepts a
 * tab. So the value is refused on sight if it is long or carries a backslash or control character, parsed against the
 * origin, required to stay on it, and re-serialised; only the re-serialised value is ever used. The door and the
 * ticket issuer run the same steps on the same cases.
 */
export const canonicalNext = (next: unknown, host: string): string | null => {
  if (typeof next !== "string" || next.length === 0 || next.length > 512 || unsafe(next)) {
    return null;
  }
  if (!next.startsWith("/") || next.startsWith("//")) {
    return null;
  }
  let origin: string;
  let url: URL;
  try {
    origin = new URL(`https://${host}`).origin;
    url = new URL(next, origin);
  } catch {
    return null;
  }
  if (url.origin !== origin) {
    return null;
  }
  const path = url.pathname + url.search;
  if (path.startsWith("//") || unsafe(path)) {
    return null;
  }
  return path;
};
