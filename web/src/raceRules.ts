// Same rules as backend/control.py, used by the simulation mode:
// button A starts the race, button B finishes it. Nothing is automatic.
import type { Buttons, Input, RaceState } from "./types/telemetry";
export type Race = {
  phase: RaceState;
  down: Buttons;
  raceId: number;
  status: string;
};
export const READY_STATUS = "Aperte A para largar.";
export const newRace = (): Race => ({
  phase: "idle",
  down: { start: false, finish: false },
  raceId: 0,
  status: READY_STATUS,
});
export function stopRace(race: Race, status: string) {
  race.phase = race.phase === "running" || race.phase === "finished" ? "finished" : "idle";
  race.status = status;
}
/** Buttons react to the press itself; holding one never repeats it. */
export function stepRace(race: Race, buttons: Buttons) {
  const start = buttons.start && !race.down.start;
  const finish = buttons.finish && !race.down.finish;
  race.down = { ...buttons };
  if (race.phase !== "running" && start) {
    race.phase = "running";
    race.raceId += 1;
    race.status = "Corrida ativa. Aperte B para finalizar.";
  } else if (race.phase === "running" && finish)
    stopRace(race, "Corrida finalizada pelo botão B.");
}

export const MAX_SPEED = 40;
/** Imaginary speed (km/h) proportional to the throttle, with smooth acceleration. */
export function speedStep(speed: number, input: Input, active: boolean, dt: number) {
  if (!active) return 0;
  const target =
    MAX_SPEED * Math.pow(input.throttle / 100, 1.4) * (1 - input.brake / 100);
  return speed + (target - speed) * Math.min(1, dt * (input.brake ? 6 : 2));
}
