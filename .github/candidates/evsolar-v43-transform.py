from pathlib import Path

ROOT = Path('.')

def replace_once(path: str, old: str, new: str) -> None:
    p = ROOT / path
    text = p.read_text()
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{path}: expected anchor once, found {count}")
    p.write_text(text.replace(old, new, 1))

# Shared package export.
replace_once(
    "packages/shared/deno.json",
    '    "./forecast": "./forecast.ts"\n',
    '    "./forecast": "./forecast.ts",\n    "./inverter": "./inverter.ts"\n',
)

# Typed solar forecast settings.
replace_once(
    "packages/shared/configSections.ts",
    '''  solarForecastArraysJson: {\n    key: "solar_forecast_arrays_json",\n    schema: z.string().max(12000),\n    default: "[]",\n  },\n});''',
    '''  solarForecastArraysJson: {\n    key: "solar_forecast_arrays_json",\n    schema: z.string().max(12000),\n    default: "[]",\n  },\n  solarForecastInverterMode: {\n    key: "solar_forecast_inverter_mode",\n    schema: z.enum(["automatic", "manual"]),\n    default: "automatic" as const,\n  },\n  solarForecastInverterProfileId: {\n    key: "solar_forecast_inverter_profile_id",\n    schema: z.string().max(160),\n    default: "",\n  },\n});''',
)

# New unavailable reason when no exact/selected physical inverter profile exists.
replace_once(
    "packages/shared/forecast.ts",
    '''    | "energy_unavailable"\n    | "weather_unavailable";''',
    '''    | "energy_unavailable"\n    | "inverter_unavailable"\n    | "weather_unavailable";''',
)

# Optional generic inverter capabilities on energy plugins.
replace_once(
    "packages/plugins/types.ts",
    '''import type { VehicleRow } from "@chargeha/server/db/types";\n''',
    '''import type { VehicleRow } from "@chargeha/server/db/types";\nimport type {\n  InverterDetection,\n  InverterProfile,\n} from "@chargeha/shared/inverter";\n''',
)
replace_once(
    "packages/plugins/types.ts",
    '''  createAdapter(): Promise<EnergySourceAdapter>;\n}''',
    '''  createAdapter(): Promise<EnergySourceAdapter>;\n  /** Optional physical inverter profiles exposed to the generic forecast UI. */\n  getInverterProfiles?(): readonly InverterProfile[];\n  /** Optional vendor-owned exact/partial inverter detection. */\n  detectInverterProfile?(): Promise<InverterDetection>;\n}''',
)

# Generic manager: profile catalog + cached automatic detection.
replace_once(
    "packages/server/src/services/EnergyAdapterManager.ts",
    '''import { NullEnergyAdapter } from "./NullEnergyAdapter.ts";\n''',
    '''import { NullEnergyAdapter } from "./NullEnergyAdapter.ts";\nimport type {\n  InverterDetection,\n  InverterProfile,\n} from "@chargeha/shared/inverter";\n''',
)
replace_once(
    "packages/server/src/services/EnergyAdapterManager.ts",
    '''  private simulatedLoadW = 0;\n  private readonly initializationPromise: Promise<void>;''',
    '''  private simulatedLoadW = 0;\n  private inverterDetection: InverterDetection | null = null;\n  private readonly initializationPromise: Promise<void>;''',
)
replace_once(
    "packages/server/src/services/EnergyAdapterManager.ts",
    '''  async getDeviceInfo(): Promise<DeviceInfo> {\n    await this.initializationPromise;\n    if (!this.adapter) {\n      throw new Error("EnergyAdapterManager not initialized");\n    }\n    return this.adapter.getDeviceInfo();\n  }\n\n  // ── Simulated load''',
    '''  async getDeviceInfo(): Promise<DeviceInfo> {\n    await this.initializationPromise;\n    if (!this.adapter) {\n      throw new Error("EnergyAdapterManager not initialized");\n    }\n    return this.adapter.getDeviceInfo();\n  }\n\n  async getInverterProfiles(): Promise<readonly InverterProfile[]> {\n    await this.initializationPromise;\n    if (!this.activeType) return [];\n    const plugin = this.energyPlugins.get(this.activeType);\n    return plugin?.getInverterProfiles?.() ?? [];\n  }\n\n  async getInverterDetection(force = false): Promise<InverterDetection> {\n    await this.initializationPromise;\n    if (!force && this.inverterDetection) return this.inverterDetection;\n    if (!this.activeType) {\n      return {\n        status: "unavailable",\n        profile: null,\n        device: null,\n        message: "No energy source is configured.",\n      };\n    }\n    const plugin = this.energyPlugins.get(this.activeType);\n    if (!plugin?.detectInverterProfile) {\n      return {\n        status: "unavailable",\n        profile: null,\n        device: null,\n        message: "The active energy source does not support inverter detection.",\n      };\n    }\n    try {\n      const detection = await plugin.detectInverterProfile();\n      this.inverterDetection = detection;\n      return detection;\n    } catch (error) {\n      const message = error instanceof Error ? error.message : String(error);\n      return {\n        status: "unavailable",\n        profile: null,\n        device: null,\n        message: `Inverter detection failed: ${message}`,\n      };\n    }\n  }\n\n  // ── Simulated load''',
)
replace_once(
    "packages/server/src/services/EnergyAdapterManager.ts",
    '''    this.adapter = newAdapter;\n    this.logger.info(''',
    '''    this.adapter = newAdapter;\n    this.inverterDetection = null;\n    this.logger.info(''',
)

