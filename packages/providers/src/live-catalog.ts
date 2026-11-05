/**
 * Curated live catalog for the SerpApi Google Shopping source (Canada). Real products, one
 * variant each. A Google Shopping result is attributed to a variant only when its title passes
 * the variant's explicit title rules (see serpapi.ts), so similar models, accessories and
 * bundles are excluded. Listings that don't state a colour are accepted for the listed colour;
 * listings naming another colour are rejected.
 */

export type TitleRules = {
  /** At least one phrase must appear (case/separator-insensitive; trailing "*" = prefix match). */
  any: string[];
  /** Each group needs at least one matching phrase. */
  all?: string[][];
  /** No phrase may appear. */
  none?: string[];
};

export type TrackedVariant = {
  productId: string;
  variantId: string;
  brand: string;
  family: string;
  title: string;
  category: "headphones" | "monitors" | "small_appliances";
  description: string;
  modelCode: string;
  label: string;
  attributes: Record<string, string>;
  /** Google Shopping query (one SerpApi credit per refresh). */
  query: string;
  rules: TitleRules;
  /** New-condition prices below this (minor units, CAD) are implausible for the product; half applies to used/refurbished. */
  priceFloorMinor: number;
};

const hp = (colour: string, extra: Record<string, string> = {}) => ({ market: "CA", model_generation: "1", colour, connectivity: "Bluetooth", bundle: "Standard", ...extra });
const mon = (size: string, resolution: string, hz: string, panel: string) => ({ market: "CA", screen_size_in: size, resolution, refresh_hz: hz, bundle: "Standard", panel });
const app = (capacity: string, colour: string, type: string) => ({ market: "CA", capacity, colour, voltage: "120V", bundle: "Standard", appliance_type: type });

