import { useMemo } from "react";
import { Server } from "lucide-react";
import { Select, Text } from "@radix-ui/themes";
import {
  useHomeConfig,
  useSystemConfig,
  useSystemConfigMutation,
} from "../../../hooks/useSectionConfig.ts";
import { useDraftConfig } from "../../../hooks/useDraftConfig.ts";
import {
  NumberInput,
  SettingsRow,
  SettingsSection,
} from "./SettingsLayout.tsx";
import { HomeLocationSection } from "./HomeLocationSection.tsx";
import { buildTimezoneOptions } from "../../../lib/timezones.ts";

type GeneralSettingsMode = "all" | "home" | "system";

export function GeneralSettings(
  { mode = "all" }: { mode?: GeneralSettingsMode } = {},
) {
  const { data: config } = useSystemConfig();
  const { data: homeConfig } = useHomeConfig();
  const mutation = useSystemConfigMutation();
  const { fields, setField, isDirty, save, saveStatus } = useDraftConfig(
    config,
    mutation,
  );

  const timezoneOptions = useMemo(buildTimezoneOptions, []);

  if (!fields) return null;

  const showSystem = mode === "all" || mode === "system";
  const showHome = mode === "all" || mode === "home";

  return (
    <>
      {showSystem && (
        <SettingsSection
          icon={<Server size={18} />}
          title="System"
          description="Technical timing, storage and timezone settings."
          saveStatus={saveStatus}
          isDirty={isDirty}
          onSave={save}
        >
          <SettingsRow
            label="Controller loop interval"
            help="How often the charge controller evaluates energy data and adjusts charging."
          >
            <NumberInput
              value={String(fields.controllerLoopSeconds)}
              onChange={(v) =>
                setField("controllerLoopSeconds", parseInt(v) || 10)}
              suffix="sec"
              step={5}
              min={5}
              max={120}
            />
          </SettingsRow>

          <SettingsRow
            label="Recording interval"
            help="Fixed at 60 seconds so energy and cost statistics remain accurate."
          >
            <Text size="2" color="gray">60 sec (fixed)</Text>
          </SettingsRow>

          <SettingsRow
            label="Data retention"
            help="How long energy and charge readings are kept before purging."
          >
            <NumberInput
              value={String(fields.dataRetentionDays)}
              onChange={(v) =>
                setField("dataRetentionDays", parseInt(v) || 730)}
              suffix="days"
              step={30}
              min={30}
              max={3650}
            />
          </SettingsRow>

          <SettingsRow
            label="Log retention"
            help="How long controller decision logs are kept."
          >
            <NumberInput
              value={String(fields.logRetentionDays)}
              onChange={(v) => setField("logRetentionDays", parseInt(v) || 7)}
              suffix="days"
              step={1}
              min={7}
              max={365}
            />
          </SettingsRow>

          <SettingsRow
            label="Timezone"
            help="Used for schedule evaluation and stats display."
          >
            <Select.Root
              value={fields.timezone ||
                Intl.DateTimeFormat().resolvedOptions().timeZone}
              onValueChange={(v) => setField("timezone", v)}
            >
              <Select.Trigger style={{ minWidth: 240 }} />
              <Select.Content>
                {timezoneOptions.map((opt) => (
                  <Select.Item key={opt.value} value={opt.value}>
                    {opt.label}
                  </Select.Item>
                ))}
              </Select.Content>
            </Select.Root>
          </SettingsRow>
        </SettingsSection>
      )}

      {showHome && (
        <HomeLocationSection
          homeConfig={homeConfig ?? null}
        />
      )}
    </>
  );
}
