// Same rules as backend/control.py, used by the simulation mode.
// Start: A runs a 3-2-1 countdown, or hold the throttle 0.5 s.
// Finish: B, or 15 s without throttle.
import type { Buttons, Input, RaceState } from "./types/telemetry";
export const THROTTLE_THRESHOLD = 5;
export const START_HOLD_TIME = 500;
export const COUNTDOWN_TIME = 3000;
export const INACTIVITY_TIME = 15_000;
const MOVING_THROTTLE = 3;
export type Race = {
  phase: RaceState;
  down: Buttons;
  armed: boolean;
  holdSince: number;
  goAt: number;
  lastMove: number;
  raceId: number;
  status: string;
};
export const READY_STATUS = "Aperte A (ou segure o acelerador 0,5 s) para largar.";
export const newRace = (): Race => ({
  phase: "idle",
  down: { start: false, finish: false },
  armed: false,
  holdSince: 0,
  goAt: 0,
  lastMove: 0,
  raceId: 0,
  status: READY_STATUS,
});
export function stopRace(race: Race, status: string) {
  race.phase = race.phase === "running" || race.phase === "finished" ? "finished" : "idle";
  race.armed = false; // release the throttle before a new start
  race.status = status;
}
function begin(race: Race, now: number) {
  race.phase = "running";
  race.raceId += 1;
  race.lastMove = now;
  race.status = "Corrida ativa. Aperte B para finalizar.";
}
/** Buttons react to the press itself; holding one never repeats it. */
export function stepRace(race: Race, input: Input, buttons: Buttons, now: number) {
  const start = buttons.start && !race.down.start;
  const finish = buttons.finish && !race.down.finish;
  race.down = { ...buttons };
  if (race.phase === "idle" || race.phase === "finished" || race.phase === "starting") {
    if (start) {
      race.phase = "countdown";
      race.goAt = now + COUNTDOWN_TIME;
      race.status = "Prepare-se: 3, 2, 1...";
      return;
    }
    if (input.throttle <= THROTTLE_THRESHOLD) {
      if (race.phase === "starting") {
        race.phase = "idle";
        race.status = "Início cancelado.";
      }
      race.armed = true;
      return;
    }
    if (race.phase !== "starting") {
      if (!race.armed) return;
      race.phase = "starting";
      race.holdSince = now;
      race.status = "Mantenha o acelerador.";
    }
    if (now - race.holdSince >= START_HOLD_TIME) begin(race, now);
    return;
  }
  if (race.phase === "countdown") {
    if (finish) {
      race.phase = "idle";
      race.status = "Largada cancelada.";
    } else if (now >= race.goAt) begin(race, now);
    return;
  }
  if (finish) return stopRace(race, "Corrida finalizada pelo botão B.");
  if (input.throttle > MOVING_THROTTLE) race.lastMove = now;
  else if (now - race.lastMove >= INACTIVITY_TIME)
    stopRace(race, "Corrida finalizada por inatividade.");
}
export const countdownOf = (race: Race, now: number) =>
  race.phase === "countdown" ? Math.max(0, (race.goAt - now) / 1000) : null;

export const MAX_SPEED = 40;
/** Imaginary speed (km/h) proportional to the throttle, with smooth acceleration. */
export function speedStep(speed: number, input: Input, active: boolean, dt: number) {
  if (!active) return 0;
  const target =
    MAX_SPEED * Math.pow(input.throttle / 100, 1.4) * (1 - input.brake / 100);
  return speed + (target - speed) * Math.min(1, dt * (input.brake ? 6 : 2));
}
