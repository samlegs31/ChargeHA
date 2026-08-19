import {
  PluginDependencies,
  type PluginDependenciesInit,
} from "@chargeha/server/bootstrap/PluginDependencies";
import type { VehiclePluginRegistry } from "@chargeha/server/bootstrap/VehiclePluginRegistry";
import type { EnergyPluginRegistry } from "@chargeha/server/bootstrap/EnergyPluginRegistry";
import { TeslaVehiclePlugin } from "./vehicles/tesla/server/index.ts";
import { TeslaProxyManager } from "./vehicles/tesla/server/TeslaProxyManager.ts";
import { FroniusLocalPlugin } from "./energy/fronius-local/server/index.ts";
import { FroniusCloudPlugin } from "./energy/fronius-cloud/server/index.ts";
import { SigenergyLocalPlugin } from "./energy/sigenergy-local/server/index.ts";
import { EnphaseLocalPlugin } from "./energy/enphase-local/server/index.ts";

/**
 * Instantiate the production plugins supported by E.V. Solar and register each
 * with its registry. Development-only simulated adapters are intentionally not
 * registered in production.
 *
 * The encryption key does not appear in this signature on purpose — secret
 * storage is encapsulated inside `AppDatabase`.
 */
export function registerPlugins(
  host: Omit<PluginDependenciesInit, "pluginId">,
  vehicleRegistry: VehiclePluginRegistry,
  energyRegistry: EnergyPluginRegistry,
): void {
  const make = (id: string) =>
    PluginDependencies.create({ ...host, pluginId: id });

  const teslaDeps = make("tesla");
  vehicleRegistry.register(
    new TeslaVehiclePlugin(
      teslaDeps,
      new TeslaProxyManager(teslaDeps, teslaDeps.log),
    ),
  );
  energyRegistry.register(new FroniusLocalPlugin(make("fronius_local")));
  energyRegistry.register(new FroniusCloudPlugin(make("fronius_cloud")));
  energyRegistry.register(new SigenergyLocalPlugin(make("sigenergy_local")));
  energyRegistry.register(new EnphaseLocalPlugin(make("enphase_local")));
}
