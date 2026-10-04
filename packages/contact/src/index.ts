import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from "aws-lambda";

/** A message as the form sent it, one trimmed string per configured field, the optional ones empty. */
export type ContactMessage<Field extends string> = Record<Field, string>;

export type ContactConfig<Field extends string> = {
  /** Every field the form sends and the most characters each may hold. */
  fields: Record<Field, number>;
  /** The fields a message must fill in. */
  required: readonly Field[];
  /** The field that has to look like an email address. */
  email: Field;
  /**
   * The form's hidden field: people never fill it in, so a value means a bot, which is answered as if it worked and
   * never delivered. `website` unless the form names another.
   */
  honeypot?: string;
  /**
   * What happens to a valid message. Until a product wires the message somewhere (a Request in a Streamlane
   * workspace, an email), the default logs it as one JSON line with `receivedAt`, which is what both sites' stubs do.
   */
  deliver?: (message: ContactMessage<Field>) => void | Promise<void>;
};

const emailShape = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** The message, or why it was refused. */
export const parseContact = <Field extends string>(
  body: unknown,
  config: ContactConfig<Field>,
): ContactMessage<Field> | { error: string } => {
  if (typeof body !== "object" || body === null) {
    return { error: "Expected a JSON object" };
  }
  const fields = body as Record<string, unknown>;
  const message = {} as ContactMessage<Field>;
  for (const key of Object.keys(config.fields) as Field[]) {
    const value = fields[key] ?? "";
    if (typeof value !== "string") {
      return { error: `${key} must be text` };
    }
    const trimmed = value.trim();
    if (trimmed.length > config.fields[key]) {
      return { error: `${key} is longer than ${config.fields[key]} characters` };
    }
    if (config.required.includes(key) && trimmed === "") {
      return { error: `${key} is required` };
    }
    message[key] = trimmed;
  }
  if (!emailShape.test(message[config.email])) {
    return { error: `${config.email} is not an email address` };
  }
  return message;
};

const reply = (statusCode: number, body: object): APIGatewayProxyStructuredResultV2 => ({
  statusCode,
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

const logMessage = (message: object) => {
  // biome-ignore lint/suspicious/noConsole: logging the message is the default delivery, and the log is where it is read.
  console.info(JSON.stringify({ contact: message, receivedAt: new Date().toISOString() }));
};

/**
 * A handler for a Lambda function URL, which answers CORS preflights itself (the product's `amplify/backend.ts`
 * names the origins the form may post from). POST only; the body is JSON; a filled-in honeypot is a bot.
 */
export const createContactHandler =
  <Field extends string>(config: ContactConfig<Field>) =>
  async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyStructuredResultV2> => {
    if (event.requestContext.http.method !== "POST") {
      return reply(405, { error: "POST only" });
    }
    let body: unknown;
    try {
      const raw = event.isBase64Encoded ? Buffer.from(event.body ?? "", "base64").toString("utf8") : (event.body ?? "");
      body = JSON.parse(raw);
    } catch {
      return reply(400, { error: "Expected a JSON object" });
    }
    const honeypot = config.honeypot ?? "website";
    if (typeof body === "object" && body !== null && (body as Record<string, unknown>)[honeypot]) {
      return reply(200, { ok: true });
    }
    const message = parseContact(body, config);
    if ("error" in message) {
      return reply(400, message);
    }
    await (config.deliver ?? logMessage)(message);
    return reply(200, { ok: true });
  };