# Generic energy tRPC endpoints used by Solar Forecast settings.
replace_once(
    "packages/server/src/trpc/routers/energy.ts",
    '''  getPlugins: publicProcedure.query(({ ctx }) => {\n    return ctx.energyManager.getPluginSummaries();\n  }),\n\n  // Returns latest energy snapshot''',
    '''  getPlugins: publicProcedure.query(({ ctx }) => {\n    return ctx.energyManager.getPluginSummaries();\n  }),\n\n  inverterProfiles: publicProcedure.query(async ({ ctx }) => {\n    return { profiles: await ctx.energyManager.getInverterProfiles() };\n  }),\n\n  inverterDetection: publicProcedure.query(({ ctx }) => {\n    return ctx.energyManager.getInverterDetection();\n  }),\n\n  redetectInverter: publicProcedure.mutation(({ ctx }) => {\n    return ctx.energyManager.getInverterDetection(true);\n  }),\n\n  // Returns latest energy snapshot''',
)

# Vendor-specific profiles and conservative Solar API identity detection stay in plugin code.
replace_once(
    "packages/plugins/energy/fronius-local/server/index.ts",
    '''import { createFroniusLocalRouter } from "./router.ts";\n''',
    '''import { createFroniusLocalRouter } from "./router.ts";\nimport {\n  detectFroniusInverterProfile,\n  FRONIUS_INVERTER_PROFILES,\n} from "./FroniusInverterProfiles.ts";\nimport { probeFroniusSunSpec } from "./FroniusSunSpec.ts";\nimport type {\n  InverterDetection,\n  InverterProfile,\n} from "@chargeha/shared/inverter";\n''',
)
replace_once(
    "packages/plugins/energy/fronius-local/server/index.ts",
    '''  shutdown(): Promise<void> {\n    return Promise.resolve();\n  }''',
    '''  getInverterProfiles(): readonly InverterProfile[] {\n    return FRONIUS_INVERTER_PROFILES;\n  }\n\n  async detectInverterProfile(): Promise<InverterDetection> {\n    const host = await this.deps.getConfig("host");\n    if (!host) {\n      return {\n        status: "unavailable",\n        profile: null,\n        device: null,\n        message: "Fronius local host is not configured.",\n      };\n    }\n    const adapter = await this.createAdapter();\n    const solarApiDevice = await adapter.getDeviceInfo();\n    const sunSpec = await probeFroniusSunSpec(host).catch(() => null);\n    if (!sunSpec) return detectFroniusInverterProfile(solarApiDevice);\n    const device = {\n      ...solarApiDevice,\n      manufacturer: sunSpec.manufacturer || solarApiDevice.manufacturer,\n      model: sunSpec.model || solarApiDevice.model,\n    };\n    return detectFroniusInverterProfile(device, sunSpec.nominalAcPowerW);\n  }\n\n  shutdown(): Promise<void> {\n    return Promise.resolve();\n  }''',
)

