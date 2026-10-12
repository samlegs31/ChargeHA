/** Cosmetic metadata only: never restore battery, charging, location or freshness. */
export type TeslaAppearance = Partial<
  Record<"carType" | "exteriorColor" | "wheelType", string>
>;
export function readAppearance(value: unknown): TeslaAppearance {
  if (!value || typeof value !== "object") return {};
  const result: TeslaAppearance = {};
  for (const key of ["carType", "exteriorColor", "wheelType"] as const) {
    const field = (value as Record<string, unknown>)[key];
    if (typeof field === "string" && field.trim() && field.length <= 128) {
      result[key] = field;
    }
  }
  return result;
}
export function parseAppearance(raw: string | null): TeslaAppearance {
  try {
    return readAppearance(JSON.parse(raw ?? "{}"));
  } catch {
    return {};
  }
}
export interface AppearanceStore {
  initial: TeslaAppearance;
  save: (appearance: TeslaAppearance) => Promise<void>;
}
