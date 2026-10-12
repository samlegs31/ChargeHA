import { assertEquals } from "@std/assert";
import { AppDatabase } from "../db/AppDatabase.ts";
import { HistoryRepository } from "../db/repositories/HistoryRepository.ts";
import { StatsService } from "../services/StatsService.ts";
import { buildTotalStats } from "./TotalStats.ts";

Deno.test("total history handles empty data, multiple years and vehicle isolation", async () => {
  const db = new AppDatabase(":memory:");
  try {
    await db.init();
    const service = new StatsService(db);
    const empty = await buildTotalStats(db, service, 0);
    assertEquals(empty.buckets, []);
    assertEquals(empty.totalChargedWh, 0);
    assertEquals(empty.selfPoweredPercent, 0);
    const history = new HistoryRepository(db.db);
    for (const id of ["Friday", "Other"]) {
      await db.upsertVehicle({
        id,
        name: id,
        adapterType: "tesla",
        config: "{}",
        mode: "auto",
        priority: 1,
      });
      for (const year of [2025, 2026]) {
        await history.importChargeHqRows(id, [{
          source: "chargehq",
          externalId: `${id}-${year}`,
          startTimeUtc: `${year}-06-01 12:00:00`,
          startTimeLocal: `${year}-06-01 12:00:00`,
          intervalSeconds: 900,
          chargedWh: 1000,
          solarWh: 600,
          gridWh: 400,
          batteryWh: 0,
          awayWh: 0,
          atHomeWh: 1000,
        }]);
      }
    }
    const own = await buildTotalStats(db, service, 0, "Friday");
    assertEquals(own.totalChargedWh, 2000);
    assertEquals(own.totalSolarWh, 1200);
    assertEquals(own.totalGridWh, 800);
    assertEquals(own.selfPoweredPercent, 60);
    assertEquals(own.buckets.map((b) => b.label), ["2025", "2026"]);
    const all = await buildTotalStats(db, service, 0);
    assertEquals(all.totalChargedWh, 4000);
    assertEquals(
      (await buildTotalStats(db, service, 0, "missing")).totalChargedWh,
      0,
    );
  } finally {
    db.close();
  }
});
