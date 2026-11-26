# The family loop and its words

What intentset.org, streamlane.app and driftline.app say about how Intentset, Streamlane and Driftline fit together,
written once so the three sites say it in the same words. Each site draws the loop itself, from this file; nothing here
is a package, and nothing ships from it. Origin: Gary's decisions 8 and 18 of 2026-11-25 (Streamlane SL-695, SL-708).

## The loop

Three parts, in this order. Each line is the part, the product that does it, and that product's family label, quoted
from "Status labels and voice" in [`conventions.md`](conventions.md); this file coins no label.

1. **Intent written down** · Intentset · `Open source · Early release`
2. **Carried to production on evidence** · Streamlane · `Product · In development`
3. **Proven in use** · Driftline · `Product · In planning`

One arrow returns from the third part to the first: what use shows comes back as new intent.

### The figure, in words

A site draws the loop from this description and needs no other source:

- The three parts in the order above, each with its name, its product and that product's family label.
- An arrow from each part to the next, and one return from the last part to the first.
- The first part inside a boundary labelled "Your repository": the records are files in the repository the code is in.
- Each site accents its own part (intentset.org the first, streamlane.app the second, driftline.app the third) and
  draws the other two plainly.

The family loop sits beside each product's own flow and replaces neither: Streamlane's seven item stages and
Driftline's five-step release loop stay as they are, drawn on their own pages. The loop shows where each product stands
in the whole; a product's flow shows how work moves inside it.

### What a site may say about the others

Their names, their family labels and their part of the loop. No screens, no planned capabilities by name, no links
(decision 17, which states this for intentset.org and so limits this file). No price and no roadmap detail either, from
Intentset's adoption-log rule of 2026-10-06, which keeps the products' insides off its site. The independence sentence
is the same on all three sites: "None of the three needs the others." Not "each can be adopted", since Driftline is in
planning.

## The words

One definition each, then the words not to use for it.

- **Intent**: what the product should do and why, written before the code. Not "requirements" for the records
  themselves, not "spec" outside Streamlane.
- **Record**: one file of the model. Not "artifact", "document" or "entry".
- **Model**: all of a product's records together. Not "spec", "schema" or "knowledge base".
- **Behavior**: one promise the product makes, including how it fails. Not "feature", "story" or "requirement".
- **Rule**: what must stay true, written once. Not "invariant", "constraint" or "policy".
- **Spec**: on Streamlane only, the behaviors and rules one item is built against. Intentset and Driftline say
  "records". Not "spec" for the whole model, on any site.
- **Check**: the plain word for a verification record. Not "test case" or "assertion" for the record itself (a check
  names the test that runs it).
- **Evidence**: run records, each one check's result at one commit. A pass counts while what it checked is unchanged,
  and a gate may ask for a pass on the commit under review. Never "only at this commit", and not "coverage".
- **Approve**: a person moves a record out of draft. Agents draft; agents never approve. Not "sign off", "accept" or
  "merge" for this step.
- **Drift**: code changed and its records did not. Not "out of sync", "stale" or "divergence".
- **Usage evidence**: a draft format, one line per call naming the behaviors it exercised, never a person. Not
  "telemetry", "analytics" or "tracking".

## How each site holds it

reef cannot be read by another repository's CI, so each site's test holds the three parts' names, products and labels
as literals, names `docs/family.md` in reef as their source, and compares them against this file where a sibling reef
checkout is present, as reef's `test/sites.test.ts` does for the launcher. reef's own `test/tooling.test.ts` holds the
three lines above, and holds each label to the one in `conventions.md`. A change to a part, a product or a label is a
pull request to reef first, then one to each site, linked from it.
