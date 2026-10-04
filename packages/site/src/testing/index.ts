import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

/**
 * The rule both sites hold: the frame every page shares renders as server components only, with no client
 * components, so a page that needs no script ships none. `clientReach` walks an entry's imports within the site and
 * names each "use client" module and each import of a package that is one. A product's test asserts it is empty
 * for the root layout, the 404 page and anything else that must stay script-free, and not empty for a page that
 * uses Mantine, so the walk is known to see.
 */
export const clientPackages = [/^@mantine\//, /^next\/link$/, /^next\/image$/, /^next\/script$/, /^next\/dynamic$/];

export type ClientReachOptions = {
  /** The app's root, which the alias resolves against. */
  root: string;
  /** The import alias for the root; `@/` as both sites have it. */
  alias?: string;
};

const resolveLocal = (specifier: string, from: string, { root, alias = "@/" }: ClientReachOptions) => {
  const base = specifier.startsWith(alias)
    ? path.join(root, specifier.slice(alias.length))
    : path.resolve(path.dirname(from), specifier);
  const stripped = base.replace(/\.tsx?$/, "");
  const candidates = [
    base,
    `${stripped}.ts`,
    `${stripped}.tsx`,
    path.join(base, "index.ts"),
    path.join(base, "index.tsx"),
  ];
  return candidates.find((candidate) => existsSync(candidate) && /\.tsx?$/.test(candidate));
};

/** Every module specifier a file imports, static or dynamic. */
export const importsOf = (file: string) =>
  [...readFileSync(file, "utf8").matchAll(/(?:from\s+|import\s*\(?\s*)["']([^"']+)["']/g)].map(
    (match) => match[1] ?? "",
  );

export const isClientModule = (file: string) => /^\s*["']use client["']/.test(readFileSync(file, "utf8"));

/** Every problem reachable from `entry`: a client module, or an import of a client package. */
export const clientReach = (entry: string, options: ClientReachOptions): string[] => {
  const problems: string[] = [];
  const seen = new Set<string>();
  const visit = (file: string) => {
    seen.add(file);
    const name = path.relative(options.root, file);
    if (isClientModule(file)) {
      problems.push(`${name} is a client module`);
    }
    const specifiers = importsOf(file).filter((specifier) => !specifier.endsWith(".css"));
    const clientImports = specifiers.filter((specifier) => clientPackages.some((pattern) => pattern.test(specifier)));
    problems.push(...clientImports.map((specifier) => `${name} imports ${specifier}`));
    const alias = options.alias ?? "@/";
    const local = specifiers
      .filter((specifier) => specifier.startsWith(".") || specifier.startsWith(alias))
      .map((specifier) => resolveLocal(specifier, file, options))
      .filter((target): target is string => target !== undefined && !seen.has(target));
    for (const target of local) {
      visit(target);
    }
  };
  visit(entry);
  return problems;
};