export const LIVE_VARIANTS: TrackedVariant[] = [
  // ── Headphones ──────────────────────────────────────────────────────────────
  {
    productId: "prod_live_sony_wh1000xm5",
    variantId: "var_live_sony_wh1000xm5_black",
    brand: "Sony",
    family: "WH-1000XM5",
    title: "Sony WH-1000XM5 wireless noise-cancelling headphones",
    category: "headphones",
    description: "Over-ear wireless headphones with active noise cancellation.",
    modelCode: "WH-1000XM5",
    label: "Black",
    attributes: hp("Black", { model_generation: "5", form_factor: "Over-ear" }),
    query: "Sony WH-1000XM5 headphones black",
    rules: { any: ["wh-1000xm5*", "wh1000xm5*"], none: ["xm4", "xm6", "silver", "midnight blue", "smoky pink", "blue", "pink", "white", "argent", "blanc", "bleu", "rose", "wh1000xm5 s", "wh 1000xm5 s"] },
    priceFloorMinor: 15000,
  },
  {
    productId: "prod_live_sony_wf1000xm5",
    variantId: "var_live_sony_wf1000xm5_black",
    brand: "Sony",
    family: "WF-1000XM5",
    title: "Sony WF-1000XM5 true wireless noise-cancelling earbuds",
    category: "headphones",
    description: "In-ear wireless earbuds with active noise cancellation and charging case.",
    modelCode: "WF-1000XM5",
    label: "Black",
    attributes: hp("Black", { model_generation: "5", form_factor: "In-ear" }),
    query: "Sony WF-1000XM5 earbuds black",
    rules: { any: ["wf-1000xm5*", "wf1000xm5*"], none: ["xm4", "xm6", "silver", "platinum", "pink", "white", "argent", "blanc", "rose", "wf1000xm5 s", "wf 1000xm5 s"] },
    priceFloorMinor: 12000,
  },
  {
    productId: "prod_live_apple_airpods_pro2",
    variantId: "var_live_apple_airpods_pro2_usbc",
    brand: "Apple",
    family: "AirPods Pro 2",
    title: "Apple AirPods Pro 2 with MagSafe Charging Case (USB-C)",
    category: "headphones",
    description: "In-ear wireless earbuds with active noise cancellation and a USB-C MagSafe charging case.",
    modelCode: "MTJV3AM/A",
    label: "White, USB-C case",
    attributes: hp("White", { model_generation: "2", form_factor: "In-ear" }),
    query: "Apple AirPods Pro 2 USB-C",
    rules: { any: ["airpods pro 2", "airpods pro 2nd", "mtjv3*"], all: [["usb c", "usbc", "mtjv3*"]], none: ["lightning", "airpods pro 3", "3rd gen", "airpods pro 1st"] },
    priceFloorMinor: 12000,
  },
  {
    productId: "prod_live_bose_qc_ultra",
    variantId: "var_live_bose_qc_ultra_black",
    brand: "Bose",
    family: "QuietComfort Ultra Headphones",
    title: "Bose QuietComfort Ultra wireless noise-cancelling headphones",
    category: "headphones",
    description: "Over-ear wireless headphones with active noise cancellation (1st generation).",
    modelCode: "880066-0100",
    label: "Black",
    attributes: hp("Black", { form_factor: "Over-ear" }),
    query: "Bose QuietComfort Ultra Headphones black",
    rules: { any: ["quietcomfort ultra headphones", "qc ultra headphones"], none: ["earbuds", "2nd gen", "2nd generation", "white smoke", "sandstone", "lunar blue", "driftwood", "white", "blue"] },
    priceFloorMinor: 20000,
  },
  {
    productId: "prod_live_samsung_buds3_pro",
    variantId: "var_live_samsung_buds3_pro_silver",
    brand: "Samsung",
    family: "Galaxy Buds3 Pro",
    title: "Samsung Galaxy Buds3 Pro true wireless earbuds",
    category: "headphones",
    description: "In-ear wireless earbuds with active noise cancellation.",
    modelCode: "SM-R630",
    label: "Silver",
    attributes: hp("Silver", { model_generation: "3", form_factor: "In-ear" }),
    query: "Samsung Galaxy Buds3 Pro silver",
    rules: { any: ["buds3 pro", "buds 3 pro", "sm-r630*"], none: ["white", "blanc", "buds3 fe", "buds 3 fe"] },
    priceFloorMinor: 10000,
  },
  // ── Monitors ────────────────────────────────────────────────────────────────
  {
    productId: "prod_live_dell_s2725ds",
    variantId: "var_live_dell_s2725ds",
    brand: "Dell",
    family: "S2725DS",
    title: "Dell 27 Plus QHD monitor S2725DS",
    category: "monitors",
    description: "27-inch QHD IPS monitor, 100 Hz.",
    modelCode: "S2725DS",
    label: "27\", 2560×1440, 100 Hz",
    attributes: mon("27", "2560x1440", "100", "IPS"),
    query: "Dell S2725DS monitor",
    rules: { any: ["s2725ds"] },
    priceFloorMinor: 15000,
  },
  {
    productId: "prod_live_dell_u2723qe",
    variantId: "var_live_dell_u2723qe",
    brand: "Dell",
    family: "UltraSharp U2723QE",
    title: "Dell UltraSharp 27 4K USB-C hub monitor U2723QE",
    category: "monitors",
    description: "27-inch 4K IPS Black monitor with USB-C hub.",
    modelCode: "U2723QE",
    label: "27\", 3840×2160, 60 Hz",
    attributes: mon("27", "3840x2160", "60", "IPS Black"),
    query: "Dell UltraSharp U2723QE monitor",
    rules: { any: ["u2723qe"] },
    priceFloorMinor: 35000,
  },
  {
    productId: "prod_live_lg_27gp850",
    variantId: "var_live_lg_27gp850_b",
    brand: "LG",
    family: "UltraGear 27GP850-B",
    title: "LG UltraGear 27GP850-B QHD gaming monitor",
    category: "monitors",
    description: "27-inch QHD Nano IPS gaming monitor, 165 Hz (180 Hz overclocked).",
    modelCode: "27GP850-B",
    label: "27\", 2560×1440, 165 Hz",
    attributes: mon("27", "2560x1440", "165", "Nano IPS"),
    query: "LG 27GP850-B monitor",
    rules: { any: ["27gp850-b", "27gp850 b", "27gp850"], none: ["27gp850p"] },
    priceFloorMinor: 20000,
  },
  {
    productId: "prod_live_asus_vg27aq",
    variantId: "var_live_asus_vg27aq",
    brand: "ASUS",
    family: "TUF Gaming VG27AQ",
    title: "ASUS TUF Gaming VG27AQ QHD gaming monitor",
    category: "monitors",
    description: "27-inch QHD IPS gaming monitor, 165 Hz.",
    modelCode: "VG27AQ",
    label: "27\", 2560×1440, 165 Hz",
    attributes: mon("27", "2560x1440", "165", "IPS"),
    query: "ASUS TUF Gaming VG27AQ monitor",
    rules: { any: ["vg27aq"], none: ["vg27aq1a", "vg27aql", "vg27aql1a", "vg27aq3a", "vg27aqml1a", "vg27aqm"] },
    priceFloorMinor: 15000,
  },
  {
    productId: "prod_live_samsung_odyssey_g5_27",
    variantId: "var_live_samsung_ls27cg510",
    brand: "Samsung",
    family: "Odyssey G5 (G51C)",
    title: "Samsung Odyssey G5 27\" QHD gaming monitor LS27CG510",
    category: "monitors",
    description: "27-inch QHD VA gaming monitor, 165 Hz.",
    modelCode: "LS27CG510",
    label: "27\", 2560×1440, 165 Hz",
    attributes: mon("27", "2560x1440", "165", "VA"),
    query: "Samsung Odyssey G5 LS27CG510 monitor",
    rules: { any: ["ls27cg510*", "s27cg510*", "s27cg51*"] },
    priceFloorMinor: 15000,
  },
  // ── Small appliances ────────────────────────────────────────────────────────
  {
    productId: "prod_live_ninja_af101",
    variantId: "var_live_ninja_af101",
    brand: "Ninja",
    family: "Air Fryer AF100C",
    title: "Ninja Air Fryer AF100C (4 qt)",
    category: "small_appliances",
    description: "3.8 L (4 qt) air fryer (Canadian model AF100C; sold as AF101 in the US).",
    modelCode: "AF100C",
    label: "4 qt, black/grey",
    attributes: app("3.8 L", "Black", "Air fryer"),
    query: "Ninja AF100C air fryer",
    // Exact "af100c" only: AF100CRD (red) and Pro/Max/XL models are different products.
    rules: { any: ["af100c", "af101", "af101c"], none: ["af100crd", "red", "pro", "max xl", "xl"] },
    priceFloorMinor: 5000,
  },
  {
    productId: "prod_live_instant_pot_duo_6qt",
    variantId: "var_live_instant_pot_duo_6qt",
    brand: "Instant Pot",
    family: "Duo 7-in-1",
    title: "Instant Pot Duo 7-in-1 electric pressure cooker, 6 qt",
    category: "small_appliances",
    description: "5.7 L (6 qt) multi-cooker: pressure cooker, slow cooker, rice cooker, steamer and more.",
    modelCode: "IP-DUO60",
    label: "6 qt",
    attributes: app("5.7 L", "Stainless steel", "Multi-cooker"),
    query: "Instant Pot Duo 7-in-1 6 quart",
    rules: {
      any: ["duo 7-in-1", "duo 7 in 1", "ip-duo60*"],
      all: [["6 qt", "6qt", "6 quart", "6-quart", "5.7 l", "5.7l", "5.7 litre", "5.7 liter", "ip-duo60*"]],
      none: ["duo plus", "duo crisp", "duo nova", "duo evo", "duo gourmet", "3 qt", "3qt", "3 quart", "8 qt", "8qt", "8 quart", "mini"],
    },
    priceFloorMinor: 5000,
  },
  {
    productId: "prod_live_ninja_bl610",
    variantId: "var_live_ninja_bl610",
    brand: "Ninja",
    family: "Professional Blender BL610",
    title: "Ninja Professional Blender BL610 (1000 W)",
    category: "small_appliances",
    description: "1000-watt countertop blender with a 72 oz pitcher.",
    modelCode: "BL610C",
    label: "72 oz pitcher, black",
    attributes: app("72 oz", "Black", "Blender"),
    query: "Ninja Professional Blender BL610",
    rules: { any: ["bl610*"] },
    priceFloorMinor: 5000,
  },
  {
    productId: "prod_live_nespresso_vertuo_next",
    variantId: "var_live_nespresso_vertuo_next_black",
    brand: "Nespresso",
    family: "Vertuo Next",
    title: "Nespresso Vertuo Next coffee and espresso machine",
    category: "small_appliances",
    description: "Capsule coffee and espresso machine (without milk frother).",
    modelCode: "VERTUO-NEXT",
    label: "Black, machine only",
    attributes: app("1.1 L", "Black", "Capsule coffee machine"),
    query: "Nespresso Vertuo Next coffee machine black",
    rules: {
      any: ["vertuo next"],
      none: ["aeroccino", "with milk", "frother", "vertuo pop", "vertuo plus", "deluxe", "vertuo lattissima", "vertuo creatista", "white", "grey", "gray", "red", "cherry", "chrome", "light grey", "dark grey", "capsule pack", "pods"],
    },
    priceFloorMinor: 7000,
  },
  {
    productId: "prod_live_keurig_k_mini",
    variantId: "var_live_keurig_k_mini_black",
    brand: "Keurig",
    family: "K-Mini",
    title: "Keurig K-Mini single-serve coffee maker",
    category: "small_appliances",
    description: "Compact single-serve K-Cup pod coffee maker.",
    modelCode: "K-MINI",
    label: "Black",
    attributes: app("0.36 L", "Black", "Pod coffee maker"),
    query: "Keurig K-Mini coffee maker black",
    rules: {
      any: ["k-mini", "k mini"],
      none: ["k-mini plus", "k mini plus", "k-mini basic", "k-mini go", "k mini go", "k-mini mate", "k mini mate", "white", "red", "grey", "gray", "blue", "pink", "studio gray", "poppy red"],
    },
    priceFloorMinor: 4000,
  },
];

export const LIVE_VARIANT_BY_ID = new Map(LIVE_VARIANTS.map((v) => [v.variantId, v]));
