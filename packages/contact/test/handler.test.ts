import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { afterEach, describe, expect, it, vi } from "vitest";

import { type ContactConfig, createContactHandler, parseContact } from "../src/index";

const post = (body: unknown, method = "POST") =>
  ({
    body: typeof body === "string" ? body : JSON.stringify(body),
    isBase64Encoded: false,
    requestContext: { http: { method } },
  }) as unknown as APIGatewayProxyEventV2;

/** Streamlane's contact form (apps/site/amplify/functions/contact/handler.ts), as it configures this handler. */
const streamlane: ContactConfig<"name" | "email" | "company" | "people" | "message" | "about"> = {
  fields: { name: 200, email: 320, company: 200, people: 50, message: 5000, about: 100 },
  required: ["name", "email", "message"],
  email: "email",
};

/** Driftline's early access form, which asks what the visitor is using and how big they are. */
const driftline: ContactConfig<"name" | "email" | "company" | "size" | "message" | "using" | "about"> = {
  fields: { name: 200, email: 320, company: 200, size: 50, message: 5000, using: 200, about: 100 },
  required: ["name", "email", "message"],
  email: "email",
};

const valid = { name: "Ada", email: "ada@example.com", message: "GitLab, 40 people", about: "gitlab" };

// The README's recipe, with `required` a strict subset of `fields`: `Field` must come from `fields` alone, or
// `company` is rejected as not a field. This is a compile-time check; the handler itself is exercised below.
const optionalFields = createContactHandler({
  fields: { name: 120, email: 254, company: 120, message: 4000 },
  required: ["name", "email", "message"],
  email: "email",
});
void optionalFields;

describe("the contact handler", () => {
  afterEach(() => vi.restoreAllMocks());

  it("logs a valid message as one JSON line and returns 200", async () => {
    const log = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const result = await createContactHandler(streamlane)(post(valid));
    expect(result.statusCode).toBe(200);
    expect(result.headers).toEqual({ "content-type": "application/json" });
    expect(log).toHaveBeenCalledOnce();
    const logged = JSON.parse(String(log.mock.calls[0]?.[0]));
    expect(logged.contact).toMatchObject({ email: "ada@example.com", about: "gitlab" });
    expect(logged.receivedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("hands a valid message to the product's own delivery instead of the log", async () => {
    const log = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const deliver = vi.fn();
    const result = await createContactHandler({ ...driftline, deliver })(post({ ...valid, using: "PostHog" }));
    expect(result.statusCode).toBe(200);
    expect(deliver).toHaveBeenCalledWith({
      name: "Ada",
      email: "ada@example.com",
      company: "",
      size: "",
      message: "GitLab, 40 people",
      using: "PostHog",
      about: "gitlab",
    });
    expect(log).not.toHaveBeenCalled();
  });

  it("refuses a message without an email address, saying which field", async () => {
    const result = await createContactHandler(streamlane)(post({ ...valid, email: "ada" }));
    expect(result.statusCode).toBe(400);
    expect(JSON.parse(result.body ?? "")).toEqual({ error: "email is not an email address" });
  });

  it("refuses what is not JSON, and methods other than POST", async () => {
    const handler = createContactHandler(streamlane);
    expect((await handler(post("not json"))).statusCode).toBe(400);
    expect((await handler(post(valid, "GET"))).statusCode).toBe(405);
  });

  it("reads a base64 body as the function URL delivers one", async () => {
    const event = {
      ...post(valid),
      body: Buffer.from(JSON.stringify(valid)).toString("base64"),
      isBase64Encoded: true,
    } as APIGatewayProxyEventV2;
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    expect((await createContactHandler(streamlane)(event)).statusCode).toBe(200);
  });

  it("answers 200 to a filled-in honeypot without delivering", async () => {
    const deliver = vi.fn();
    const handler = createContactHandler({ ...streamlane, deliver });
    expect((await handler(post({ ...valid, website: "http://spam.example" }))).statusCode).toBe(200);
    const named = createContactHandler({ ...streamlane, deliver, honeypot: "fax" });
    expect((await named(post({ ...valid, fax: "1" }))).statusCode).toBe(200);
    expect(deliver).not.toHaveBeenCalled();
  });
});

describe("parseContact", () => {
  it("trims fields and defaults the optional ones, for each product's field set", () => {
    const sent = { name: " Ada ", email: "ada@example.com", message: " Hi " };
    expect(parseContact(sent, streamlane)).toEqual({
      name: "Ada",
      email: "ada@example.com",
      company: "",
      people: "",
      message: "Hi",
      about: "",
    });
    expect(parseContact(sent, driftline)).toEqual({
      name: "Ada",
      email: "ada@example.com",
      company: "",
      size: "",
      message: "Hi",
      using: "",
      about: "",
    });
  });

  it("limits field lengths and requires the required ones", () => {
    expect(parseContact({ ...valid, message: "x".repeat(5001) }, streamlane)).toEqual({
      error: "message is longer than 5000 characters",
    });
    expect(parseContact({ ...valid, name: "" }, streamlane)).toEqual({ error: "name is required" });
    expect(parseContact({ ...valid, name: 3 }, streamlane)).toEqual({ error: "name must be text" });
    expect(parseContact(null, streamlane)).toEqual({ error: "Expected a JSON object" });
  });
});
