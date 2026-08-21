import type { CSSProperties, SVGProps } from "react";

interface VehicleSilhouetteIconProps
  extends Omit<SVGProps<SVGSVGElement>, "height" | "width"> {
  size?: number;
}

/** A low, aerodynamic EV profile inspired by modern electric saloons. */
export function VehicleSilhouetteIcon(
  { size = 32, style, ...props }: VehicleSilhouetteIconProps,
) {
  return (
    <svg
      viewBox="0 0 64 32"
      width={size}
      height={Math.round(size * 0.5)}
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ flexShrink: 0, ...style } as CSSProperties}
      data-testid="vehicle-silhouette-icon"
      {...props}
    >
      <path
        d="M4 22.5c.7-3.4 3.2-5.6 7.1-6.2l7.2-1.1 6.6-6.1C26.4 7.7 28.4 7 30.5 7h8.7c2.7 0 5.3.9 7.3 2.6l7.2 5.9 3.5.9c2.1.6 3.5 2.4 3.5 4.6v2.4h-4.4"
        fill="currentColor"
        fillOpacity="0.1"
      />
      <path d="M18.3 15.2h32.1" opacity="0.8" />
      <path
        d="m25 9.1-4.6 6.1M29.4 8.4l1.3 6.8M40.1 8.3l7.5 6.9"
        opacity="0.72"
      />
      <path d="M9.5 22.5H6.3M27.1 22.5h17.8" />
      <path d="M55.9 17.3h2.6" strokeWidth="2.8" />
      <circle
        cx="18.2"
        cy="22.7"
        r="5.1"
        fill="currentColor"
        fillOpacity="0.1"
      />
      <circle cx="18.2" cy="22.7" r="1.7" />
      <circle
        cx="50.5"
        cy="22.7"
        r="5.1"
        fill="currentColor"
        fillOpacity="0.1"
      />
      <circle cx="50.5" cy="22.7" r="1.7" />
    </svg>
  );
}
