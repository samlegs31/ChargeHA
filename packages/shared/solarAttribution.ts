/**
 * Per-vehicle Solar / Battery / Grid attribution for home charging.
 *
 * batteryPowerW convention:
 *   > 0 = home battery discharging
 *   < 0 = home battery charging
 *
 * Attribution convention:
 *   1. Non-EV home consumption is supplied first.
 *   2. Remaining solar can supply EV charging.
 *   3. Remaining home-battery discharge can supply EV charging.
 *   4. Remaining EV demand is attributed to grid.
 *
 * Multiple EVs share each available source proportionally according to
 * their share of the total EV charging power.
 *
 * Invariant:
 *   solarW + batteryW + gridW === chargePowerW
 */
export function calculateSolarAttribution(
  chargePowerW: number,
  totalChargePowerW: number,
  solarProductionW: number,
  homeConsumptionW: number,
  batteryPowerW = 0,
): { solarW: number; batteryW: number; gridW: number } {
  const safeChargePowerW = Math.max(0, chargePowerW);
  const safeTotalChargePowerW = Math.max(0, totalChargePowerW);

  const vehicleShare = safeTotalChargePowerW > 0
    ? safeChargePowerW / safeTotalChargePowerW
    : 1;

  // Home consumption reported by the inverter normally includes EV charging.
  const nonEvHomeW = Math.max(
    0,
    homeConsumptionW - safeTotalChargePowerW,
  );

  const solarProduction = Math.max(0, solarProductionW);
  const batteryDischargeW = Math.max(0, batteryPowerW);

  // Serve ordinary house consumption first from live solar.
  const solarToNonEvHomeW = Math.min(
    solarProduction,
    nonEvHomeW,
  );

  const remainingNonEvHomeW = Math.max(
    0,
    nonEvHomeW - solarToNonEvHomeW,
  );

  // Then use battery discharge for any remaining ordinary house load.
  const batteryToNonEvHomeW = Math.min(
    batteryDischargeW,
    remainingNonEvHomeW,
  );

  // Remaining generation/discharge is available for EV charging.
  const solarAvailableForEvW = Math.max(
    0,
    solarProduction - solarToNonEvHomeW,
  );

  const batteryAvailableForEvW = Math.max(
    0,
    batteryDischargeW - batteryToNonEvHomeW,
  );

  const solarW = Math.min(
    safeChargePowerW,
    solarAvailableForEvW * vehicleShare,
  );

  const afterSolarW = Math.max(
    0,
    safeChargePowerW - solarW,
  );

  const batteryW = Math.min(
    afterSolarW,
    batteryAvailableForEvW * vehicleShare,
  );

  const gridW = Math.max(
    0,
    safeChargePowerW - solarW - batteryW,
  );

  return { solarW, batteryW, gridW };
}
