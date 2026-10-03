import { useEffect, useState } from "react";
import { ZERO_INPUT, clamp, type Input } from "../types/telemetry";
export function readGamepad(pad: Pick<Gamepad, "axes" | "buttons">): Input {
  const button = (i: number) => pad.buttons[i]?.value ?? 0;
  return {
    steering: clamp((pad.axes[0] ?? 0) * 100, -100, 100),
    throttle: Math.max(button(7), button(5)) * 100,
    brake: Math.max(button(6), button(4)) * 100,
  };
}
export function useControls() {
  const [gamepad, setGamepad] = useState<{
    name: string;
    input: Input;
    supported: boolean;
  } | null>(null);
  useEffect(() => {
    let frame = 0,
      last = 0;
    const poll = (now: number) => {
      if (now - last >= 32) {
        last = now;
        const pad = Array.from(navigator.getGamepads?.() ?? []).find(
          (p) => p?.connected,
        );
        setGamepad(
          pad && !document.hidden
            ? {
                name: pad.id,
                supported: pad.mapping === "standard",
                input:
                  pad.mapping === "standard" ? readGamepad(pad) : ZERO_INPUT,
              }
            : null,
        );
      }
      frame = requestAnimationFrame(poll);
    };
    frame = requestAnimationFrame(poll);
    return () => cancelAnimationFrame(frame);
  }, []);
  return gamepad;
}
