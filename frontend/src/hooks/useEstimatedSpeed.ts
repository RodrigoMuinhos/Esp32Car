import { useEffect, useRef, useState } from "react";
import type { Input } from "../types/telemetry";

/** Top of the imaginary speed scale (km/h): the car has no speed sensor. */
export const MAX_SPEED = 40;
/** Imaginary speed (km/h) proportional to the throttle, with smooth acceleration. */
export function speedStep(speed: number, input: Input, active: boolean, dt: number) {
  if (!active) return 0;
  const target =
    MAX_SPEED * Math.pow(input.throttle / 100, 1.4) * (1 - input.brake / 100);
  return speed + (target - speed) * Math.min(1, dt * (input.brake ? 6 : 2));
}

/** No speed sensor on the car: estimate it from the throttle position. */
export function useEstimatedSpeed(input: Input, active: boolean) {
  const [speed, setSpeed] = useState(0);
  const latest = useRef({ input, active });
  latest.current = { input, active };
  useEffect(() => {
    let frame = 0,
      last = performance.now(),
      value = 0,
      shown = -1;
    const tick = (now: number) => {
      const dt = Math.min((now - last) / 1000, 0.1);
      last = now;
      value = speedStep(value, latest.current.input, latest.current.active, dt);
      const rounded = Math.round(value * 10) / 10;
      if (rounded !== shown) setSpeed((shown = rounded));
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, []);
  return speed;
}
