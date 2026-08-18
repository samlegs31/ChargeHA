import type { TeslaVisualGeneration, TeslaVisualSpec } from "./TeslaVehicleVisualCatalog.ts";

type ShapeDef = {
  body: string;
  glass: string;
  frontWheelX: number;
  rearWheelX: number;
  wheelY: number;
  wheelRadius: number;
};

const SHAPES: Record<TeslaVisualGeneration, ShapeDef> = {
  "model3-classic": {
    body: "M62 158 C78 142 110 132 158 127 L236 115 C274 70 328 48 404 46 C485 45 550 70 611 112 L680 128 C709 134 724 145 732 161 L725 186 C704 194 679 197 652 198 L108 198 C83 196 65 190 53 179 Z",
    glass: "M246 113 C282 72 330 57 398 56 C467 56 523 75 581 111 L485 111 L454 64 L350 64 L307 111 Z",
    frontWheelX: 188,
    rearWheelX: 612,
    wheelY: 183,
    wheelRadius: 43,
  },
  "model3-highland": {
    body: "M57 161 C84 140 120 132 167 126 L244 114 C285 72 335 49 405 47 C485 46 548 70 608 111 L683 128 C715 135 731 147 738 163 L728 187 C702 195 674 198 647 199 L108 199 C80 197 62 189 50 178 Z",
    glass: "M254 112 C289 76 334 58 400 57 C468 56 519 74 576 110 L485 110 L457 65 L354 65 L314 110 Z",
    frontWheelX: 190,
    rearWheelX: 610,
    wheelY: 184,
    wheelRadius: 43,
  },
  "modely-classic": {
    body: "M52 162 C72 143 107 132 158 128 L226 116 C264 64 324 39 407 40 C493 41 560 69 622 114 L685 130 C713 137 729 149 736 165 L727 190 C704 197 678 200 648 201 L105 201 C78 198 59 190 48 179 Z",
    glass: "M238 114 C278 68 330 50 404 50 C480 51 537 75 592 113 L493 113 L456 57 L348 57 L300 113 Z",
    frontWheelX: 187,
    rearWheelX: 610,
    wheelY: 185,
    wheelRadius: 44,
  },
  "modely-2025": {
    body: "M50 164 C75 143 111 133 161 128 L230 115 C270 65 328 40 408 41 C494 42 557 68 619 111 L690 129 C719 136 735 150 741 165 L731 190 C707 198 679 201 648 201 L104 201 C75 199 56 190 46 179 Z",
    glass: "M241 113 C281 70 331 51 406 51 C481 52 536 74 590 111 L491 111 L457 58 L350 58 L302 111 Z",
    frontWheelX: 188,
    rearWheelX: 610,
    wheelY: 185,
    wheelRadius: 44,
  },
  "models-legacy": {
    body: "M47 164 C72 145 111 134 168 130 L247 118 C286 79 343 57 421 56 C506 55 568 78 625 116 L691 132 C718 138 734 150 740 165 L731 188 C704 196 674 198 644 198 L105 198 C77 196 58 188 46 177 Z",
    glass: "M258 116 C294 82 343 65 415 64 C483 64 536 81 590 114 L491 114 L461 70 L360 70 L316 114 Z",
    frontWheelX: 190,
    rearWheelX: 615,
    wheelY: 183,
    wheelRadius: 43,
  },
  "models-refresh": {
    body: "M44 163 C73 143 116 134 170 130 L248 117 C288 76 344 54 422 53 C510 52 570 76 628 114 L696 131 C724 137 740 150 745 165 L735 188 C707 196 676 199 645 199 L103 199 C74 196 55 188 43 177 Z",
    glass: "M260 115 C296 79 346 62 417 61 C486 61 538 79 594 113 L492 113 L462 67 L361 67 L316 113 Z",
    frontWheelX: 190,
    rearWheelX: 616,
    wheelY: 184,
    wheelRadius: 43,
  },
  "modelx-legacy": {
    body: "M47 166 C68 145 105 135 158 130 L224 117 C261 66 321 42 409 43 C503 45 571 76 633 119 L693 133 C719 139 735 151 741 167 L731 192 C706 199 678 202 646 202 L102 202 C74 199 55 191 44 180 Z",
    glass: "M236 116 C275 70 331 52 405 53 C489 55 548 81 605 117 L499 117 L460 61 L349 61 L296 116 Z",
    frontWheelX: 186,
    rearWheelX: 612,
    wheelY: 187,
    wheelRadius: 45,
  },
  "modelx-refresh": {
    body: "M44 167 C70 145 108 135 160 130 L226 116 C265 64 325 41 410 42 C504 44 570 73 634 117 L697 132 C724 139 740 152 746 168 L735 193 C709 200 679 203 647 203 L101 203 C72 200 53 191 42 180 Z",
    glass: "M238 115 C278 68 333 51 407 52 C489 54 546 78 606 115 L500 115 L460 60 L350 60 L298 115 Z",
    frontWheelX: 187,
    rearWheelX: 613,
    wheelY: 188,
    wheelRadius: 45,
  },
  cybertruck: {
    body: "M54 174 L84 144 L244 128 L351 57 L465 62 L618 128 L704 143 L738 168 L724 196 L650 201 L111 201 L62 190 Z",
    glass: "M264 126 L358 68 L457 72 L585 126 Z",
    frontWheelX: 196,
    rearWheelX: 616,
    wheelY: 187,
    wheelRadius: 47,
  },
  semi: {
    body: "M72 191 L91 105 C99 75 122 58 160 54 L280 54 L332 90 L363 154 L690 154 L728 174 L722 202 L86 202 Z",
    glass: "M112 104 C117 77 133 66 160 64 L256 64 L302 98 L315 118 L111 118 Z",
    frontWheelX: 215,
    rearWheelX: 620,
    wheelY: 190,
    wheelRadius: 45,
  },
  unknown: {
    body: "M62 163 C84 145 119 134 166 130 L242 117 C282 78 336 57 408 56 C489 56 551 78 612 116 L683 131 C713 138 728 150 735 165 L726 190 C701 197 673 200 645 200 L108 200 C81 197 62 190 51 179 Z",
    glass: "M252 115 C288 80 338 64 404 64 C473 64 525 81 580 114 L487 114 L457 70 L354 70 L313 114 Z",
    frontWheelX: 190,
    rearWheelX: 610,
    wheelY: 185,
    wheelRadius: 43,
  },
};

