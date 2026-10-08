import type { AppDatabase } from "../db/AppDatabase.ts";

/** Explicit ownership of charging; independent of historical data sources. */
export async function externalChargingVehicles(
  db: AppDatabase,
): Promise<Set<string>> {
  const raw = await db.getConfig("external_charging_vehicles");
  if (!raw) return new Set();
  const value: unknown = JSON.parse(raw);
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Invalid external charging ownership configuration");
  }
  return new Set(
    Object.entries(value).filter(([, external]) => external === true).map((
      [id],
    ) => id),
  );
}

export async function isExternallyControlled(
  db: AppDatabase,
  id: string,
): Promise<boolean> {
  return (await externalChargingVehicles(db)).has(id);
}
