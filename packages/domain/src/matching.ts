/**
 * Exact variant matching (Section 12.2). Deterministic rules only. Fuzzy title similarity
 * may produce review candidates but never an automatic link.
 */
import { CategoryKey, criticalAttributes, normalizeAttributeValue } from "./categories";
import { normalizeIdentifier, normalizeModel } from "./identifiers";

export const MATCH_RULE_VERSION = "match-v1";

export type ListingForMatch = {
  brand: string | null;
  model: string | null;
  identifiers: Array<{ kind: "gtin" | "mpn"; value: string }>;
  attributes: Record<string, string>;
  title: string;
};

export type VariantForMatch = {
  variantId: string;
  category: CategoryKey;
  brand: string;
  modelCode: string; // exact model code for the variant
  identifiers: Array<{ kind: "gtin" | "mpn"; normalized: string }>;
  attributes: Record<string, string>;
};

export type MatchDecision =
  | { status: "verified"; variantId: string; evidence: string[]; ruleVersion: string }
  | { status: "candidate"; variantIds: string[]; evidence: string[]; reason: string; ruleVersion: string }
  | { status: "quarantined"; variantIds: string[]; evidence: string[]; reason: string; ruleVersion: string }
  | { status: "unmatched"; evidence: string[]; reason: string; ruleVersion: string };

type Conflict = { attribute: string; listing: string; variant: string };

function attributeConflicts(cat: CategoryKey, listing: ListingForMatch, variant: VariantForMatch) {
  const conflicts: Conflict[] = [];
  const missing: string[] = [];
  for (const key of criticalAttributes(cat)) {
    const vv = variant.attributes[key];
    const lv = listing.attributes[key];
    if (vv === undefined) continue; // variant does not define it (e.g. no colour variants)
    if (lv === undefined || lv.trim() === "") {
      missing.push(key);
      continue;
    }
    if (normalizeAttributeValue(lv) !== normalizeAttributeValue(vv)) {
      conflicts.push({ attribute: key, listing: lv, variant: vv });
    }
  }
  return { conflicts, missing };
}

const norm = (s: string | null | undefined) => (s ?? "").trim().toLowerCase();

/**
 * Apply rules in order:
 * 1-2. normalize/validate identifiers;
 * 3. candidates by strong identifier, or brand + exact model;
 * 4. check every critical attribute for conflicts;
 * 5. auto-link only when strong evidence agrees and no critical conflict/missing value;
 * 6. otherwise send to review (candidate) or quarantine (contradictory strong evidence).
 */
