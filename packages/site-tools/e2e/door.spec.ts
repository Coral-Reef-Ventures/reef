import { createPrivateKey } from "node:crypto";
import { readFileSync } from "node:fs";

import { type APIResponse, type BrowserContext, expect, type Page, test } from "@playwright/test";

import { makeKey, signTicket, type TestKey, tamper, ticketClaims } from "../test/door-fixtures.ts";

type Setup = { door: string; alpha: string; beta: string; kid: string; keyFile: string; files: string[] };
const setup = JSON.parse(process.env.DOOR_E2E ?? "null") as Setup;
const key: TestKey = { kid: setup.kid, privateKey: createPrivateKey(readFileSync(setup.keyFile)), jwk: {} };
const alphaHost = new URL(setup.alpha).host;
const session = "__Host-crv_door";
const state = "__Host-crv_door_state";

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

/** The honest walk: a page load on the gate, the door, the door's POST back, and the page. */
const signIn = async (page: Page, origin: string, target = "/docs/") => {
  await page.goto(`${origin}${target}`);
  await expect(page.locator("#title")).toBeVisible();
};

/** The state cookie a page load sets, read from the browser's own jar after a request that does not follow it. */
const stateFrom = async (page: Page, origin: string) => {
  const answer = await page.request.get(`${origin}/`, {
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

test.describe("the leak check", () => {
  test("serves no byte of any file without a session: a page load gets the door, anything else 401", async ({
    request,
  }) => {
    for (const file of setup.files) {
      const url = `${setup.alpha}/${file}`;
      const load = await request.get(url, {
        maxRedirects: 0,
        headers: { "sec-fetch-mode": "navigate", accept: "text/html" },
      });
      expect(load.status(), url).toBe(302);
      expect(new URL(load.headers().location ?? "").origin, url).toBe(setup.door);
      await expectNoSiteBytes(load);
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

  test("ends every navigation without a session at the door, carrying the site, host, next and a state", async ({
    browser,
  }) => {
    // A visitor the door has not signed in: every load stops at the door's page instead of coming back with a ticket.
    const context = await browser.newContext({ ignoreHTTPSErrors: true });
    await context.addCookies([{ name: "door_hold", value: "1", url: setup.door }]);
    const page = await context.newPage();
    const caching = watchCaching(page);
    for (const file of setup.files) {
      const answer = await page.goto(`${setup.alpha}/${file}?x=1`);
      const landed = new URL(page.url());
      expect(landed.origin, file).toBe(setup.door);
      expect(Object.fromEntries(landed.searchParams), file).toMatchObject({
        site: "alpha",
        host: alphaHost,
        next: `/${file}?x=1`,
      });
      expect(landed.searchParams.get("state"), file).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(await answer?.text(), file).not.toContain("SITE-BYTES");
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

test.describe("the ticket", () => {
  test("opens the site from the door's cross-site POST, and the session carries the page's scripts and images", async ({
    page,
    context,
  }) => {
    const caching = watchCaching(page);
    await page.goto(`${setup.alpha}/docs/?tab=api`);
    await expect(page.locator("#title")).toHaveText("Locked docs");
    expect(page.url()).toBe(`${setup.alpha}/docs/?tab=api`);

    const cookie = await cookieNamed(context, setup.alpha, session);
    expect(cookie).toMatchObject({ httpOnly: true, secure: true, sameSite: "Lax", path: "/" });
    expect(cookie?.domain).toBe("localhost");
    expect((cookie?.expires ?? 0) - Date.now() / 1000).toBeLessThanOrEqual(3600);
    expect(await cookieNamed(context, setup.alpha, state)).toBeUndefined();

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
