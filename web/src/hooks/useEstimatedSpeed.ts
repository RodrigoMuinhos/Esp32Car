import { useEffect, useRef, useState } from "react";
import type { Input } from "../types/telemetry";
import { speedStep } from "../raceRules";
/** Real mode has no speed sensor: estimate it from the throttle position. */
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
