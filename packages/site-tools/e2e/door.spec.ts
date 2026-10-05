import { createPrivateKey } from "node:crypto";
import { readFileSync } from "node:fs";

import { type APIResponse, type BrowserContext, expect, type Page, test } from "@playwright/test";

import { makeKey, signTicket, type TestKey, tamper, ticketClaims } from "../test/door-fixtures.ts";
import { alphaPage } from "./global-setup.ts";

type Setup = { door: string; alpha: string; beta: string; kid: string; keyFile: string; files: string[] };
const setup = JSON.parse(process.env.DOOR_E2E ?? "null") as Setup;
const key: TestKey = { kid: setup.kid, privateKey: createPrivateKey(readFileSync(setup.keyFile)), jwk: {} };
const alphaHost = new URL(setup.alpha).host;
const session = "__Host-crv_door";
const state = "__Host-crv_door_state";
const seen = "__Host-crv_door_seen";

/** Every request in these tests that reaches a gate, which must each say no-store or private. */
const watchCaching = (page: Page) => {
  const seen: { url: string; cacheControl: string | undefined }[] = [];
  page.on("response", (response) => {
    const url = new URL(response.url());
    if (url.origin === setup.alpha || url.origin === setup.beta) {
      seen.push({ url: response.url(), cacheControl: response.headers()["cache-control"] });
    }
  });
  return seen;
};

const cookieNamed = async (context: BrowserContext, origin: string, name: string) =>
  (await context.cookies(origin)).find((cookie) => cookie.name === name);

const signInButton = (page: Page) => page.getByRole("link", { name: "Have an invitation? Sign in" });

/**
 * The honest walk: a page load on the gate gets the coming-soon page, its button starts the sign-in at the door, and
 * the door's POST back lands on the page that was asked for.
 */
const signIn = async (page: Page, origin: string, target = "/docs/") => {
  await page.goto(`${origin}${target}`);
  await signInButton(page).click();
  await page.waitForURL(`${origin}${target}`);
  await expect(page.locator("#title")).toBeVisible();
};

/** The state cookie the sign-in start sets, read from the browser's own jar after a request that does not follow it. */
const stateFrom = async (page: Page, origin: string) => {
  const answer = await page.request.get(`${origin}/_door/signin?next=%2F`, {
    maxRedirects: 0,
    headers: { "sec-fetch-mode": "navigate", accept: "text/html" },
  });
  expect(answer.status()).toBe(302);
  const nonce = await cookieNamed(page.context(), origin, state);
  expect(nonce).toBeDefined();
  return nonce?.value ?? "";
};

const postTicket = (page: Page, ticket: string, next = "/docs/") =>
  page.goto(`${setup.door}/post?${new URLSearchParams({ host: alphaHost, ticket, next })}`);

const expectNoSiteBytes = async (answer: APIResponse) => {
  const body = await answer.body();
  expect(body.length, answer.url()).toBe(0);
  expect(answer.headers()["cache-control"], answer.url()).toMatch(/no-store/);
  expect(answer.headers()["x-robots-tag"], answer.url()).toBe("noindex, nofollow");
};

/** The coming-soon page with the one part that differs by path, its sign-in link's next, taken out. */
const withoutNext = (html: string) => html.replace(/href="\/_door\/signin\?next=[^"]*"/, 'href="NEXT"');

/** The `next` the coming-soon page's button carries. */
const nextOf = (html: string) => {
  const href = /<a class="button" href="([^"]*)">/.exec(html)?.[1] ?? "";
  return new URL(href.replace(/&amp;/g, "&"), "https://gate.example").searchParams.get("next");
};

