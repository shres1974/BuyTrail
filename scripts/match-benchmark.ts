/**
 * pnpm match:benchmark — labelled matching benchmark (Section 12.3). Generates ≥100 difficult
 * candidate pairs from the demo catalog (near-identical model numbers, bundles, colours,
 * capacities, conditions, identifier errors) and reports false merges and missed matches
 * separately. Synthetic data only; results do not extrapolate to universal accuracy.
 */
import { gtinCheckDigit, matchListing, type ListingForMatch, type VariantForMatch } from "@buytrail/domain";
import { DEMO_VARIANTS } from "@buytrail/providers";

const variants: VariantForMatch[] = DEMO_VARIANTS.map((v) => ({
  variantId: v.id,
  category: v.product.category,
  brand: v.product.brand,
  modelCode: v.modelCode,
  identifiers: [{ kind: "gtin", normalized: v.gtin.padStart(14, "0") }],
  attributes: v.attributes,
}));

type Case = { name: string; listing: ListingForMatch; expect: string | null; kind: "should_match" | "should_not_match" };
const cases: Case[] = [];
const base = (v: (typeof DEMO_VARIANTS)[number]): ListingForMatch => ({
  brand: v.product.brand,
  model: v.modelCode,
  identifiers: [{ kind: "gtin", value: v.gtin }],
  attributes: { ...v.attributes },
  title: `${v.product.title} ${v.label}`,
});
const badCheck = (g: string) => g.slice(0, -1) + String((Number(g.at(-1)) + 1) % 10);

for (const v of DEMO_VARIANTS) {
  const b = base(v);
  cases.push({ name: `${v.id}: exact listing`, listing: b, expect: v.id, kind: "should_match" });
  cases.push({ name: `${v.id}: brand+model only (no GTIN)`, listing: { ...b, identifiers: [] }, expect: v.id, kind: "should_match" });
  cases.push({ name: `${v.id}: GTIN with leading zeros`, listing: { ...b, identifiers: [{ kind: "gtin", value: v.gtin.padStart(14, "0") }] }, expect: v.id, kind: "should_match" });
  cases.push({ name: `${v.id}: marketing title change`, listing: { ...b, title: "BEST DEAL!!! limited time" }, expect: v.id, kind: "should_match" });
  // Difficult negatives.
  cases.push({ name: `${v.id}: model suffix X`, listing: { ...b, model: `${v.modelCode}X`, identifiers: [] }, expect: null, kind: "should_not_match" });
  cases.push({ name: `${v.id}: bad check digit, no model`, listing: { ...b, model: null, identifiers: [{ kind: "gtin", value: badCheck(v.gtin) }] }, expect: null, kind: "should_not_match" });
  const critical = Object.keys(v.attributes).filter((k) => k !== "market");
  for (const k of critical.slice(0, 3)) {
    cases.push({ name: `${v.id}: conflicting ${k}`, listing: { ...b, attributes: { ...b.attributes, [k]: `${b.attributes[k]}-other` } }, expect: null, kind: "should_not_match" });
  }
  cases.push({ name: `${v.id}: missing critical attributes`, listing: { ...b, identifiers: [], attributes: { market: "CA" } }, expect: null, kind: "should_not_match" });
  cases.push({ name: `${v.id}: other brand same model`, listing: { ...b, brand: "Otherbrand", identifiers: [] }, expect: null, kind: "should_not_match" });
  cases.push({ name: `${v.id}: GTIN of another variant`, listing: { ...b, identifiers: [{ kind: "gtin", value: DEMO_VARIANTS[(DEMO_VARIANTS.indexOf(v) + 1) % DEMO_VARIANTS.length]!.gtin }] }, expect: null, kind: "should_not_match" });
}
const body = "207999999999";
cases.push({ name: "unknown GTIN, unknown brand", listing: { brand: "Nobody", model: "ZZ-1", identifiers: [{ kind: "gtin", value: body + gtinCheckDigit(body) }], attributes: {}, title: "x" }, expect: null, kind: "should_not_match" });

let falseMerge = 0;
let missed = 0;
let correct = 0;
const failures: string[] = [];
for (const c of cases) {
  const d = matchListing(c.listing, variants);
  const got = d.status === "verified" ? d.variantId : null;
  if (c.kind === "should_match") {
    if (got === c.expect) correct++;
    else if (got && got !== c.expect) {
      falseMerge++;
      failures.push(`FALSE MERGE ${c.name} → ${got}`);
    } else {
      missed++;
      failures.push(`missed ${c.name} (${d.status}${"reason" in d ? `: ${d.reason}` : ""})`);
    }
  } else if (got) {
    falseMerge++;
    failures.push(`FALSE MERGE ${c.name} → ${got}`);
  } else correct++;
}
const pos = cases.filter((c) => c.kind === "should_match").length;
console.log(JSON.stringify({ cases: cases.length, positives: pos, negatives: cases.length - pos, correct, falseAutomaticMerges: falseMerge, missedMatches: missed, ruleVersion: "match-v1" }, null, 2));
for (const f of failures.slice(0, 40)) console.log(f);
process.exit(falseMerge > 0 ? 1 : 0);
