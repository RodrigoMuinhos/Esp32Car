import type { SVGProps } from "react";

/** Steering wheel in the Lucide style (Lucide has none): rim, hub and three spokes. */
export function SteeringWheelIcon({ size = 24, ...props }: SVGProps<SVGSVGElement> & { size?: number | string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      <circle cx="12" cy="12" r="10" />
      <circle cx="12" cy="12" r="2.5" />
      <path d="M9.6 11.3 2.3 9.6M14.4 11.3l7.3-1.7M12 14.5V22" />
    </svg>
  );
}
