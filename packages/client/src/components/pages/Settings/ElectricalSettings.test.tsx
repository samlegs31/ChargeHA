import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen } from "@testing-library/react";
import { renderWithProviders } from "../../../test-utils.tsx";
import { ElectricalSettings } from "./ElectricalSettings.tsx";

const mocks = vi.hoisted(() => ({
  mutate: vi.fn(),
  data: {
    chargingEnabled: true,
    priorityChargingEnabled: false,
    vehicleCurrentLimits: {} as Record<string, number>,
    maxGridImportKw: null as number | null,
  },
}));
vi.mock("../../../hooks/useSectionConfig.ts", () => ({
  useChargingConfig: () => ({ data: mocks.data }),
  useChargingConfigMutation: () => ({
    mutate: mocks.mutate,
    saveStatus: { state: "idle", tick: 0 },
  }),
}));

describe("Electrical settings", () => {
  beforeEach(() => {
    mocks.mutate.mockClear();
    mocks.data.vehicleCurrentLimits = {};
    mocks.data.maxGridImportKw = null;
  });
  afterEach(cleanup);
  it("saves explicit circuit and grid limits without changing other charging settings", () => {
    renderWithProviders(
      <ElectricalSettings vehicles={[{ id: "V1", name: "Model 3" }]} />,
    );
    fireEvent.change(screen.getByLabelText("Model 3 maximum current"), {
      target: { value: "16" },
    });
    fireEvent.change(screen.getByLabelText("Maximum grid import"), {
      target: { value: "6" },
    });
    fireEvent.click(screen.getByRole("button", { name: /save/i }));
    expect(mocks.mutate).toHaveBeenCalledWith({
      vehicleCurrentLimits: { V1: 16 },
      maxGridImportKw: 6,
    });
  });
  it("can remove limits and keeps zero grid import distinct from disabled", () => {
    mocks.data.vehicleCurrentLimits = { V1: 16, V2: 10 };
    renderWithProviders(
      <ElectricalSettings vehicles={[{ id: "V1", name: "Model 3" }]} />,
    );
    fireEvent.change(screen.getByLabelText("Model 3 maximum current"), {
      target: { value: "" },
    });
    fireEvent.change(screen.getByLabelText("Maximum grid import"), {
      target: { value: "0" },
    });
    fireEvent.click(screen.getByRole("button", { name: /save/i }));
    expect(mocks.mutate).toHaveBeenCalledWith({
      vehicleCurrentLimits: { V2: 10 },
      maxGridImportKw: 0,
    });
  });
});
