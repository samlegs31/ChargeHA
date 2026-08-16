import type { AnyRouter } from "@trpc/server";
import type { EnergySourceAdapter } from "@chargeha/shared";
import type { PluginDependencies } from "@chargeha/server/bootstrap/PluginDependencies";
import type { EnergyPlugin, PluginHealthCheck } from "@chargeha/plugins/types";
import { FRONIUS_CLOUD_SECRET_KEYS, froniusCloudConfigDef } from "./config.ts";
import { FroniusCloudAdapter } from "./FroniusCloudAdapter.ts";
import { createFroniusCloudRouter } from "./router.ts";

/**
 * Fronius Solar.web guest energy plugin — reads the public read-only guest
 * dashboard without storing a Solar.web password or using the paid Query API.
 */
export class FroniusCloudPlugin implements EnergyPlugin {
  readonly id = "fronius_cloud";
  readonly displayName = "Fronius (Solar.web Guest)";
  readonly vendor = "Fronius";
  readonly settingsComponentKey = "fronius-cloud-config";
  readonly configDef = froniusCloudConfigDef;
  readonly secretKeys = FRONIUS_CLOUD_SECRET_KEYS;

  constructor(private readonly deps: PluginDependencies) {
    deps.log.info("Fronius Solar.web guest plugin initialized");
  }

  async createAdapter(): Promise<EnergySourceAdapter> {
    const guestUrl = await this.deps.getConfig("guest_url");
    if (!guestUrl) {
      throw new Error("Solar.web guest link is not configured");
    }
    return new FroniusCloudAdapter(guestUrl, this.deps.log);
  }

  shutdown(): Promise<void> {
    return Promise.resolve();
  }

  getRouter(): AnyRouter {
    return createFroniusCloudRouter(this.deps);
  }

  getHealthChecks(): PluginHealthCheck[] {
    return [];
  }
}
