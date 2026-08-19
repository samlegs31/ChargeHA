import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen } from "@testing-library/react";
import { renderWithProviders } from "../../../test-utils.tsx";
import { welcomeStep } from "./WelcomeStep.tsx";
import type { StepProps } from "../flow.ts";
import { StepNextHarness } from "./test-helpers/StepNextHarness.tsx";

describe("WelcomeStep", () => {
  const makeStepProps = (overrides: Partial<StepProps> = {}): StepProps => ({
    onAdvance: vi.fn(),
    onBack: vi.fn(),
    onSkipTo: vi.fn(),
    onSkipToEnd: vi.fn(),
    ...overrides,
  });

  afterEach(() => {
    cleanup();
  });

  it("renders welcome content and Full Setup only", () => {
    renderWithProviders(
      <StepNextHarness def={welcomeStep} stepProps={makeStepProps()} />,
    );

    expect(screen.getByAltText("ChargeHA")).toBeInTheDocument();
    expect(screen.getByText(/ChargeHA is a smart home charging controller/))
      .toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Full Setup/ }))
      .toBeInTheDocument();
    expect(screen.getByText(/walks you through authentication/))
      .toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Demo Mode/ })).not
      .toBeInTheDocument();
  });

  it("clicking 'Full Setup' calls onAdvance callback", () => {
    const onAdvance = vi.fn();
    renderWithProviders(
      <StepNextHarness
        def={welcomeStep}
        stepProps={makeStepProps({ onAdvance })}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Full Setup/ }));

    expect(onAdvance).toHaveBeenCalledTimes(1);
  });
});
