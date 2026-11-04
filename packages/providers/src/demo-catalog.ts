/**
 * Deterministic demonstration catalog (Section 28). Every brand, store, identifier and price
 * here is fictional. Store domains use the reserved `.example` TLD and GTINs use the GS1
 * restricted-circulation prefix "2", so nothing can be mistaken for a live retailer record.
 */
import { gtinCheckDigit } from "@buytrail/domain";

export const DEMO_SOURCE_A = "demo-retail-feed";
export const DEMO_SOURCE_B = "demo-marketplace-feed";
export const DEMO_CONTEXT_ID = "ctx_demo_ca_standard";
export const DEMO_CONTEXT_KEY = "ca-national";

export type DemoMerchant = { id: string; name: string; host: string; platform: string | null; sourceId: string };

export const DEMO_MERCHANTS: DemoMerchant[] = [
  { id: "m_demo_pine", name: "Store Pine", host: "pine.example", platform: null, sourceId: DEMO_SOURCE_A },
  { id: "m_demo_cedar", name: "Store Cedar", host: "cedar.example", platform: null, sourceId: DEMO_SOURCE_A },
  { id: "m_demo_maple", name: "Store Maple", host: "maple.example", platform: null, sourceId: DEMO_SOURCE_A },
  { id: "m_demo_birch", name: "Store Birch", host: "birch.example", platform: null, sourceId: DEMO_SOURCE_A },
  { id: "m_demo_spruce", name: "Store Spruce", host: "spruce.example", platform: null, sourceId: DEMO_SOURCE_B },
  { id: "m_demo_tidewater", name: "Tidewater Goods", host: "harbour-market.example", platform: "Harbour Market", sourceId: DEMO_SOURCE_B },
];

export type DemoVariant = {
  id: string;
  modelCode: string;
  label: string;
  attributes: Record<string, string>;
  gtin: string;
};

export type DemoProduct = {
  id: string;
  brand: string;
  family: string;
  title: string;
  category: "headphones" | "monitors" | "small_appliances";
  description: string;
  variants: DemoVariant[];
};

let gtinSeq = 0;
/** GTIN-13 in the restricted-circulation range: "2" + "07" + 9-digit sequence + check digit. */
function demoGtin(): string {
  gtinSeq += 1;
  const body = `207${String(gtinSeq).padStart(9, "0")}`;
  return body + gtinCheckDigit(body);
}
/** A GTIN-12 (UPC-A) with a leading zero, to exercise leading-zero preservation. */
const UPC_BODY = "02070000999";
export const DEMO_UPC12 = UPC_BODY + gtinCheckDigit(UPC_BODY);
/** A GTIN-13 with a deliberately wrong check digit (G07). */
const BAD_BODY = "207000000000";
export const DEMO_BAD_CHECK_GTIN = BAD_BODY + String((Number(gtinCheckDigit(BAD_BODY)) + 1) % 10);

const v = (id: string, modelCode: string, label: string, attributes: Record<string, string>, gtin?: string): DemoVariant => ({
  id,
  modelCode,
  label,
  attributes: { market: "CA", ...attributes },
  gtin: gtin ?? demoGtin(),
});

