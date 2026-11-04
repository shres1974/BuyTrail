/**
 * Category variant schemas (Section 12.1). Critical attributes distinguish purchasable
 * variants; a conflict on any of them blocks automatic matching.
 */

export type CategoryKey = "headphones" | "monitors" | "small_appliances";

export type AttributeDef = {
  key: string;
  label: string;
  critical: boolean;
  /** Exposed as a search filter only when reliably populated. */
  filterable: boolean;
};

export const CATEGORIES: Record<CategoryKey, { label: string; attributes: AttributeDef[] }> = {
  headphones: {
    label: "Headphones",
    attributes: [
      { key: "model_generation", label: "Generation", critical: true, filterable: false },
      { key: "colour", label: "Colour", critical: true, filterable: true },
      { key: "connectivity", label: "Connectivity", critical: true, filterable: true },
      { key: "bundle", label: "Bundle", critical: true, filterable: false },
      { key: "market", label: "Market", critical: true, filterable: false },
      { key: "form_factor", label: "Form factor", critical: false, filterable: true },
    ],
  },
  monitors: {
    label: "Monitors",
    attributes: [
      { key: "screen_size_in", label: "Screen size (in)", critical: true, filterable: true },
      { key: "resolution", label: "Resolution", critical: true, filterable: true },
      { key: "refresh_hz", label: "Refresh rate (Hz)", critical: true, filterable: true },
      { key: "bundle", label: "Included accessories", critical: true, filterable: false },
      { key: "market", label: "Market", critical: true, filterable: false },
      { key: "panel", label: "Panel", critical: false, filterable: true },
    ],
  },
  small_appliances: {
    label: "Small appliances",
    attributes: [
      { key: "capacity", label: "Capacity", critical: true, filterable: true },
      { key: "colour", label: "Colour", critical: true, filterable: true },
      { key: "voltage", label: "Voltage", critical: true, filterable: false },
      { key: "bundle", label: "Bundle", critical: true, filterable: false },
      { key: "market", label: "Market", critical: true, filterable: false },
      { key: "appliance_type", label: "Type", critical: false, filterable: true },
    ],
  },
};

export const CATEGORY_KEYS = Object.keys(CATEGORIES) as CategoryKey[];

export function isCategoryKey(s: string): s is CategoryKey {
  return (CATEGORY_KEYS as string[]).includes(s);
}

export function criticalAttributes(cat: CategoryKey): string[] {
  return CATEGORIES[cat].attributes.filter((a) => a.critical).map((a) => a.key);
}

/** Normalize attribute values for comparison: trim, lower-case, collapse whitespace, unify units. */
export function normalizeAttributeValue(v: string): string {
  return v
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/(\d)\s*(in|inch|inches|")$/, "$1")
    .replace(/(\d)\s*hz$/, "$1")
    .replace(/(\d)\s*l(itre|iter)?s?$/, "$1l")
    .replace(/(\d)\s*v$/, "$1v");
}
