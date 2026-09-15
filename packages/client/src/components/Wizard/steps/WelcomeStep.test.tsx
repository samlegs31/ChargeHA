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

  it("renders welcome content and Set up only", () => {
    renderWithProviders(
      <StepNextHarness def={welcomeStep} stepProps={makeStepProps()} />,
    );

    expect(screen.getByAltText("E.V. Solar")).toBeInTheDocument();
    expect(screen.getByText(/Charge your car with available solar/))
      .toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Set up/ }))
      .toBeInTheDocument();
  });

  it("clicking 'Set up' calls onAdvance callback", () => {
    const onAdvance = vi.fn();
    renderWithProviders(
      <StepNextHarness
        def={welcomeStep}
        stepProps={makeStepProps({ onAdvance })}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Set up/ }));

    expect(onAdvance).toHaveBeenCalledTimes(1);
  });
});