export const DEMO_PRODUCTS: DemoProduct[] = [
  // ── Headphones ──────────────────────────────────────────────────────────────
  {
    id: "prod_demo_northline_quiet2",
    brand: "Northline",
    family: "Quiet 2",
    title: "Northline Quiet 2 noise-cancelling headphones",
    category: "headphones",
    description: "Over-ear wireless headphones with active noise cancellation.",
    variants: [
      v("var_demo_quiet2_black", "NL-Q2", "Black, standard bundle", { model_generation: "2", colour: "Black", connectivity: "Bluetooth", bundle: "Standard", form_factor: "Over-ear" }),
      v("var_demo_quiet2_sand", "NL-Q2", "Sand, standard bundle", { model_generation: "2", colour: "Sand", connectivity: "Bluetooth", bundle: "Standard", form_factor: "Over-ear" }),
      v("var_demo_quiet2_travel", "NL-Q2-TB", "Black, travel bundle (hard case + airline adapter)", { model_generation: "2", colour: "Black", connectivity: "Bluetooth", bundle: "Travel", form_factor: "Over-ear" }),
    ],
  },
  {
    id: "prod_demo_northline_pulse",
    brand: "Northline",
    family: "Pulse Buds",
    title: "Northline Pulse Buds true wireless earbuds",
    category: "headphones",
    description: "In-ear wireless earbuds with charging case.",
    variants: [
      v("var_demo_pulse_black", "NL-PB1", "Black", { model_generation: "1", colour: "Black", connectivity: "Bluetooth", bundle: "Standard", form_factor: "In-ear" }),
      v("var_demo_pulse_white", "NL-PB1", "White", { model_generation: "1", colour: "White", connectivity: "Bluetooth", bundle: "Standard", form_factor: "In-ear" }),
      v("var_demo_pulse_sage", "NL-PB1", "Sage", { model_generation: "1", colour: "Sage", connectivity: "Bluetooth", bundle: "Standard", form_factor: "In-ear" }),
    ],
  },
  {
    id: "prod_demo_fernway_studio",
    brand: "Fernway",
    family: "Studio One",
    title: "Fernway Studio One headphones",
    category: "headphones",
    description: "Closed-back studio headphones. The wired and wireless models are different products with similar names.",
    variants: [
      v("var_demo_studio1_wired", "FW-S1", "Wired, black", { model_generation: "1", colour: "Black", connectivity: "Wired", bundle: "Standard", form_factor: "Over-ear" }, DEMO_UPC12),
      v("var_demo_studio1w_black", "FW-S1W", "Wireless, black", { model_generation: "1", colour: "Black", connectivity: "Bluetooth", bundle: "Standard", form_factor: "Over-ear" }),
      v("var_demo_studio1w_white", "FW-S1W", "Wireless, white", { model_generation: "1", colour: "White", connectivity: "Bluetooth", bundle: "Standard", form_factor: "Over-ear" }),
    ],
  },
  {
    id: "prod_demo_fernway_airlite",
    brand: "Fernway",
    family: "Air Lite 3",
    title: "Fernway Air Lite 3 on-ear headphones",
    category: "headphones",
    description: "Lightweight on-ear wireless headphones.",
    variants: [
      v("var_demo_airlite_black", "FW-AL3", "Black", { model_generation: "3", colour: "Black", connectivity: "Bluetooth", bundle: "Standard", form_factor: "On-ear" }),
      v("var_demo_airlite_blue", "FW-AL3", "Blue", { model_generation: "3", colour: "Blue", connectivity: "Bluetooth", bundle: "Standard", form_factor: "On-ear" }),
    ],
  },
  // ── Monitors ────────────────────────────────────────────────────────────────
  {
    id: "prod_demo_clearpeak_cp27q",
    brand: "Clearpeak",
    family: "CP27Q",
    title: "Clearpeak CP27Q 27-inch QHD monitor",
    category: "monitors",
    description: "27-inch 2560×1440 IPS monitor. The -H model is a different 144 Hz variant.",
    variants: [
      v("var_demo_monitor_27_qhd", "CP27Q", "27 in, QHD, 75 Hz", { screen_size_in: "27", resolution: "2560x1440", refresh_hz: "75", bundle: "Standard", panel: "IPS" }),
      v("var_demo_monitor_27_qhd_144", "CP27Q-H", "27 in, QHD, 144 Hz", { screen_size_in: "27", resolution: "2560x1440", refresh_hz: "144", bundle: "Standard", panel: "IPS" }),
    ],
  },
  {
    id: "prod_demo_clearpeak_cp24f",
    brand: "Clearpeak",
    family: "CP24F",
    title: "Clearpeak CP24F 24-inch Full HD monitor",
    category: "monitors",
    description: "24-inch 1920×1080 monitor for everyday work.",
    variants: [v("var_demo_monitor_24_fhd", "CP24F", "24 in, FHD, 75 Hz", { screen_size_in: "24", resolution: "1920x1080", refresh_hz: "75", bundle: "Standard", panel: "IPS" })],
  },
  {
    id: "prod_demo_clearpeak_cp32u",
    brand: "Clearpeak",
    family: "CP32U",
    title: "Clearpeak CP32U 32-inch 4K monitor",
    category: "monitors",
    description: "32-inch 3840×2160 monitor.",
    variants: [v("var_demo_monitor_32_uhd", "CP32U", "32 in, 4K, 60 Hz", { screen_size_in: "32", resolution: "3840x2160", refresh_hz: "60", bundle: "Standard", panel: "VA" })],
  },
  {
    id: "prod_demo_vantro_v27",
    brand: "Vantro",
    family: "V27 Studio",
    title: "Vantro V27 Studio 27-inch monitor",
    category: "monitors",
    description: "27-inch QHD monitor; also sold with a height-adjustable stand as a separate bundle.",
    variants: [
      v("var_demo_vantro_v27", "VT-2716", "27 in, QHD, 165 Hz", { screen_size_in: "27", resolution: "2560x1440", refresh_hz: "165", bundle: "Standard", panel: "IPS" }),
      v("var_demo_vantro_v27_stand", "VT-2716-S", "27 in, QHD, 165 Hz, with height-adjustable stand", { screen_size_in: "27", resolution: "2560x1440", refresh_hz: "165", bundle: "Stand", panel: "IPS" }),
    ],
  },
  {
    id: "prod_demo_vantro_v24",
    brand: "Vantro",
    family: "V24 Office",
    title: "Vantro V24 Office 24-inch monitor",
    category: "monitors",
    description: "24-inch Full HD office monitor.",
    variants: [v("var_demo_vantro_v24", "VT-2410", "24 in, FHD, 60 Hz", { screen_size_in: "24", resolution: "1920x1080", refresh_hz: "60", bundle: "Standard", panel: "VA" })],
  },
  {
    id: "prod_demo_vantro_v34",
    brand: "Vantro",
    family: "V34 Wide",
    title: "Vantro V34 Wide 34-inch ultrawide monitor",
    category: "monitors",
    description: "34-inch 3440×1440 curved ultrawide monitor.",
    variants: [v("var_demo_vantro_v34", "VT-3440", "34 in, UWQHD, 100 Hz", { screen_size_in: "34", resolution: "3440x1440", refresh_hz: "100", bundle: "Standard", panel: "VA" })],
  },
  // ── Small appliances ────────────────────────────────────────────────────────
  {
    id: "prod_demo_hearthwell_kettle",
    brand: "Hearthwell",
    family: "Brew Kettle",
    title: "Hearthwell Brew Kettle electric kettle",
    category: "small_appliances",
    description: "Electric kettle. 1.7 L and 1.0 L are different variants; the 2-pack is a separate multipack.",
    variants: [
      v("var_demo_kettle_17_steel", "HW-K17", "1.7 L, stainless", { capacity: "1.7 L", colour: "Stainless", voltage: "120 V", bundle: "Single", appliance_type: "Kettle" }),
      v("var_demo_kettle_17_black", "HW-K17", "1.7 L, black", { capacity: "1.7 L", colour: "Black", voltage: "120 V", bundle: "Single", appliance_type: "Kettle" }),
      v("var_demo_kettle_10_steel", "HW-K10", "1.0 L, stainless", { capacity: "1.0 L", colour: "Stainless", voltage: "120 V", bundle: "Single", appliance_type: "Kettle" }),
      v("var_demo_kettle_17_2pk", "HW-K17-2PK", "1.7 L, stainless, 2-pack", { capacity: "1.7 L", colour: "Stainless", voltage: "120 V", bundle: "2-pack", appliance_type: "Kettle" }),
    ],
  },
  {
    id: "prod_demo_hearthwell_toaster",
    brand: "Hearthwell",
    family: "Toast",
    title: "Hearthwell Toast toaster",
    category: "small_appliances",
    description: "Stainless toaster in 2-slice and 4-slice sizes.",
    variants: [
      v("var_demo_toaster_2", "HW-T2", "2-slice, silver", { capacity: "2 slice", colour: "Silver", voltage: "120 V", bundle: "Single", appliance_type: "Toaster" }),
      v("var_demo_toaster_4", "HW-T4", "4-slice, silver", { capacity: "4 slice", colour: "Silver", voltage: "120 V", bundle: "Single", appliance_type: "Toaster" }),
    ],
  },
  {
    id: "prod_demo_kitchory_blend",
    brand: "Kitchory",
    family: "Blend Mini",
    title: "Kitchory Blend Mini personal blender",
    category: "small_appliances",
    description: "600 mL personal blender.",
    variants: [
      v("var_demo_blend_grey", "KC-BM6", "600 mL, grey", { capacity: "600 mL", colour: "Grey", voltage: "120 V", bundle: "Single", appliance_type: "Blender" }),
      v("var_demo_blend_red", "KC-BM6", "600 mL, red", { capacity: "600 mL", colour: "Red", voltage: "120 V", bundle: "Single", appliance_type: "Blender" }),
    ],
  },
  {
    id: "prod_demo_kitchory_rice",
    brand: "Kitchory",
    family: "Rice Cooker",
    title: "Kitchory rice cooker",
    category: "small_appliances",
    description: "Rice cooker in 5-cup and 10-cup capacities.",
    variants: [
      v("var_demo_rice_5", "KC-RC5", "5-cup", { capacity: "5 cup", colour: "White", voltage: "120 V", bundle: "Single", appliance_type: "Rice cooker" }),
      v("var_demo_rice_10", "KC-RC10", "10-cup", { capacity: "10 cup", colour: "White", voltage: "120 V", bundle: "Single", appliance_type: "Rice cooker" }),
    ],
  },
  {
    id: "prod_demo_kitchory_airfryer",
    brand: "Kitchory",
    family: "Air Fryer",
    title: "Kitchory air fryer",
    category: "small_appliances",
    description: "Basket air fryer in 4 L and 6 L capacities.",
    variants: [
      v("var_demo_airfryer_4", "KC-AF4", "4 L", { capacity: "4 L", colour: "Black", voltage: "120 V", bundle: "Single", appliance_type: "Air fryer" }),
      v("var_demo_airfryer_6", "KC-AF6", "6 L", { capacity: "6 L", colour: "Black", voltage: "120 V", bundle: "Single", appliance_type: "Air fryer" }),
    ],
  },
];