test.describe("the leak check", () => {
  test("serves no byte of any file without a session: a page load gets the coming-soon page, anything else 401", async ({
    request,
  }) => {
    let first: string | undefined;
    for (const file of setup.files) {
      const url = `${setup.alpha}/${file}`;
      const load = await request.get(url, {
        maxRedirects: 0,
        headers: { "sec-fetch-mode": "navigate", accept: "text/html" },
      });
      expect(load.status(), url).toBe(401);
      expect(load.headers().location, url).toBeUndefined();
      expect(load.headers()["set-cookie"], url).toBeUndefined();
      expect(load.headers()["cache-control"], url).toBe("no-store");
      expect(load.headers()["x-robots-tag"], url).toBe("noindex, nofollow");
      expect(load.headers()["content-type"], url).toBe("text/html; charset=utf-8");
      const html = await load.text();
      expect(html, url).not.toContain("SITE-BYTES");
      expect(nextOf(html), url).toBe(`/${file}`);
      // The same page for every path but its next: nothing about what is behind the door varies with the path.
      first ??= withoutNext(html);
      expect(withoutNext(html), url).toBe(first);
      const fetched = await request.get(url, {
        maxRedirects: 0,
        headers: { "sec-fetch-mode": "no-cors", accept: "*/*" },
      });
      expect(fetched.status(), url).toBe(401);
      await expectNoSiteBytes(fetched);
    }
    const missing = await request.get(`${setup.alpha}/nope/`, { maxRedirects: 0, headers: { accept: "*/*" } });
    expect(missing.status()).toBe(401);
    await expectNoSiteBytes(missing);
  });

  test("shows every navigation without a session the coming-soon page, whose button takes it to the door", async ({
    browser,
  }) => {
    // A visitor the door has not signed in: every sign-in stops at the door's page instead of coming back with a ticket.
    const context = await browser.newContext({ ignoreHTTPSErrors: true });
    await context.addCookies([{ name: "door_hold", value: "1", url: setup.door }]);
    const page = await context.newPage();
    const caching = watchCaching(page);
    for (const file of setup.files) {
      // The last round's sign-in left a state cookie; the page itself must set none.
      await context.clearCookies({ name: state });
      const answer = await page.goto(`${setup.alpha}/${file}?x=1`);
      expect(answer?.status(), file).toBe(401);
      expect(page.url(), file).toBe(`${setup.alpha}/${file}?x=1`);
      await expect(page.getByRole("heading", { level: 1 }), file).toHaveText(`${alphaPage.name} is coming soon.`);
      expect(await answer?.text(), file).not.toContain("SITE-BYTES");
      expect(await cookieNamed(context, setup.alpha, state), file).toBeUndefined();
      await signInButton(page).click();
      await page.waitForURL((url) => url.origin === setup.door);
      const landed = new URL(page.url());
      expect(landed.origin, file).toBe(setup.door);
      expect(Object.fromEntries(landed.searchParams), file).toMatchObject({
        site: "alpha",
        host: alphaHost,
        next: `/${file}?x=1`,
      });
      expect(landed.searchParams.get("state"), file).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect((await cookieNamed(context, setup.alpha, state))?.value, file).toBe(landed.searchParams.get("state"));
      await expect(page.locator("#door"), file).toHaveText("Door");
    }
    expect(caching.length).toBeGreaterThan(0);
    for (const { url, cacheControl } of caching) expect(cacheControl, url).toMatch(/no-store|private/);
    await context.close();
  });

  test("refuses a path that would leave the site with 400, and no redirect to another host", async ({ page }) => {
    const answer = await page.request.get(`${setup.alpha}/%09/evil.com`, { maxRedirects: 0 });
    expect(answer.status()).toBe(400);
    expect(answer.headers().location).toBeUndefined();
    // In the browser too. Firefox reports an empty response to a navigation as a network error rather than a page,
    // so what is pinned is the status where there is one, and that the browser went nowhere else.
    const loaded = await page.goto(`${setup.alpha}/%5C/evil.com`).catch(() => null);
    if (loaded) {
      expect(loaded.status()).toBe(400);
      expect(new URL(page.url()).host).toBe(alphaHost);
    } else {
      expect(page.url()).toBe("about:blank");
    }
  });
});

