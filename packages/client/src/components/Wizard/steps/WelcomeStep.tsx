import { Button, Text } from "@radix-ui/themes";
import { Zap } from "lucide-react";
import { advanceOnly, type StepDef, type StepProps } from "../flow.ts";
import logoSrc from "../../../assets/chargeha_soft-plug_brand.svg";
import styles from "./steps.module.css";

export const welcomeStep: StepDef = {
  id: "welcome",
  label: "Welcome",
  // The step's own button drives it; Next is just "Full Setup" by another name.
  useStep: (props) => ({
    next: { kind: "ready", hint: null, onNext: advanceOnly },
    view: <WelcomeContent {...props} />,
  }),
};

function WelcomeContent({ onAdvance }: StepProps) {
  return (
    <div className={styles.stepContainer}>
      <img
        src={logoSrc}
        alt="ChargeHA"
        style={{ width: 80, height: 80, borderRadius: 16, alignSelf: "center" }}
      />

      <Text as="p" size="3" color="gray">
        ChargeHA is a smart home charging controller that optimises your
        electric vehicle charging using solar production data from your
        inverter. It automatically adjusts charge rates to maximise
        self-consumption and minimise grid usage.
      </Text>

      <div className={styles.welcomeButtons}>
        <Button size="3" onClick={() => onAdvance()}>
          <Zap size={18} />
          Full Setup
        </Button>
      </div>

      <Text as="p" size="2" color="gray">
        <strong>Full Setup</strong>{" "}
        walks you through authentication, timezone, your vehicle, energy source,
        and home location — step by step.
      </Text>
    </div>
  );
}