export function matchListing(listing: ListingForMatch, variants: VariantForMatch[]): MatchDecision {
  const evidence: string[] = [];
  const ruleVersion = MATCH_RULE_VERSION;

  const ids = listing.identifiers.map((i) => normalizeIdentifier(i.kind, i.value));
  const invalid = ids.filter((i) => !i.ok);
  for (const i of invalid) evidence.push(`invalid ${i.kind} ${JSON.stringify(i.original)}: ${(i as { reason: string }).reason}`);
  const validGtins = ids.filter((i) => i.ok && i.kind === "gtin").map((i) => (i as { normalized: string }).normalized);
  const listingModel = normalizeModel(listing.model);
  const listingBrand = norm(listing.brand);

  // Candidates by GTIN.
  const byGtin = validGtins.length
    ? variants.filter((v) => v.identifiers.some((vi) => vi.kind === "gtin" && validGtins.includes(vi.normalized)))
    : [];
  // Candidates by brand + exact model.
  const byModel =
    listingModel && listingBrand
      ? variants.filter((v) => norm(v.brand) === listingBrand && normalizeModel(v.modelCode) === listingModel)
      : [];

  if (invalid.some((i) => i.kind === "gtin") && byModel.length === 0) {
    return {
      status: "quarantined",
      variantIds: [],
      evidence,
      reason: "invalid_identifier_without_model_evidence",
      ruleVersion,
    };
  }

  if (byGtin.length > 1) {
    return {
      status: "quarantined",
      variantIds: byGtin.map((v) => v.variantId),
      evidence: [...evidence, "GTIN maps to multiple variants"],
      reason: "ambiguous_identifier",
      ruleVersion,
    };
  }

  const gtinVariant = byGtin[0];
  if (gtinVariant) {
    evidence.push(`gtin match ${gtinVariant.variantId}`);
    // Identifier agrees, but model and critical attributes must not contradict it.
    if (listingModel && normalizeModel(gtinVariant.modelCode) !== listingModel) {
      return {
        status: "quarantined",
        variantIds: [gtinVariant.variantId],
        evidence: [...evidence, `model conflict: listing ${listing.model} vs variant ${gtinVariant.modelCode}`],
        reason: "identifier_model_conflict",
        ruleVersion,
      };
    }
    if (listingBrand && norm(gtinVariant.brand) !== listingBrand) {
      return {
        status: "quarantined",
        variantIds: [gtinVariant.variantId],
        evidence: [...evidence, "brand conflict"],
        reason: "identifier_brand_conflict",
        ruleVersion,
      };
    }
    const { conflicts, missing } = attributeConflicts(gtinVariant.category, listing, gtinVariant);
    if (conflicts.length) {
      return {
        status: "quarantined",
        variantIds: [gtinVariant.variantId],
        evidence: [...evidence, ...conflicts.map((c) => `conflict ${c.attribute}: ${c.listing} vs ${c.variant}`)],
        reason: "identifier_attribute_conflict",
        ruleVersion,
      };
    }
    if (missing.length) {
      return {
        status: "candidate",
        variantIds: [gtinVariant.variantId],
        evidence: [...evidence, `missing critical attributes: ${missing.join(", ")}`],
        reason: "incomplete_attributes",
        ruleVersion,
      };
    }
    return { status: "verified", variantId: gtinVariant.variantId, evidence, ruleVersion };
  }

  if (byModel.length) {
    evidence.push(`brand+model candidates: ${byModel.map((v) => v.variantId).join(", ")}`);
    const clean = byModel.filter((v) => {
      const r = attributeConflicts(v.category, listing, v);
      return r.conflicts.length === 0 && r.missing.length === 0;
    });
    if (clean.length === 1 && invalid.length === 0) {
      return { status: "verified", variantId: clean[0]!.variantId, evidence: [...evidence, "all critical attributes agree"], ruleVersion };
    }
    const reason =
      invalid.length > 0
        ? "invalid_identifier_present"
        : clean.length > 1
          ? "multiple_compatible_variants"
          : "critical_attribute_conflict_or_missing";
    return { status: "candidate", variantIds: (clean.length ? clean : byModel).map((v) => v.variantId), evidence, reason, ruleVersion };
  }

  // Weak evidence only → review candidate, never verified:
  //  (a) same brand and a near model code (one is a prefix of the other, e.g. CP27Q vs CP27QX);
  //  (b) same brand and a title token that is a prefix of a variant's model code.
  const titleTokens = new Set(listing.title.toUpperCase().split(/[^A-Z0-9]+/).filter((t) => t.length >= 3));
  const weak = variants.filter((v) => {
    if (norm(v.brand) !== listingBrand) return false;
    const vm = normalizeModel(v.modelCode);
    if (!vm) return false;
    if (listingModel && listingModel !== vm && (listingModel.startsWith(vm) || vm.startsWith(listingModel))) return true;
    return [...titleTokens].some((t) => vm.startsWith(t) || t.startsWith(vm));
  });
  if (weak.length) {
    return {
      status: "candidate",
      variantIds: weak.map((v) => v.variantId),
      evidence: [...evidence, listingModel ? `near model code ${listing.model} (not proof of identity)` : "title similarity only (not proof of identity)"],
      reason: listingModel ? "near_model_code" : "weak_title_evidence",
      ruleVersion,
    };
  }
  return { status: "unmatched", evidence, reason: "no_candidate", ruleVersion };
}