test.describe("the coming-soon page", () => {
  const rgb = (hex: string) => `rgb(${[1, 3, 5].map((at) => Number.parseInt(hex.slice(at, at + 2), 16)).join(", ")})`;
  const styleOf = (page: Page, selector: string, property: string) =>
    page.locator(selector).evaluate((element, name) => getComputedStyle(element).getPropertyValue(name), property);

  test("paints with its own stylesheet and mark under its CSP, in the product's colors, light and dark", async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: "light" });
    const answer = await page.goto(`${setup.alpha}/docs/`);
    expect(answer?.status()).toBe(401);
    expect(answer?.headers()["content-security-policy"]).toContain("default-src 'none'");
    await expect(page).toHaveTitle(`${alphaPage.name} is coming soon`);
    await expect(page.getByText("Open for now to invited guests.")).toBeVisible();
    await expect(page.getByRole("link", { name: "Get involved" })).toHaveAttribute(
      "href",
      `${setup.door}/get-involved/?site=alpha`,
    );
    // The stylesheet applied (its hash matched) and the data: mark loaded (img-src allowed it).
    expect(await styleOf(page, ".button", "background-color")).toBe(rgb(alphaPage.accent));
    expect(await styleOf(page, ".button", "color")).toBe("rgb(255, 255, 255)");
    expect(await page.locator(".mark-light").evaluate((image: HTMLImageElement) => image.naturalWidth)).toBeGreaterThan(
      0,
    );
    expect(await styleOf(page, "body", "background-color")).toBe("rgb(255, 255, 255)");

    await page.emulateMedia({ colorScheme: "dark" });
    expect(await styleOf(page, ".button", "background-color")).toBe(rgb(alphaPage.accentDark));
    expect(await styleOf(page, ".button", "color")).toBe("rgb(0, 0, 0)");
    expect(await styleOf(page, "body", "background-color")).toBe("rgb(17, 22, 27)");
  });

  test("reads at 320px with nothing pushed sideways", async ({ browser }) => {
    const context = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 320, height: 640 } });
    const page = await context.newPage();
    await page.goto(`${setup.alpha}/a/long/path/that/a/visitor/asked/for/?with=a&query=string`);
    await expect(signInButton(page)).toBeInViewport();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
    const button = await signInButton(page).boundingBox();
    expect(button?.height ?? 0).toBeGreaterThanOrEqual(44);
    await context.close();
  });

  test("renders the defaults for a site that set nothing: its id as the name, and no mark", async ({ page }) => {
    await page.goto(`${setup.beta}/docs/`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Beta is coming soon.");
    await expect(page.locator("img")).toHaveCount(0);
    await expect(signInButton(page)).toBeVisible();
  });

  test("answers HEAD with the page's headers and no body", async ({ request }) => {
    const headers = { "sec-fetch-mode": "navigate", accept: "text/html" };
    const get = await request.get(`${setup.alpha}/docs/`, { headers, maxRedirects: 0 });
    const head = await request.head(`${setup.alpha}/docs/`, { headers, maxRedirects: 0 });
    expect(head.status()).toBe(401);
    expect((await head.body()).length).toBe(0);
    const { date: _getDate, ...getHeaders } = get.headers();
    const { date: _headDate, ...headHeaders } = head.headers();
    expect(headHeaders).toEqual(getHeaders);
  });
});

