import { useEffect, useRef, useState } from "react";
import type { RaceState } from "../types/telemetry";
import { RaceAudio } from "./raceAudio";

const GEAR_TOPS = [9, 17, 25, 33, 41]; // km/h at the top of each virtual gear
const IDLE_RPM = 0.16;
const STORAGE_KEY = "rc-racing-sound";

/** Engine RPM for the imaginary speed: it climbs in each gear and drops on upshift. */
export function gearRpm(speed: number) {
  let low = 0;
  for (const top of GEAR_TOPS) {
    if (speed < top) return 0.22 + (0.74 * (speed - low)) / (top - low);
    low = top;
  }
  return 0.96;
}

function readMuted() {
  try {
    return localStorage.getItem(STORAGE_KEY) === "off";
  } catch {
    return false;
  }
}

/**
 * Plays the race soundtrack. The engine runs from the countdown until the race
 * ends: revving with the throttle while stopped, following the gears when moving.
 * Returns the current RPM (0..1) for the on-screen sound meter.
 */
export function useRaceAudio({
  state,
  countdown,
  status,
  throttle,
  speed,
}: {
  state: RaceState;
  countdown: number | null;
  status: string;
  throttle: number;
  speed: number;
}) {
  const audio = useRef<RaceAudio | null>(null);
  audio.current ??= new RaceAudio();
  const [muted, setMuted] = useState(readMuted);
  const meter = useRef<HTMLElement | null>(null);
  const live = useRef({ state, throttle, speed });
  live.current = { state, throttle, speed };

  useEffect(() => {
    audio.current!.setMuted(muted);
    try {
      localStorage.setItem(STORAGE_KEY, muted ? "off" : "on");
    } catch {
      /* per-viewer preference only */
    }
  }, [muted]);

  // Browsers may only start audio after a user gesture; the app window allows it.
  useEffect(() => {
    const unlock = () => audio.current!.unlock();
    window.addEventListener("pointerdown", unlock);
    window.addEventListener("keydown", unlock);
    return () => {
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
    };
  }, []);

  // Countdown beeps (3, 2, 1), GO, finish fanfare and cancel blip.
  const previous = useRef({ state, second: 0 });
  useEffect(() => {
    const sfx = audio.current!;
    const second = countdown === null ? 0 : Math.ceil(countdown);
    const was = previous.current;
    if (state === "countdown" && second > 0 && second !== was.second) sfx.countdownBeep();
    if (state === "running" && was.state !== "running") sfx.go();
    if (state === "finished" && was.state === "running") sfx.finish();
    if (
      state === "idle" &&
      (was.state === "countdown" || was.state === "starting") &&
      /cancelad/i.test(status)
    )
      sfx.cancel();
    previous.current = { state, second };
  }, [state, countdown, status]);

  // Engine: 30 updates per second (timers keep running in the app window).
  useEffect(() => {
    let rpm = 0;
    let last = performance.now();
    let wasOn = false;
    const id = window.setInterval(() => {
      const now = performance.now();
      const dt = Math.min((now - last) / 1000, 0.2);
      last = now;
      const { state, throttle, speed } = live.current;
      const on = state === "countdown" || state === "starting" || state === "running";
      if (on && !wasOn) rpm = 0.55; // starter: a quick rev before settling to idle
      wasOn = on;
      const load = throttle / 100;
      const free = IDLE_RPM + load * 0.78; // revving while stopped
      const target = !on
        ? 0
        : speed > 2
          ? Math.max(gearRpm(speed), IDLE_RPM)
          : free;
      rpm += (target - rpm) * Math.min(1, dt * (target > rpm ? 7 : 3));
      audio.current!.engineUpdate(on, rpm, on ? load : 0);
      meter.current?.style.setProperty("--rpm", (on ? rpm : 0).toFixed(3));
    }, 33);
    return () => {
      window.clearInterval(id);
      audio.current!.engineUpdate(false, 0, 0);
    };
  }, []);

  return { muted, toggleMuted: () => setMuted((m) => !m), meter };
}