export const DEMO_VARIANTS: Array<DemoVariant & { product: DemoProduct }> = DEMO_PRODUCTS.flatMap((p) => p.variants.map((x) => ({ ...x, product: p })));

// ── Listings ──────────────────────────────────────────────────────────────────────────────

export type DemoShipping =
  | { kind: "known"; minor: number }
  | { kind: "unknown"; reason: string }
  | { kind: "threshold"; freeAtOrAboveMinor: number; belowMinor: number | null };

export type DemoListing = {
  externalListingId: string;
  sourceId: string;
  merchantId: string;
  /** Variant the listing describes, or null for deliberately unmatchable listings. */
  describes: string | null;
  title?: string;
  brand?: string | null;
  model?: string | null;
  identifiers?: Array<{ kind: "gtin" | "mpn"; value: string }>;
  attributes?: Record<string, string>;
  condition?: "new" | "refurbished" | "used" | "unknown";
  stock?: "in_stock" | "out_of_stock" | "unknown";
  priceMinor: number | null;
  currency?: "CAD" | "USD";
  shipping: DemoShipping;
  feesMinor?: number | null;
  restrictions?: Array<{ kind: "membership"; program: string }>;
  /** Minutes between the source's observation and our fetch. Large values make stale offers. */
  observedLagMinutes?: number;
  /** Scenario label for docs/tests. */
  scenario?: string;
};

