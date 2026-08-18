export type TeslaVisualConfig = {
  carType?: string | null;
  exteriorColor?: string | null;
  wheelType?: string | null;
  trim?: string | null;
  roofColor?: string | null;
  spoilerType?: string | null;
};

export type TeslaVisualModel =
  | "model3"
  | "modely"
  | "models"
  | "modelx"
  | "cybertruck"
  | "semi"
  | "unknown";

export type TeslaVisualGeneration =
  | "model3-classic"
  | "model3-highland"
  | "modely-classic"
  | "modely-2025"
  | "models-legacy"
  | "models-refresh"
  | "modelx-legacy"
  | "modelx-refresh"
  | "cybertruck"
  | "semi"
  | "unknown";

export type TeslaPaint = {
  key: string;
  base: string;
  highlight: string;
  shadow: string;
};

export type TeslaWheelVisual = {
  family: string;
  spokes: number;
  dark: boolean;
  cover: boolean;
  turbine: boolean;
};

export type TeslaVisualSpec = {
  model: TeslaVisualModel;
  generation: TeslaVisualGeneration;
  modelYear: number | null;
  paint: TeslaPaint;
  wheel: TeslaWheelVisual;
  performance: boolean;
};

const YEAR_CODES: Record<string, number> = {
  C: 2012,
  D: 2013,
  E: 2014,
  F: 2015,
  G: 2016,
  H: 2017,
  J: 2018,
  K: 2019,
  L: 2020,
  M: 2021,
  N: 2022,
  P: 2023,
  R: 2024,
  S: 2025,
  T: 2026,
  V: 2027,
};

const PAINTS: Record<string, TeslaPaint> = {
  white: { key: "white", base: "#f4f5f6", highlight: "#ffffff", shadow: "#b8bec6" },
  black: { key: "black", base: "#15171b", highlight: "#343942", shadow: "#050607" },
  blue: { key: "blue", base: "#124dc8", highlight: "#3c78ff", shadow: "#082c82" },
  lightBlue: { key: "light-blue", base: "#5d8fdc", highlight: "#9fc2ff", shadow: "#315a99" },
  marineBlue: { key: "marine-blue", base: "#174c72", highlight: "#3f7fa7", shadow: "#0a2d48" },
  red: { key: "red", base: "#b5192c", highlight: "#ef4c5f", shadow: "#650816" },
  cherry: { key: "cherry", base: "#681423", highlight: "#ad4051", shadow: "#350811" },
  silver: { key: "silver", base: "#aeb5be", highlight: "#e2e6eb", shadow: "#6b737d" },
  quicksilver: { key: "quicksilver", base: "#9ba6ac", highlight: "#dbe1e4", shadow: "#58636a" },
  gray: { key: "gray", base: "#5d6269", highlight: "#858c94", shadow: "#2f3338" },
  stealthGray: { key: "stealth-gray", base: "#42484d", highlight: "#6b737a", shadow: "#202428" },
  brown: { key: "brown", base: "#5b463b", highlight: "#8a6b5a", shadow: "#2e211b" },
  green: { key: "green", base: "#35584a", highlight: "#5d806f", shadow: "#1c332a" },
  titanium: { key: "titanium", base: "#8c887e", highlight: "#bbb5a9", shadow: "#555149" },
  stainless: { key: "stainless", base: "#a6aaac", highlight: "#e4e6e7", shadow: "#686d70" },
};

