import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithProviders } from "../../test-utils.tsx";
import { VehicleBatterySection } from "./VehicleBatterySection.tsx";

describe("VehicleBatterySection", () => {
  afterEach(cleanup);

  const renderBattery = (
    overrides: Partial<Parameters<typeof VehicleBatterySection>[0]> = {},
  ) => {
    const props: Parameters<typeof VehicleBatterySection>[0] = {
      batteryPercent: 57,
      chargeLimitPercent: 80,
      isCharging: false,
      isPluggedIn: true,
      disabled: false,
      onSetChargeLimit: vi.fn().mockResolvedValue(undefined),
      ...overrides,
    };
    return {
      props,
      ...renderWithProviders(<VehicleBatterySection {...props} />),
    };
  };

  it("keeps the existing battery bar read-only when unplugged", () => {
    renderBattery({ isPluggedIn: false });

    expect(screen.getByText("57%")).toBeInTheDocument();
    expect(screen.getByText("Limit 80%")).toBeInTheDocument();
    expect(screen.queryByRole("slider", { name: "Charge limit" }))
      .not.toBeInTheDocument();
  });

  it("turns the existing bar into a 50-100% control when plugged in", () => {
    renderBattery();

    const slider = screen.getByRole("slider", { name: "Charge limit" });
    expect(slider).toHaveAttribute("min", "50");
    expect(slider).toHaveAttribute("max", "100");
    expect(slider).toHaveAttribute("step", "1");
    expect(slider).toHaveValue("80");
  });

  it("does not send Tesla commands while the thumb is moving", async () => {
    const onSetChargeLimit = vi.fn().mockResolvedValue(undefined);
    renderBattery({ onSetChargeLimit });

    const slider = screen.getByRole("slider", { name: "Charge limit" });
    fireEvent.change(slider, { target: { value: "85" } });
    fireEvent.change(slider, { target: { value: "90" } });

    expect(onSetChargeLimit).not.toHaveBeenCalled();
    expect(screen.getByText("Limit 90%")).toBeInTheDocument();

    fireEvent.pointerUp(slider);
    await waitFor(() => {
      expect(onSetChargeLimit).toHaveBeenCalledTimes(1);
      expect(onSetChargeLimit).toHaveBeenCalledWith(90);
    });
  });

  it("restores the previous limit when the command fails", async () => {
    const onSetChargeLimit = vi.fn().mockRejectedValue(new Error("offline"));
    renderBattery({ onSetChargeLimit });

    const slider = screen.getByRole("slider", { name: "Charge limit" });
    fireEvent.change(slider, { target: { value: "95" } });
    fireEvent.pointerUp(slider);

    await waitFor(() => {
      expect(screen.getByText("Limit 80%")).toBeInTheDocument();
      expect(screen.getByText("Charge limit not changed")).toBeInTheDocument();
    });
  });
});