test.describe("the ticket", () => {
  test("opens the site from the door's cross-site POST, and the session carries the page's scripts and images", async ({
    page,
    context,
  }) => {
    const caching = watchCaching(page);
    await signIn(page, setup.alpha, "/docs/?tab=api");
    await expect(page.locator("#title")).toHaveText("Locked docs");
    expect(page.url()).toBe(`${setup.alpha}/docs/?tab=api`);

    const cookie = await cookieNamed(context, setup.alpha, session);
    expect(cookie).toMatchObject({ httpOnly: true, secure: true, sameSite: "Lax", path: "/" });
    expect(cookie?.domain).toBe("localhost");
    expect((cookie?.expires ?? 0) - Date.now() / 1000).toBeLessThanOrEqual(3600);
    expect(await cookieNamed(context, setup.alpha, state)).toBeUndefined();
    expect(await cookieNamed(context, setup.alpha, seen)).toMatchObject({
      value: "1",
      httpOnly: true,
      secure: true,
      sameSite: "Lax",
      path: "/",
    });

    await page.goto(`${setup.alpha}/`);
    await expect(page.locator("body")).toHaveAttribute("data-app", "loaded");
    expect(await page.locator("#og").evaluate((image: HTMLImageElement) => image.naturalWidth)).toBe(1);
    const missing = await page.goto(`${setup.alpha}/nope/`);
    expect(missing?.status()).toBe(404);
    await expect(page.locator("#title")).toHaveText("Page not found.");

    for (const { url, cacheControl } of caching) expect(cacheControl, url).toMatch(/no-store|private/);
  });

  const refusals: [string, (nonce: string, door: string) => string][] = [
    [
      "a tampered ticket",
      (st, iss) => tamper(signTicket(key, ticketClaims({ issuer: iss, host: alphaHost, state: st, next: "/docs/" }))),
    ],
    [
      "an expired ticket",
      (st, iss) =>
        signTicket(
          key,
          ticketClaims({
            issuer: iss,
            host: alphaHost,
            state: st,
            next: "/docs/",
            now: Math.floor(Date.now() / 1000) - 3700,
          }),
        ),
    ],
    [
      "a ticket for another host",
      (st, iss) => signTicket(key, ticketClaims({ issuer: iss, host: "other.example", state: st, next: "/docs/" })),
    ],
    [
      "a ticket signed by an unknown key",
      (st, iss) =>
        signTicket(makeKey("not-in-jwks"), ticketClaims({ issuer: iss, host: alphaHost, state: st, next: "/docs/" })),
    ],
    [
      "a ticket bound to another state",
      (_st, iss) =>
        signTicket(key, ticketClaims({ issuer: iss, host: alphaHost, state: "x".repeat(43), next: "/docs/" })),
    ],
    [
      "a ticket from another issuer",
      (st) =>
        signTicket(key, ticketClaims({ issuer: "https://evil.example", host: alphaHost, state: st, next: "/docs/" })),
    ],
  ];
  for (const [name, make] of refusals) {
    test(`refuses ${name}: back to the door with ?error=ticket, and no session`, async ({ page, context }) => {
      const nonce = await stateFrom(page, setup.alpha);
      await postTicket(page, make(nonce, setup.door));
      expect(page.url()).toBe(`${setup.door}/?error=ticket`);
      await expect(page.locator("#error")).toHaveText("ticket");
      expect(await cookieNamed(context, setup.alpha, session)).toBeUndefined();
    });
  }

  test("refuses a valid ticket when the browser holds no state cookie", async ({ page, context }) => {
    const nonce = await stateFrom(page, setup.alpha);
    await context.clearCookies();
    await postTicket(
      page,
      signTicket(key, ticketClaims({ issuer: setup.door, host: alphaHost, state: nonce, next: "/docs/" })),
    );
    expect(page.url()).toBe(`${setup.door}/?error=ticket`);
    expect(await cookieNamed(context, setup.alpha, session)).toBeUndefined();
  });

  test("refuses a ticket whose form next differs from its claim", async ({ page, context }) => {
    const nonce = await stateFrom(page, setup.alpha);
    const ticket = signTicket(key, ticketClaims({ issuer: setup.door, host: alphaHost, state: nonce, next: "/docs/" }));
    await postTicket(page, ticket, "/");
    expect(page.url()).toBe(`${setup.door}/?error=ticket`);
    expect(await cookieNamed(context, setup.alpha, session)).toBeUndefined();
  });

  test("does not take a session cookie signed for the site by an unknown key", async ({ page, context }) => {
    const forged = signTicket(makeKey("forger"), ticketClaims({ issuer: setup.door, host: alphaHost }));
    await context.addCookies([
      { name: session, value: forged, url: setup.alpha, secure: true, httpOnly: true, sameSite: "Lax" },
    ]);
    const answer = await page.request.get(`${setup.alpha}/docs/`, { maxRedirects: 0, headers: { accept: "*/*" } });
    expect(answer.status()).toBe(401);
  });
});

