// Same pedal rules as backend/control.py, used by the simulation mode.
import type { Hold, Input, RaceState } from "./types/telemetry";
export const THROTTLE_THRESHOLD = 5;
export const BRAKE_THRESHOLD = 10;
export const START_HOLD_TIME = 300;
export const STOP_HOLD_TIME = 5000;
export const INACTIVITY_TIME = 10_000;
const MOVING_THROTTLE = 3;
export type Race = {
  phase: RaceState;
  armed: boolean;
  holdSince: number | null;
  brakeSince: number | null;
  lastMove: number;
  raceId: number;
  status: string;
};
export const newRace = (): Race => ({
  phase: "idle",
  armed: false,
  holdSince: null,
  brakeSince: null,
  lastMove: 0,
  raceId: 0,
  status: "Segure o acelerador por 0,3 s para largar.",
});
export function stopRace(race: Race, status: string) {
  race.phase = race.phase === "running" || race.phase === "finished" ? "finished" : "idle";
  race.holdSince = race.brakeSince = null;
  race.armed = false; // release the throttle before a new start
  race.status = status;
}
export function stepRace(race: Race, input: Input, now: number, speed = 0) {
  if (race.phase === "idle" || race.phase === "finished") {
    if (input.throttle <= THROTTLE_THRESHOLD) race.armed = true;
    else if (race.armed) {
      race.phase = "starting";
      race.holdSince = now;
      race.status = "Mantenha o acelerador.";
    }
    return;
  }
  if (race.phase === "starting") {
    if (input.throttle <= THROTTLE_THRESHOLD) {
      race.phase = "idle";
      race.holdSince = null;
      race.status = "Início cancelado.";
      return;
    }
    if (now - race.holdSince! < START_HOLD_TIME) return;
    race.phase = "running";
    race.holdSince = null;
    race.raceId += 1;
    race.lastMove = now;
    race.status = "Corrida ativa.";
  }
  if (input.brake > BRAKE_THRESHOLD) {
    race.brakeSince ??= now;
    if (now - race.brakeSince >= STOP_HOLD_TIME)
      return stopRace(race, "Corrida finalizada pelo freio.");
  } else race.brakeSince = null;
  if (input.throttle > MOVING_THROTTLE || speed > 0.5) race.lastMove = now;
  else if (now - race.lastMove >= INACTIVITY_TIME)
    stopRace(race, "Corrida finalizada por inatividade.");
}
export function holdOf(race: Race, now: number): Hold {
  if (race.phase === "starting" && race.holdSince !== null)
    return { action: "start", remaining: Math.max(0, (START_HOLD_TIME - (now - race.holdSince)) / 1000) };
  if (race.phase === "running" && race.brakeSince !== null)
    return { action: "stop", remaining: Math.max(0, (STOP_HOLD_TIME - (now - race.brakeSince)) / 1000) };
  return null;
}

export const MAX_SPEED = 40;
/** Imaginary speed (km/h) proportional to the throttle, with smooth acceleration. */
export function speedStep(speed: number, input: Input, active: boolean, dt: number) {
  if (!active) return 0;
  const target =
    MAX_SPEED * Math.pow(input.throttle / 100, 1.4) * (1 - input.brake / 100);
  return speed + (target - speed) * Math.min(1, dt * (input.brake ? 6 : 2));
}
