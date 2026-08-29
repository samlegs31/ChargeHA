import { describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { ControllerEngine } from "../ControllerEngine.ts";
import { makeInput } from "../test-helpers/controller-engine.ts";

describe("ControllerEngine — unavailable energy", () => {
  it("never starts an automatic charge without live energy", () => {
    const engine = new ControllerEngine();
    const output = engine.decide(makeInput({
      energyUnavailable: true,
      energyUnavailableDetail: "Energy inverter poll failed",
    }));

    expect(output.decisions.get("V1")?.action).toBe("none");
    expect(output.decisions.get("V1")?.reason).toBe("energy_unavailable");
  });

  it("drops to minimum immediately and stops after 90 seconds", () => {
    const engine = new ControllerEngine();
    const startedAt = Date.now();
    const first = engine.decide(makeInput({
      energyUnavailable: true,
      vehicle: { state: { isCharging: true, chargeAmps: 16 } },
      timestamp: startedAt,
    }));

    expect(first.decisions.get("V1")?.action).toBe("adjust_amps");
    expect(first.decisions.get("V1")?.targetAmps).toBe(5);

    const expired = engine.decide(makeInput({
      energyUnavailable: true,
      vehicle: { state: { isCharging: true, chargeAmps: 5 } },
      timestamp: startedAt + 90_000,
    }));
    expect(expired.decisions.get("V1")?.action).toBe("stop");
    expect(expired.decisions.get("V1")?.reason).toBe("energy_unavailable");
  });

  it("keeps explicit Charge Now authoritative", () => {
    const engine = new ControllerEngine();
    const output = engine.decide(makeInput({
      energyUnavailable: true,
      vehicle: { mode: "charge_now" },
    }));

    expect(output.decisions.get("V1")?.action).toBe("start");
    expect(output.decisions.get("V1")?.reason).toBe("charge_now");
  });
});