test.describe("renewal", () => {
  test("renews an ended session silently through the door, with no click, back to the page asked for", async ({
    page,
    context,
  }) => {
    await signIn(page, setup.alpha);
    // The hour is up: the browser drops the session cookie at its Max-Age, and keeps the seen marker.
    await context.clearCookies({ name: session });
    expect(await cookieNamed(context, setup.alpha, seen)).toBeDefined();
    const visited: string[] = [];
    page.on("request", (request) => {
      if (request.isNavigationRequest()) visited.push(new URL(request.url()).origin);
    });
    await page.goto(`${setup.alpha}/docs/?tab=api`);
    await page.waitForURL(`${setup.alpha}/docs/?tab=api`);
    await expect(page.locator("#title")).toHaveText("Locked docs");
    expect(visited).toContain(setup.door);
    await expect(signInButton(page)).toHaveCount(0);
    expect(await cookieNamed(context, setup.alpha, session)).toBeDefined();
  });

  test("serves no site byte for the seen marker alone: a page load goes to the door, a fetch gets an empty 401", async ({
    page,
    context,
  }) => {
    await context.addCookies([
      { name: seen, value: "1", url: setup.alpha, secure: true, httpOnly: true, sameSite: "Lax" },
    ]);
    for (const file of setup.files) {
      const url = `${setup.alpha}/${file}`;
      const load = await page.request.get(url, {
        maxRedirects: 0,
        headers: { "sec-fetch-mode": "navigate", accept: "text/html" },
      });
      expect(load.status(), url).toBe(302);
      expect(new URL(load.headers().location ?? "").origin, url).toBe(setup.door);
      await expectNoSiteBytes(load);
      const fetched = await page.request.get(url, { maxRedirects: 0, headers: { accept: "*/*" } });
      expect(fetched.status(), url).toBe(401);
      await expectNoSiteBytes(fetched);
    }
  });

  test("clears the seen marker on sign-out, so the next visit meets the coming-soon page", async ({
    page,
    context,
  }) => {
    await signIn(page, setup.alpha);
    await page.goto(`${setup.alpha}/_door/signout?then=door`);
    expect(await cookieNamed(context, setup.alpha, seen)).toBeUndefined();
    await page.goto(`${setup.alpha}/docs/`);
    await expect(signInButton(page)).toBeVisible();
  });
});

test.describe("the host", () => {
  test("refuses a host not on the gate's list with an empty 403", async ({ page }) => {
    // The same server, reached by another name: alpha's gate answers only localhost.
    const other = setup.alpha.replace("localhost", "127.0.0.1");
    const answer = await page.request.get(`${other}/docs/`, { maxRedirects: 0, headers: { accept: "text/html" } });
    expect(answer.status()).toBe(403);
    expect((await answer.body()).length).toBe(0);
    expect(answer.headers()["cache-control"]).toBe("no-store");
    expect(answer.headers().location).toBeUndefined();
    // A navigation gets the same nothing (Firefox calls an empty response a network error) and no redirect.
    const loaded = await page.goto(`${other}/docs/`).catch(() => null);
    if (loaded) {
      expect(loaded.status()).toBe(403);
      expect(new URL(page.url()).origin).toBe(other);
    }
  });
});

test.describe("sign-out", () => {
  test("walks the door's chain from /signout/done/, clearing every site's cookies, and ends at /signout/", async ({
    page,
    context,
  }) => {
    await signIn(page, setup.alpha);
    await signIn(page, setup.beta);
    expect(await cookieNamed(context, setup.alpha, session)).toBeDefined();
    expect(await cookieNamed(context, setup.beta, session)).toBeDefined();

    const visited: string[] = [];
    page.on("request", (request) => {
      if (request.isNavigationRequest()) visited.push(request.url());
    });
    await page.goto(`${setup.door}/signout/done/`);
    await page.waitForURL(`${setup.door}/signout/`);
    await expect(page.locator("#door")).toHaveText("Signed out");
    expect(visited).toEqual([
      `${setup.door}/signout/done/`,
      `${setup.alpha}/_door/signout?then=beta`,
      `${setup.beta}/_door/signout?then=door`,
      `${setup.door}/signout/`,
    ]);

    expect(await cookieNamed(context, setup.alpha, session)).toBeUndefined();
    expect(await cookieNamed(context, setup.beta, session)).toBeUndefined();
    for (const origin of [setup.alpha, setup.beta]) {
      const answer = await page.request.get(`${origin}/docs/`, { maxRedirects: 0, headers: { accept: "*/*" } });
      expect(answer.status(), origin).toBe(401);
    }
  });

  test("signs out of one site from its own link, then hands over to the door", async ({ page, context }) => {
    await signIn(page, setup.alpha);
    await page.goto(`${setup.alpha}/_door/signout?then=door`);
    expect(page.url()).toBe(`${setup.door}/signout/`);
    expect(await cookieNamed(context, setup.alpha, session)).toBeUndefined();
  });

  test("never follows a URL from the query", async ({ page }) => {
    await page.goto(`${setup.alpha}/_door/signout?then=${encodeURIComponent("https://evil.example/")}`);
    expect(page.url()).toBe(`${setup.door}/signout/`);
  });
});
