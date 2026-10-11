import { useEffect, useRef, useState } from "react";
import type { RaceState } from "../types/telemetry";

type Flash = { kind: "go" | "finish" | "trial" | "panic"; key: number } | null;
const FLASH_MS = { go: 900, finish: 1700, trial: 1900, panic: 1500 };

/**
 * Full-screen race moments over the panel (never blocks clicks): giant 3-2-1,
 * GO with a flash, checkered flag at the finish and a red band on emergency stop.
 */
export function RaceOverlay({
  state,
  countdown,
  status,
}: {
  state: RaceState;
  countdown: number | null;
  status: string;
}) {
  const [flash, setFlash] = useState<Flash>(null);
  const previous = useRef(state);
  const timer = useRef(0);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  useEffect(() => {
    const was = previous.current;
    previous.current = state;
    let kind: NonNullable<Flash>["kind"] | null = null;
    if (/emergência/i.test(status) && state !== was && (state === "idle" || state === "finished"))
      kind = "panic";
    else if (state === "running" && was !== "running") kind = "go";
    else if (state === "finished" && was === "running")
      kind = /concluída/i.test(status) ? "trial" : "finish";
    if (!kind) return;
    const next = { kind, key: Date.now() };
    setFlash(next);
    // Not tied to this effect's cleanup: a status change must not freeze the flash on screen.
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setFlash(null), FLASH_MS[kind]);
  }, [state, status]);

  const second = countdown === null ? 0 : Math.max(1, Math.ceil(countdown));
  if (state === "countdown" && second)
    return (
      <div className={`race-overlay countdown n${second}`} aria-hidden="true">
        {second === 3 && <span className="overlay-caption">IGNIÇÃO</span>}
        <strong key={second} className="overlay-number">
          {second}
        </strong>
      </div>
    );
  if (!flash) return null;
  return (
    <div key={flash.key} className={`race-overlay ${flash.kind}`} aria-hidden="true">
      {flash.kind === "go" && <strong className="overlay-number">GO!</strong>}
      {(flash.kind === "finish" || flash.kind === "trial") && (
        <div className="checkered-band">
          <strong>{flash.kind === "trial" ? "COMPLETOU!" : "BANDEIRADA"}</strong>
        </div>
      )}
      {flash.kind === "panic" && (
        <div className="panic-band">
          <strong>PARADA DE EMERGÊNCIA</strong>
        </div>
      )}
    </div>
  );
}