const FREE: DemoShipping = { kind: "known", minor: 0 };
const ship = (minor: number): DemoShipping => ({ kind: "known", minor });
const UNKNOWN: DemoShipping = { kind: "unknown", reason: "Store feed does not include shipping for this item" };

function variantById(id: string) {
  const x = DEMO_VARIANTS.find((d) => d.id === id);
  if (!x) throw new Error(`unknown demo variant ${id}`);
  return x;
}

const merchantSource = (merchantId: string) => DEMO_MERCHANTS.find((m) => m.id === merchantId)!.sourceId;

let listingSeq = 100;
/** Ordinary listing that faithfully describes a variant. */
function L(variantId: string, merchantId: string, priceMinor: number | null, shipping: DemoShipping, extra: Partial<DemoListing> = {}): DemoListing {
  listingSeq += 1;
  const prefix = merchantId.replace("m_demo_", "").slice(0, 2).toUpperCase();
  return {
    externalListingId: `${prefix}-${listingSeq}`,
    sourceId: merchantSource(merchantId),
    merchantId,
    describes: variantId,
    priceMinor,
    shipping,
    ...extra,
  };
}

// Golden scenarios first (stable IDs referenced by tests and docs).
const GOLDEN: DemoListing[] = [
  // G01/G02 on the spec's example monitor.
  { ...L("var_demo_monitor_27_qhd", "m_demo_pine", 19999, ship(999)), externalListingId: "PN-204", scenario: "G01 item 199.99 + 9.99 shipping" },
  { ...L("var_demo_monitor_27_qhd", "m_demo_cedar", 20500, FREE), externalListingId: "CE-310", scenario: "G01 205.00 confirmed free shipping" },
  { ...L("var_demo_monitor_27_qhd", "m_demo_maple", 18999, UNKNOWN), externalListingId: "MA-118", scenario: "G02 shipping unknown" },
  // G03: USD offer for the same variant (marketplace).
  { ...L("var_demo_monitor_27_qhd", "m_demo_tidewater", 14999, ship(1500), { currency: "USD" }), externalListingId: "HM-9001", scenario: "G03 USD offer" },
  // G04: same title stem, different model suffix → belongs to CP27Q-H, never CP27Q.
  { ...L("var_demo_monitor_27_qhd_144", "m_demo_pine", 26999, FREE), externalListingId: "PN-205", scenario: "G04 -H suffix is a different variant" },
  {
    ...L("var_demo_monitor_27_qhd", "m_demo_birch", 17999, FREE),
    externalListingId: "BI-777",
    describes: null,
    title: "Clearpeak CP27QX 27-inch QHD monitor",
    model: "CP27QX",
    identifiers: [],
    scenario: "G04 unknown suffix: review candidate, not merged",
  },
  // G05: GTIN of the 1.7 L kettle but the listing says 1.0 L → quarantined.
  {
    ...L("var_demo_kettle_17_steel", "m_demo_birch", 3999, FREE),
    externalListingId: "BI-512",
    describes: null,
    title: "Hearthwell Brew Kettle 1.0L stainless",
    attributes: { capacity: "1.0 L", colour: "Stainless", voltage: "120 V", bundle: "Single", market: "CA" },
    scenario: "G05 identifier/capacity conflict",
  },
  // G06: refurbished offer for Quiet 2 black (separate condition group).
  { ...L("var_demo_quiet2_black", "m_demo_birch", 24999, FREE, { condition: "refurbished" }), externalListingId: "BI-220", scenario: "G06 refurbished" },
  // G07: invalid identifier and no model.
  {
    ...L("var_demo_toaster_2", "m_demo_maple", 4999, FREE),
    externalListingId: "MA-404",
    describes: null,
    model: null,
    identifiers: [{ kind: "gtin", value: DEMO_BAD_CHECK_GTIN }],
    title: "Hearthwell toaster",
    scenario: "G07 invalid check digit",
  },
  // G08: members-only price.
  { ...L("var_demo_pulse_black", "m_demo_birch", 8999, FREE, { restrictions: [{ kind: "membership", program: "Birch Rewards" }] }), externalListingId: "BI-330", scenario: "G08 members-only price" },
  // G09: free shipping only at or above CAD 250; item is CAD 205.
  { ...L("var_demo_vantro_v27", "m_demo_spruce", 20500, { kind: "threshold", freeAtOrAboveMinor: 25000, belowMinor: null }), externalListingId: "SP-250", scenario: "G09 threshold shipping" },
  // Stale: source reports an observation 9 hours old; re-fetching cannot hide its age.
  { ...L("var_demo_monitor_24_fhd", "m_demo_maple", 12999, FREE, { observedLagMinutes: 9 * 60 }), externalListingId: "MA-240", scenario: "Stale source observation" },
  // Out of stock.
  { ...L("var_demo_monitor_32_uhd", "m_demo_cedar", 38999, FREE, { stock: "out_of_stock" }), externalListingId: "CE-320", scenario: "Out of stock" },
  // Leading-zero GTIN-12 supplied with and without the leading zero.
  { ...L("var_demo_studio1_wired", "m_demo_pine", 12999, FREE, { identifiers: [{ kind: "gtin", value: DEMO_UPC12 }] }), externalListingId: "PN-601", scenario: "GTIN-12" },
  { ...L("var_demo_studio1_wired", "m_demo_cedar", 13499, FREE, { identifiers: [{ kind: "gtin", value: `0${DEMO_UPC12}` }] }), externalListingId: "CE-601", scenario: "GTIN-13 with leading zero" },
];

