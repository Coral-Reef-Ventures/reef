/**
 * Every package as a consumer imports it, bundled by the smoke test with esbuild the way Next (transpilePackages),
 * tsx, Vitest or Amplify's function bundler would: three of the four ship TypeScript source, which Node will not
 * run from node_modules on its own. Each package is used once, and the results are exported for consumer.mjs to
 * check under plain Node.
 */
import { createContactHandler } from "@coralreefventures/contact";
import { createSite, page, Section, Status } from "@coralreefventures/site";
import { clientPackages } from "@coralreefventures/site/testing";
import { createStaticServer, pagesFromSitemap, serve } from "@coralreefventures/site-tools";
import { createBrandTheme, themeCss } from "@coralreefventures/theme";
import { renderToStaticMarkup } from "react-dom/server";

// theme
const theme = createBrandTheme(
  { name: "Consumer", color: { ground: "#102030" } },
  {
    colors: { ground: ["#eee", "#ddd", "#ccc", "#bbb", "#aaa", "#999", "#888", "#777", "ground", "#000"] },
    primaryColor: "ground",
    primaryShade: { light: 8, dark: 5 },
    fontVariable: "--consumer-font",
  },
);
export const css = themeCss(theme);

// contact
export const contact = createContactHandler({
  fields: { name: 10, email: 320, message: 100 },
  required: ["name", "email"],
  email: "email",
});

// site-tools
export { createStaticServer, pagesFromSitemap, serve };

// site
const site = createSite({
  name: "Consumer",
  url: "https://consumer.example",
  description: "A consumer of the shell.",
  nav: [{ key: "product", label: "Product", href: "/product/" }],
  lockup: <span>Consumer</span>,
  actions: [{ label: "Start", href: "/start/", kind: "primary" }],
  footer: { maker: <>Consumer · made by nobody</>, links: [], trademarks: ["Jira"] },
  cards: { "/": { headline: "Hello" } },
  socialCard: { background: "#000", text: "#fff", muted: "#eee", accent: "#f90", mark: <svg aria-hidden="true" /> },
  icons: { icon: [] },
  themeColor: "#000",
});

export const html = renderToStaticMarkup(
  <site.SiteFrame active="product">
    <Section>
      <h1 className={page.display}>Hello</h1>
      <Status tone="attention">Later</Status>
    </Section>
  </site.SiteFrame>,
);
export const title = site.pageMetadata({ title: "Product", description: "d", path: "/product/" }).title;
export const baseCss = import.meta.resolve("@coralreefventures/site/base.css");
export const knowsMantine = clientPackages.some((pattern) => pattern.test("@mantine/core"));