# Live PV correction stays on the same physical domain: observed PV vs modeled DC.
replace_once(
    "packages/server/src/services/SolarForecastService.test.ts",
    '''  panelAgeFactor,\n  toOpenMeteoAzimuth,''',
    '''  computeLivePvCorrection,\n  panelAgeFactor,\n  toOpenMeteoAzimuth,''',
)
replace_once(
    "packages/server/src/services/SolarForecastService.test.ts",
    '''Deno.test("SolarForecastService applies 0.5 percent annual degradation", () => {''',
    '''Deno.test("SolarForecastService live PV correction compares observed PV with modeled DC", () => {\n  assertAlmostEquals(computeLivePvCorrection(4000, 4000), 1, 0.0001);\n  assertAlmostEquals(computeLivePvCorrection(2000, 4000), 0.825, 0.0001);\n  assertAlmostEquals(computeLivePvCorrection(8000, 4000), 1.2, 0.0001);\n  assertAlmostEquals(computeLivePvCorrection(100, 300), 1, 0.0001);\n});\n\nDeno.test("SolarForecastService applies 0.5 percent annual degradation", () => {''',
)

# Solar Forecast UI: automatic detection or manual profile selection, no duplicate host/IP config.
replace_once(
    "packages/client/src/components/pages/Settings/SolarForecastSettings.tsx",
    '''import { Plus, SunMedium, Trash2 } from "lucide-react";\nimport { Button, Switch, Text, TextField } from "@radix-ui/themes";''',
    '''import { Plus, RefreshCw, SunMedium, Trash2 } from "lucide-react";\nimport { Button, Select, Switch, Text, TextField } from "@radix-ui/themes";''',
)
replace_once(
    "packages/client/src/components/pages/Settings/SolarForecastSettings.tsx",
    '''import type { SolarArrayConfig } from "@chargeha/shared/forecast";\n''',
    '''import type { SolarArrayConfig } from "@chargeha/shared/forecast";\nimport type {\n  InverterDetection,\n  InverterProfile,\n} from "@chargeha/shared/inverter";\n''',
)
replace_once(
    "packages/client/src/components/pages/Settings/SolarForecastSettings.tsx",
    '''export function SolarForecastSettings() {''',
    '''type InverterMode = "automatic" | "manual";\n\nfunction exactDetectedProfile(\n  detection: InverterDetection | undefined,\n): InverterProfile | null {\n  if (detection?.status !== "exact") return null;\n  return detection.profile;\n}\n\nfunction selectedProfile(\n  profiles: readonly InverterProfile[],\n  profileId: string,\n): InverterProfile | null {\n  return profiles.find((profile) => profile.id === profileId) ?? null;\n}\n\nfunction effectiveProfile(\n  mode: InverterMode,\n  profiles: readonly InverterProfile[],\n  profileId: string,\n  detection: InverterDetection | undefined,\n): InverterProfile | null {\n  if (mode === "manual") return selectedProfile(profiles, profileId);\n  return exactDetectedProfile(detection);\n}\n\nfunction exceedsPvGeneratorLimit(\n  profile: InverterProfile | null,\n  totalKwp: number,\n): boolean {\n  if (profile?.maxPvGeneratorW === undefined) return false;\n  return totalKwp * 1000 > profile.maxPvGeneratorW;\n}\n\nfunction DetectedInverterRow({\n  detection,\n  pending,\n  onRedetect,\n}: {\n  detection: InverterDetection | undefined;\n  pending: boolean;\n  onRedetect: () => void;\n}) {\n  const profile = exactDetectedProfile(detection);\n  const message = detection?.message ?? "Detection has not completed yet.";\n  return (\n    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>\n      <div style={{ flex: 1 }}>\n        <Text size="2" weight="medium">Detected inverter</Text>\n        {profile && (\n          <Text size="1" color="gray" style={{ display: "block" }}>\n            {profile.manufacturer} {profile.model}\n            {` — ${(profile.nominalAcPowerW / 1000).toFixed(2)} kW AC`}\n          </Text>\n        )}\n        {!profile && (\n          <Text size="1" color="gray" style={{ display: "block" }}>\n            {message}\n          </Text>\n        )}\n      </div>\n      <Button size="1" variant="soft" disabled={pending} onClick={onRedetect}>\n        <RefreshCw size={13} />\n        Re-detect\n      </Button>\n    </div>\n  );\n}\n\nfunction ManualInverterRow({\n  profiles,\n  profileId,\n  onChange,\n}: {\n  profiles: readonly InverterProfile[];\n  profileId: string;\n  onChange: (profileId: string) => void;\n}) {\n  return (\n    <SettingsRow label="Inverter profile">\n      <Select.Root\n        value={profileId || "_none"}\n        onValueChange={(value) => onChange(value === "_none" ? "" : value)}\n      >\n        <Select.Trigger placeholder="Select inverter..." style={{ minWidth: 250 }} />\n        <Select.Content>\n          <Select.Item value="_none">Select inverter...</Select.Item>\n          {profiles.map((profile) => (\n            <Select.Item key={profile.id} value={profile.id}>\n              {profile.manufacturer} {profile.model} —\n              {` ${(profile.nominalAcPowerW / 1000).toFixed(2)} kW AC`}\n            </Select.Item>\n          ))}\n        </Select.Content>\n      </Select.Root>\n    </SettingsRow>\n  );\n}\n\nfunction InverterForecastControls({\n  mode,\n  profiles,\n  detection,\n  profileId,\n  totalKwp,\n  redetecting,\n  onModeChange,\n  onProfileChange,\n  onRedetect,\n}: {\n  mode: InverterMode;\n  profiles: readonly InverterProfile[];\n  detection: InverterDetection | undefined;\n  profileId: string;\n  totalKwp: number;\n  redetecting: boolean;\n  onModeChange: (mode: InverterMode) => void;\n  onProfileChange: (profileId: string) => void;\n  onRedetect: () => void;\n}) {\n  const profile = effectiveProfile(mode, profiles, profileId, detection);\n  const exceedsLimit = exceedsPvGeneratorLimit(profile, totalKwp);\n  return (\n    <>\n      <SettingsRow\n        label="Inverter mode"\n        help="Automatic reuses the currently configured energy source. Manual selection is the safe fallback when exact detection is unavailable."\n      >\n        <Select.Root\n          value={mode}\n          onValueChange={(value) =>\n            onModeChange(value === "manual" ? "manual" : "automatic")}\n        >\n          <Select.Trigger style={{ minWidth: 190 }} />\n          <Select.Content>\n            <Select.Item value="automatic">Automatic detection</Select.Item>\n            <Select.Item value="manual">Manual selection</Select.Item>\n          </Select.Content>\n        </Select.Root>\n      </SettingsRow>\n      {mode === "automatic" && (\n        <DetectedInverterRow\n          detection={detection}\n          pending={redetecting}\n          onRedetect={onRedetect}\n        />\n      )}\n      {mode === "manual" && (\n        <ManualInverterRow\n          profiles={profiles}\n          profileId={profileId}\n          onChange={onProfileChange}\n        />\n      )}\n      {exceedsLimit && (\n        <Text size="1" color="orange">\n          Configured PV capacity exceeds this inverter profile's documented\n          maximum PV generator size. Check the selected profile and array data.\n        </Text>\n      )}\n    </>\n  );\n}\n\nexport function SolarForecastSettings() {''',
)
replace_once(
    "packages/client/src/components/pages/Settings/SolarForecastSettings.tsx",
    '''  const ac = useAddressAutocomplete();\n  const utils = trpc.useUtils();\n''',
    '''  const ac = useAddressAutocomplete();\n  const utils = trpc.useUtils();\n  const { data: inverterProfilesData } = trpc.energy.inverterProfiles.useQuery();\n  const {\n    data: inverterDetection,\n    refetch: refetchInverterDetection,\n  } = trpc.energy.inverterDetection.useQuery();\n  const redetectInverter = trpc.energy.redetectInverter.useMutation({\n    onSuccess: () => {\n      void refetchInverterDetection();\n      void utils.forecast.today.invalidate();\n    },\n  });\n  const inverterProfiles = inverterProfilesData?.profiles ?? [];\n  const inverterMode = fields?.solarForecastInverterMode ?? "automatic";\n''',
)
replace_once(
    "packages/client/src/components/pages/Settings/SolarForecastSettings.tsx",
    '''      <SettingsRow\n        label="Installation date"''',
    '''      <InverterForecastControls\n        mode={inverterMode}\n        profiles={inverterProfiles}\n        detection={inverterDetection}\n        profileId={fields?.solarForecastInverterProfileId ?? ""}\n        totalKwp={totalKwp}\n        redetecting={redetectInverter.isPending}\n        onModeChange={(mode) => setField("solarForecastInverterMode", mode)}\n        onProfileChange={(profileId) =>\n          setField("solarForecastInverterProfileId", profileId)}\n        onRedetect={() => redetectInverter.mutate()}\n      />\n\n      <SettingsRow\n        label="Installation date"''',
)