// Ordinary offers: three or so per variant, deterministic prices.
const BASE: Record<string, number> = {
  var_demo_quiet2_black: 32999, var_demo_quiet2_sand: 32999, var_demo_quiet2_travel: 37999,
  var_demo_pulse_black: 12999, var_demo_pulse_white: 12999, var_demo_pulse_sage: 13499,
  var_demo_studio1_wired: 12999, var_demo_studio1w_black: 17999, var_demo_studio1w_white: 17999,
  var_demo_airlite_black: 7999, var_demo_airlite_blue: 7999,
  var_demo_monitor_27_qhd: 20500, var_demo_monitor_27_qhd_144: 27999, var_demo_monitor_24_fhd: 14999, var_demo_monitor_32_uhd: 42999,
  var_demo_vantro_v27: 31999, var_demo_vantro_v27_stand: 35999, var_demo_vantro_v24: 13999, var_demo_vantro_v34: 54999,
  var_demo_kettle_17_steel: 5999, var_demo_kettle_17_black: 5999, var_demo_kettle_10_steel: 4999, var_demo_kettle_17_2pk: 10999,
  var_demo_toaster_2: 4999, var_demo_toaster_4: 7999,
  var_demo_blend_grey: 4499, var_demo_blend_red: 4499,
  var_demo_rice_5: 6999, var_demo_rice_10: 9999,
  var_demo_airfryer_4: 8999, var_demo_airfryer_6: 11999,
};