function normalized(value?: string | null): string {
  return (value ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function decodeTeslaModelYear(vin: string): number | null {
  if (vin.length < 10) return null;
  return YEAR_CODES[vin[9]?.toUpperCase()] ?? null;
}

function modelFromVin(vin: string): TeslaVisualModel {
  const series = vin[3]?.toUpperCase();
  if (series === "3") return "model3";
  if (series === "Y") return "modely";
  if (series === "S") return "models";
  if (series === "X") return "modelx";
  return "unknown";
}

export function resolveTeslaModel(
  vin: string,
  carType?: string | null,
): TeslaVisualModel {
  const type = normalized(carType);
  if (type.includes("model3")) return "model3";
  if (type.includes("modely")) return "modely";
  if (type.includes("models")) return "models";
  if (type.includes("modelx")) return "modelx";
  if (type.includes("cybertruck")) return "cybertruck";
  if (type.includes("semitruck") || type === "semi") return "semi";
  return modelFromVin(vin);
}

export function resolveTeslaGeneration(
  model: TeslaVisualModel,
  year: number | null,
): TeslaVisualGeneration {
  if (model === "model3") return year !== null && year >= 2024 ? "model3-highland" : "model3-classic";
  if (model === "modely") return year !== null && year >= 2025 ? "modely-2025" : "modely-classic";
  if (model === "models") return year !== null && year <= 2020 ? "models-legacy" : "models-refresh";
  if (model === "modelx") return year !== null && year <= 2020 ? "modelx-legacy" : "modelx-refresh";
  if (model === "cybertruck") return "cybertruck";
  if (model === "semi") return "semi";
  return "unknown";
}

export function resolveTeslaPaint(exteriorColor?: string | null): TeslaPaint {
  const color = normalized(exteriorColor);
  if (!color) return PAINTS.gray;
  if (color.includes("pearlwhite") || color.includes("basewhite") || color.includes("white")) return PAINTS.white;
  if (color.includes("diamondblack") || color.includes("obsidianblack") || color.includes("solidblack") || color.includes("baseblack") || color.includes("black")) return PAINTS.black;
  if (color.includes("glacierblue") || color.includes("frostblue")) return PAINTS.lightBlue;
  if (color.includes("marineblue")) return PAINTS.marineBlue;
  if (color.includes("deepblue") || color.includes("oceanblue") || color === "blue" || color.includes("ppsb")) return PAINTS.blue;
  if (color.includes("midnightcherry") || color.includes("garnetred") || color.includes("signaturered")) return PAINTS.cherry;
  if (color.includes("ultrared") || color.includes("redmulticoat") || color.includes("basered") || color === "red") return PAINTS.red;
  if (color.includes("quicksilver") || color.includes("cosmicsilver")) return PAINTS.quicksilver;
  if (color.includes("silvermetallic") || color === "silver" || color.includes("lunarsilver")) return PAINTS.silver;
  if (color.includes("stealthgray") || color.includes("stealthgrey")) return PAINTS.stealthGray;
  if (color.includes("midnightsilver") || color.includes("steelgray") || color.includes("steelgrey") || color === "gray" || color === "grey") return PAINTS.gray;
  if (color.includes("titanium")) return PAINTS.titanium;
  if (color.includes("brown")) return PAINTS.brown;
  if (color.includes("green")) return PAINTS.green;
  if (color.includes("shieldblack") || color.includes("stainless")) return PAINTS.stainless;
  return PAINTS.gray;
}

const WHEEL_RULES: Array<{
  tokens: string[];
  family: string;
  spokes: number;
  dark?: boolean;
  cover?: boolean;
  turbine?: boolean;
}> = [
  { tokens: ["stiletto"], family: "stiletto", spokes: 10 },
  { tokens: ["pinwheel", "aero18", "aerowheel", "aerocover"], family: "aero", spokes: 10, cover: true, dark: true },
  { tokens: ["photon"], family: "photon", spokes: 10, cover: true, dark: true },
  { tokens: ["prismata"], family: "prismata", spokes: 10, cover: true, dark: true },
  { tokens: ["nova"], family: "nova", spokes: 10 },
  { tokens: ["warp"], family: "warp", spokes: 10, dark: true, turbine: true },
  { tokens: ["zerog", "zero-g"], family: "zero-g", spokes: 10, dark: true },
  { tokens: ["uberturbine", "uberturbine"], family: "uberturbine", spokes: 10, dark: true, turbine: true },
  { tokens: ["induction"], family: "induction", spokes: 10, dark: true, turbine: true },
  { tokens: ["gemini", "apollo"], family: "gemini", spokes: 10, cover: true },
  { tokens: ["crossflow"], family: "crossflow", spokes: 10, cover: true, dark: true },
  { tokens: ["helix2", "helix20"], family: "helix-2", spokes: 10 },
  { tokens: ["aperture"], family: "aperture", spokes: 8, cover: true, dark: true },
  { tokens: ["machina"], family: "machina", spokes: 10 },
  { tokens: ["arachnid"], family: "arachnid", spokes: 14, dark: true },
  { tokens: ["cardenio"], family: "cardenio", spokes: 10, dark: true },
  { tokens: ["tempest"], family: "tempest", spokes: 10, cover: true, dark: true },
  { tokens: ["magnetite"], family: "magnetite", spokes: 10, dark: true },
  { tokens: ["velarium"], family: "velarium", spokes: 10, dark: true, turbine: true },
  { tokens: ["cyberstream"], family: "cyberstream", spokes: 10, dark: true, turbine: true },
  { tokens: ["riptide"], family: "riptide", spokes: 10, dark: true },
  { tokens: ["halo"], family: "halo", spokes: 10, dark: true },
  { tokens: ["slipstream"], family: "slipstream", spokes: 10 },
  { tokens: ["cyclone"], family: "cyclone", spokes: 10 },
  { tokens: ["turbine"], family: "turbine", spokes: 10, dark: true, turbine: true },
  { tokens: ["wheel20", "wheelcover20", "stealthblack"], family: "cybertruck", spokes: 7, dark: true, cover: true },
];

export function resolveTeslaWheel(wheelType?: string | null): TeslaWheelVisual {
  const value = normalized(wheelType);
  const rule = WHEEL_RULES.find((candidate) =>
    candidate.tokens.some((token) => value.includes(normalized(token)))
  );
  if (!rule) {
    return { family: "generic", spokes: 10, dark: false, cover: false, turbine: false };
  }
  return {
    family: rule.family,
    spokes: rule.spokes,
    dark: rule.dark ?? value.includes("dark") || value.includes("grey") || value.includes("gray"),
    cover: rule.cover ?? false,
    turbine: rule.turbine ?? false,
  };
}

export function resolveTeslaVisualSpec(
  vin: string,
  config?: TeslaVisualConfig | null,
): TeslaVisualSpec {
  const modelYear = decodeTeslaModelYear(vin);
  const model = resolveTeslaModel(vin, config?.carType);
  const trim = normalized(config?.trim);
  return {
    model,
    generation: resolveTeslaGeneration(model, modelYear),
    modelYear,
    paint: model === "cybertruck" && !config?.exteriorColor
      ? PAINTS.stainless
      : resolveTeslaPaint(config?.exteriorColor),
    wheel: resolveTeslaWheel(config?.wheelType),
    performance: trim.includes("performance") || trim.includes("plaid") || trim.startsWith("p"),
  };
}

export const TESLA_DOCUMENTED_WHEEL_FAMILIES = [
  "Aero",
  "Stiletto",
  "Uber Turbine",
  "Zero-G",
  "Nova",
  "Photon",
  "Prismata",
  "Warp",
  "Gemini/Apollo",
  "Induction",
  "Crossflow",
  "Helix 2.0",
  "Aperture",
  "Machina",
  "Arachnid",
  "Cardenio",
  "Tempest",
  "Magnetite",
  "Velarium",
  "Cyberstream",
  "Riptide",
  "Halo",
  "Slipstream",
  "Cyclone",
  "Turbine",
] as const;
