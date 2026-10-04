# @coralreefventures/contact

The Lambda handler behind a Coral Reef public site's contact or early-access form, behind a function URL: POST only,
a JSON body, each field trimmed and held to its length, the required ones present, the email address shaped like one,
and a filled-in honeypot answered as if it worked and dropped.

Both sites carried a 60-line copy of this, differing only in the fields the form sends. A product's
`amplify/functions/contact/handler.ts` becomes its field table and a call:

```ts
import { createContactHandler } from "@coralreefventures/contact";

export const handler = createContactHandler({
  fields: { name: 200, email: 320, company: 200, people: 50, message: 5000, about: 100 },
  required: ["name", "email", "message"],
  email: "email",
});
```

`honeypot` names the hidden field (`website` by default). `deliver` is what happens to a valid message; the default,
which both sites' stubs do today, logs it as one JSON line with `receivedAt`. When a product wires the form somewhere
(a Request in a Streamlane workspace, an email through SES), it passes a `deliver` and nothing else changes. CORS is
not here: a function URL answers preflights itself, and the product's `amplify/backend.ts` names the origins.

`parseContact(body, config)` is exported on its own, for a test or a second route.

## Installing

Ships TypeScript source; Amplify's function bundler (esbuild) and `tsc -p amplify --noEmit` both read it.
`@types/aws-lambda` comes with it, since the handler's signature is typed with it.