function WheelSpokes(
  { cx, cy, radius, spokes, turbine, stroke }: {
    cx: number;
    cy: number;
    radius: number;
    spokes: number;
    turbine: boolean;
    stroke: string;
  },
) {
  return (
    <>
      {Array.from({ length: spokes }, (_, index) => {
        const angle = index * (360 / spokes) * Math.PI / 180;
        const offset = turbine ? 0.34 : 0;
        const x2 = cx + Math.cos(angle + offset) * radius;
        const y2 = cy + Math.sin(angle + offset) * radius;
        return (
          <line
            key={index}
            x1={cx}
            y1={cy}
            x2={x2}
            y2={y2}
            stroke={stroke}
            strokeWidth={turbine ? 7 : 6}
            strokeLinecap="round"
          />
        );
      })}
    </>
  );
}

function Wheel(
  { cx, cy, radius, spec }: {
    cx: number;
    cy: number;
    radius: number;
    spec: TeslaVisualSpec;
  },
) {
  const rim = spec.wheel.dark ? "#30343a" : "#aeb6bf";
  const spokes = spec.wheel.dark ? "#515861" : "#d7dce2";
  return (
    <g data-wheel-family={spec.wheel.family}>
      <circle cx={cx} cy={cy} r={radius} fill="#080a0d" />
      <circle cx={cx} cy={cy} r={radius - 9} fill={rim} />
      {spec.wheel.cover && (
        <circle cx={cx} cy={cy} r={radius - 13} fill={spec.wheel.dark ? "#24282d" : "#9099a3"} />
      )}
      <WheelSpokes
        cx={cx}
        cy={cy}
        radius={radius - 16}
        spokes={spec.wheel.spokes}
        turbine={spec.wheel.turbine}
        stroke={spokes}
      />
      <circle cx={cx} cy={cy} r="7" fill="#171a1f" stroke="#d9dde2" strokeWidth="2" />
    </g>
  );
}

function VehicleDefs({ idPrefix, spec }: { idPrefix: string; spec: TeslaVisualSpec }) {
  const bodyId = `${idPrefix}-body`;
  const glassId = `${idPrefix}-glass`;
  const shadowId = `${idPrefix}-shadow`;
  return (
    <defs>
      <linearGradient id={bodyId} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor={spec.paint.highlight} />
        <stop offset="0.4" stopColor={spec.paint.base} />
        <stop offset="1" stopColor={spec.paint.shadow} />
      </linearGradient>
      <linearGradient id={glassId} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#738393" />
        <stop offset="1" stopColor="#17212b" />
      </linearGradient>
      <filter id={shadowId} x="-10%" y="-30%" width="120%" height="170%">
        <feGaussianBlur stdDeviation="7" />
      </filter>
    </defs>
  );
}

export function TeslaVehicleSilhouette(
  { spec, idPrefix }: { spec: TeslaVisualSpec; idPrefix: string },
) {
  const shape = SHAPES[spec.generation];
  const bodyId = `${idPrefix}-body`;
  const glassId = `${idPrefix}-glass`;
  const shadowId = `${idPrefix}-shadow`;
  return (
    <svg
      viewBox="0 0 760 240"
      role="img"
      aria-label="Tesla vehicle side profile"
      preserveAspectRatio="xMidYMid meet"
      data-model={spec.model}
      data-generation={spec.generation}
      data-paint={spec.paint.key}
      data-wheel={spec.wheel.family}
    >
      <VehicleDefs idPrefix={idPrefix} spec={spec} />
      <ellipse
        cx="380"
        cy="219"
        rx="310"
        ry="11"
        fill="#000"
        opacity="0.25"
        filter={`url(#${shadowId})`}
      />
      <path d={shape.body} fill={`url(#${bodyId})`} stroke={spec.paint.shadow} strokeWidth="3" />
      <path d={shape.glass} fill={`url(#${glassId})`} stroke="#0b1017" strokeWidth="4" />
      {spec.performance && (
        <path d="M620 129 L674 126 L692 132 L638 136 Z" fill="#11151a" opacity="0.9" />
      )}
      <path d="M86 154 L151 141 L177 146 L139 158 Z" fill="#dce8f7" opacity="0.9" />
      <path d="M679 140 L715 150 L718 159 L687 155 Z" fill="#e34e62" />
      <Wheel cx={shape.frontWheelX} cy={shape.wheelY} radius={shape.wheelRadius} spec={spec} />
      <Wheel cx={shape.rearWheelX} cy={shape.wheelY} radius={shape.wheelRadius} spec={spec} />
    </svg>
  );
}
