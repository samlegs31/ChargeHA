import { Text } from "@radix-ui/themes";
import { Car, Monitor } from "lucide-react";
import { useWizardState } from "../../../hooks/useWizardState.ts";
import { vehiclePluginOptions } from "@chargeha/plugins/componentRegistry";
import { trpc } from "../../../trpc.ts";
import type { StepDef, WizardNext } from "../flow.ts";
import { OptionCard } from "./OptionCard.tsx";
import styles from "./steps.module.css";

const icons = {
  car: Car,
  monitor: Monitor,
} as const;

export const vehicleTypeStep: StepDef = {
  id: "vehicle-type",
  label: "Vehicle Type",
  useStep: ({ onAdvance }) => {
    const { state, isLoading } = useWizardState();

    const { data: vehiclesData } = trpc.vehicle.list.useQuery();
    const existingType = vehiclesData?.vehicles?.[0]?.adapterType ?? "";
    const selectedType = state.vehicleType || existingType;

    return {
      next: vehicleTypeNext(
        vehiclesData === undefined || isLoading,
        selectedType,
      ),
      view: (
        <VehicleTypeCards
          selectedType={selectedType}
          onSelect={(id) => onAdvance({ vehicleType: id })}
        />
      ),
    };
  },
};

function vehicleTypeNext(
  loading: boolean,
  selectedType: string,
): WizardNext {
  if (selectedType) {
    return {
      kind: "ready",
      hint: "Next continues with the selected vehicle type",
      // Return the chosen type so the shell saves it and picks the next step in one go.
      onNext: () => Promise.resolve({ vehicleType: selectedType }),
    };
  }
  if (loading) return { kind: "loading" };
  return { kind: "blocked", reason: "Select a vehicle type to continue" };
}

function VehicleTypeCards(
  { selectedType, onSelect }: {
    selectedType: string;
    onSelect: (id: string) => void;
  },
) {
  return (
    <div className={styles.stepContainer}>
      <Text as="p" size="3" color="gray">
        What type of vehicle would you like to connect?
      </Text>

      <div className={styles.optionCards}>
        {vehiclePluginOptions.map((option) => {
          const Icon = icons[option.iconKey];
          return (
            <OptionCard
              key={option.id}
              icon={<Icon size={18} />}
              title={option.label}
              description={option.description}
              selected={option.id === selectedType}
              onSelect={() => onSelect(option.id)}
            />
          );
        })}
      </div>
    </div>
  );
}
