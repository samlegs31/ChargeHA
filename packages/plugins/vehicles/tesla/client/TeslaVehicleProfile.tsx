interface TeslaVehicleProfileProps {
  vehicleId: string;
}

const TESLA_WMIS = ["5YJ", "7SA", "LRW", "XP7"] as const;

export function isTeslaVehicleId(vehicleId: string): boolean {
  const upper = vehicleId.toUpperCase();
  return TESLA_WMIS.some((wmi) => upper.startsWith(wmi));
}

function AlloyWheel({ cx }: { cx: number }) {
  const spokes = Array.from({ length: 10 }, (_, index) => {
    const angle = index * 36 * Math.PI / 180;
    const x2 = cx + Math.cos(angle) * 29;
    const y2 = 183 + Math.sin(angle) * 29;
    return (
      <line
        key={index}
        x1={cx}
        y1="183"
        x2={x2}
        y2={y2}
        stroke="url(#wheelMetal)"
        strokeWidth="8"
        strokeLinecap="round"
      />
    );
  });

  return (
    <g>
      <circle cx={cx} cy="183" r="43" fill="#080b10" />
      <circle cx={cx} cy="183" r="33" fill="#343a42" />
      {spokes}
      <circle
        cx={cx}
        cy="183"
        r="8"
        fill="#171b21"
        stroke="#d8dde4"
        strokeWidth="2"
      />
    </g>
  );
}

function VehicleProfileDefs() {
  return (
    <defs>
      <linearGradient id="bodyBlue" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#2d6cff" />
        <stop offset="0.38" stopColor="#124dc8" />
        <stop offset="1" stopColor="#082c82" />
      </linearGradient>
      <linearGradient id="windowGlass" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#657585" />
        <stop offset="1" stopColor="#17212b" />
      </linearGradient>
      <linearGradient id="wheelMetal" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stopColor="#f2f4f7" />
        <stop offset="0.5" stopColor="#9ea7b1" />
        <stop offset="1" stopColor="#e2e6eb" />
      </linearGradient>
      <filter id="carShadow" x="-10%" y="-30%" width="120%" height="170%">
        <feGaussianBlur stdDeviation="7" />
      </filter>
    </defs>
  );
}

function VehicleBody() {
  return (
    <>
      <ellipse
        cx="380"
        cy="218"
        rx="310"
        ry="12"
        fill="#000"
        opacity="0.28"
        filter="url(#carShadow)"
      />
      <path
        d="M62 158 C78 142 110 132 158 127 L236 115 C274 70 328 48 404 46
           C485 45 550 70 611 112 L680 128 C709 134 724 145 732 161
           L725 186 C704 194 679 197 652 198 L108 198 C83 196 65 190 53 179 Z"
        fill="url(#bodyBlue)"
        stroke="#061b4d"
        strokeWidth="3"
      />
      <path
        d="M246 113 C282 72 330 57 398 56 C467 56 523 75 581 111
           L485 111 L454 64 L350 64 L307 111 Z"
        fill="url(#windowGlass)"
        stroke="#0b1017"
        strokeWidth="4"
      />
      <path d="M350 64 L337 111" stroke="#0a0e14" strokeWidth="7" />
      <path d="M454 64 L467 111" stroke="#0a0e14" strokeWidth="7" />
      <path
        d="M307 111 L485 111"
        stroke="#b8c1ca"
        strokeWidth="2"
        opacity="0.65"
      />
    </>
  );
}

function VehicleDetails() {
  return (
    <>
      <path
        d="M67 159 C100 151 133 147 170 145"
        fill="none"
        stroke="#8eb6ff"
        strokeWidth="4"
        strokeLinecap="round"
      />
      <path
        d="M582 116 C625 124 665 130 698 141"
        fill="none"
        stroke="#2459bf"
        strokeWidth="4"
        strokeLinecap="round"
      />
      <path
        d="M191 127 C290 123 470 122 589 126"
        fill="none"
        stroke="#4f82ef"
        strokeWidth="2"
        opacity="0.7"
      />
      <path
        d="M242 156 C353 166 479 165 575 151"
        fill="none"
        stroke="#5d8ff5"
        strokeWidth="3"
        opacity="0.55"
      />
      <path
        d="M92 151 L139 140 L170 145 L137 158 Z"
        fill="#dfeaff"
        opacity="0.9"
      />
      <path d="M683 139 L714 149 L717 158 L688 154 Z" fill="#e34e62" />
      <rect x="337" y="126" width="35" height="5" rx="2.5" fill="#121a26" />
      <rect x="493" y="126" width="35" height="5" rx="2.5" fill="#121a26" />
      <path
        d="M286 111 L267 103 L250 110 L263 116 Z"
        fill="#174ebc"
        stroke="#071a45"
        strokeWidth="2"
      />
    </>
  );
}

/**
 * Lightweight side-profile vehicle visual for the home card.
 * The current profile matches the validated pre-Highland Model 3, Deep Blue
 * Metallic and silver 19-inch wheel configuration.
 */
export function TeslaVehicleProfile({ vehicleId }: TeslaVehicleProfileProps) {
  return (
    <svg
      viewBox="0 0 760 240"
      role="img"
      aria-label="Vehicle side profile"
      preserveAspectRatio="xMidYMid meet"
      data-vin-year-code={vehicleId.at(9) ?? ""}
    >
      <VehicleProfileDefs />
      <VehicleBody />
      <VehicleDetails />
      <AlloyWheel cx={188} />
      <AlloyWheel cx={612} />
    </svg>
  );
}