const ORDINARY_STORES: Array<{ m: string; delta: number; shipping: (base: number) => DemoShipping }> = [
  { m: "m_demo_pine", delta: -500, shipping: (b) => (b >= 10000 ? FREE : ship(799)) },
  { m: "m_demo_cedar", delta: 0, shipping: () => FREE },
  { m: "m_demo_maple", delta: -1000, shipping: () => ship(1299) },
  { m: "m_demo_spruce", delta: 300, shipping: () => ship(499) },
];

const ORDINARY: DemoListing[] = [];
Object.entries(BASE).forEach(([variantId, base], i) => {
  // Each variant gets three ordinary stores, rotating which store is omitted.
  const omit = i % ORDINARY_STORES.length;
  ORDINARY_STORES.forEach((s, j) => {
    if (j === omit) return;
    // Skip combinations already covered by golden listings.
    if (GOLDEN.some((g) => g.describes === variantId && g.merchantId === s.m && g.condition !== "refurbished")) return;
    const price = base + s.delta + ((i * 37 + j * 113) % 7) * 100;
    ORDINARY.push(L(variantId, s.m, price, s.shipping(price), { observedLagMinutes: (i * 7 + j * 11) % 45 }));
  });
});

export const DEMO_LISTINGS: DemoListing[] = [...GOLDEN, ...ORDINARY];

/** Build the source-shaped fields for a listing from its variant, applying scenario overrides. */
export function demoListingFields(l: DemoListing) {
  const target = l.describes ?? null;
  // Unmatchable listings still borrow a base variant for defaults.
  const baseVariantId = target ?? GOLDEN_BASE[l.externalListingId] ?? null;
  const base = baseVariantId ? variantById(baseVariantId) : null;
  return {
    title: l.title ?? (base ? `${base.product.brand} ${base.product.family} ${base.modelCode} — ${base.label}` : "Unknown item"),
    brand: l.brand !== undefined ? l.brand : (base?.product.brand ?? null),
    model: l.model !== undefined ? l.model : (base?.modelCode ?? null),
    identifiers: l.identifiers ?? (base ? [{ kind: "gtin" as const, value: base.gtin }] : []),
    attributes: l.attributes ?? (base ? { ...base.attributes } : {}),
    categoryHint: base?.product.category ?? null,
  };
}

/** Golden unmatchable listings and the variant whose defaults they borrow. */
const GOLDEN_BASE: Record<string, string> = {
  "BI-777": "var_demo_monitor_27_qhd",
  "BI-512": "var_demo_kettle_17_steel",
  "MA-404": "var_demo_toaster_2",
};
