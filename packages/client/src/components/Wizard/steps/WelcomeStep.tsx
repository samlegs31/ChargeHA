import { Button, Text } from "@radix-ui/themes";
import { Zap } from "lucide-react";
import { advanceOnly, type StepDef, type StepProps } from "../flow.ts";
import logoSrc from "../../../assets/chargeha_soft-plug_brand.svg";
import styles from "./steps.module.css";

export const welcomeStep: StepDef = {
  id: "welcome",
  label: "Welcome",
  // The step's own button drives it; Next is just "Set up" by another name.
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
        alt="E.V. Solar"
        style={{ width: 80, height: 80, borderRadius: 16, alignSelf: "center" }}
      />

      <Text as="p" size="3" color="gray">
        Charge your car with available solar and scheduled grid power. Connect
        your car and home energy system to get started.
      </Text>

      <div className={styles.welcomeButtons}>
        <Button size="3" onClick={() => onAdvance()}>
          <Zap size={18} />
          Set up
        </Button>
      </div>
    </div>
  );
}
