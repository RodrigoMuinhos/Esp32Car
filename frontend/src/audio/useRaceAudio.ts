import { useEffect, useRef, useState } from "react";
import type { RaceState } from "../types/telemetry";
import { DEFAULT_VOLUMES, RaceAudio, type Volumes } from "./raceAudio";

const GEAR_TOPS = [9, 17, 25, 33, 41]; // km/h at the top of each virtual gear
const IDLE_RPM = 0.16;
/** Full throttle against the limit (stopped, or at top speed) bangs the rev limiter. */
const LIMITER_THROTTLE = 95;
const LIMITER_RPM = 0.9;
const TOP_SPEED_LIMITER = 37;
const STORAGE_KEY = "rc-racing-sound";
const VOLUME_KEY = "rc-racing-volumes";
/** Starter cranking before the engine catches, when A starts the countdown. */
export const IGNITION_SECONDS = 1;

/** Engine RPM for the imaginary speed: it climbs in each gear and drops on upshift. */
export function gearRpm(speed: number) {
  let low = 0;
  for (const top of GEAR_TOPS) {
    if (speed < top) return 0.22 + (0.74 * (speed - low)) / (top - low);
    low = top;
  }
  return 0.96;
}

function readVolumes(): Volumes {
  try {
    const saved = JSON.parse(localStorage.getItem(VOLUME_KEY) ?? "null");
    const pick = (key: keyof Volumes) =>
      typeof saved?.[key] === "number" ? Math.min(1, Math.max(0, saved[key])) : DEFAULT_VOLUMES[key];
    return { engine: pick("engine"), voice: pick("voice"), effects: pick("effects") };
  } catch {
    return { ...DEFAULT_VOLUMES };
  }
}

function readMuted() {
  try {
    return localStorage.getItem(STORAGE_KEY) === "off";
  } catch {
    return false;
  }
}

/**
 * Plays the race soundtrack. A cranks the starter, then the engine runs until
 * the race ends: revving with the throttle while stopped, following the gears
 * when moving. Braking or cornering hard at speed squeals the tires.
 * Returns the current RPM (0..1) for the on-screen sound meter.
 */
export function useRaceAudio({
  state,
  countdown,
  status,
  throttle,
  brake,
  steering = 0,
  speed,
  lapCount = 0,
}: {
  state: RaceState;
  countdown: number | null;
  status: string;
  throttle: number;
  brake: number;
  /** -100..100 */
  steering?: number;
  speed: number;
  lapCount?: number;
}) {
  const audio = useRef<RaceAudio | null>(null);
  audio.current ??= new RaceAudio();
  const [muted, setMuted] = useState(readMuted);
  const [volumes, setVolumes] = useState(readVolumes);
  const meter = useRef<HTMLElement | null>(null);
  const live = useRef({ state, throttle, brake, steering, speed });
  live.current = { state, throttle, brake, steering, speed };
  const ignitedAt = useRef(0);

  useEffect(() => {
    audio.current!.setMuted(muted);
    try {
      localStorage.setItem(STORAGE_KEY, muted ? "off" : "on");
    } catch {
      /* per-viewer preference only */
    }
  }, [muted]);

  useEffect(() => {
    audio.current!.setVolumes(volumes);
    try {
      localStorage.setItem(VOLUME_KEY, JSON.stringify(volumes));
    } catch {
      /* per-viewer preference only */
    }
  }, [volumes]);

  // Browsers may only start audio after a user gesture; the app window allows it.
  useEffect(() => {
    void audio.current!.loadVoices();
    const unlock = () => audio.current!.unlock();
    window.addEventListener("pointerdown", unlock);
    window.addEventListener("keydown", unlock);
    return () => {
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
    };
  }, []);

  // Countdown beeps and voice (three, two, one, go), GO, finish fanfare and cancel blip.
  const previous = useRef({ state, second: 0 });
  useEffect(() => {
    const sfx = audio.current!;
    const second = countdown === null ? 0 : Math.ceil(countdown);
    const was = previous.current;
    if (state === "countdown" && was.state !== "countdown") {
      sfx.ignition(IGNITION_SECONDS);
      ignitedAt.current = performance.now();
    }
    if (state === "countdown" && second > 0 && second !== was.second) {
      sfx.countdownBeep();
      sfx.voice(String(Math.min(3, second)) as "3" | "2" | "1");
    }
    if (state === "running" && was.state !== "running") {
      sfx.go();
      sfx.voice("go");
    }
    const emergency = /emergência/i.test(status);
    if (emergency && state !== was.state && (state === "finished" || state === "idle")) sfx.alarm();
    else if (state === "finished" && was.state === "running") sfx.finish();
    if (
      state === "idle" &&
      (was.state === "countdown" || was.state === "starting") &&
      /cancelad/i.test(status)
    )
      sfx.cancel();
    previous.current = { state, second };
  }, [state, countdown, status]);

  // A short chime for every lap marked during the race.
  const lapsHeard = useRef(lapCount);
  useEffect(() => {
    if (lapCount > lapsHeard.current) audio.current!.lapChime();
    lapsHeard.current = lapCount;
  }, [lapCount]);

  // Engine: 30 updates per second (timers keep running in the app window).
  useEffect(() => {
    let rpm = 0;
    let last = performance.now();
    let wasOn = false;
    const id = window.setInterval(() => {
      const now = performance.now();
      const dt = Math.min((now - last) / 1000, 0.2);
      last = now;
      const { state, throttle, brake, steering, speed } = live.current;
      const cranking =
        state === "countdown" && now - ignitedAt.current < IGNITION_SECONDS * 1000;
      const on =
        (state === "countdown" && !cranking) || state === "starting" || state === "running";
      if (on && !wasOn) rpm = 0.45; // the engine catches with a quick rev, then settles
      const switchedOff = wasOn && !on;
      wasOn = on;
      const load = throttle / 100;
      const free = IDLE_RPM + load * 0.78; // revving while stopped
      const target = !on
        ? 0
        : speed > 2
          ? Math.max(gearRpm(speed), IDLE_RPM)
          : free;
      const pinned = throttle >= LIMITER_THROTTLE && (speed < 2 || speed >= TOP_SPEED_LIMITER);
      rpm += ((pinned ? 0.97 : target) - rpm) * Math.min(1, dt * (target > rpm ? 7 : 3));
      const limiting = on && pinned && rpm >= LIMITER_RPM;
      // Off is sent once, so a volume preview can rev the engine between races.
      if (on || switchedOff) audio.current!.engineUpdate(on, rpm, on ? load : 0, limiting);
      const braking = brake > 10 ? (brake / 100) * Math.min(1, speed / 15) : 0;
      // Cornering: full lock above ~12 km/h starts to squeal, more with speed.
      const cornering =
        Math.abs(steering) > 60 ? ((Math.abs(steering) - 60) / 40) * Math.min(1, Math.max(0, speed - 12) / 15) * 0.7 : 0;
      audio.current!.tireUpdate(state === "running" ? Math.max(braking, cornering) : 0);
      meter.current?.style.setProperty("--rpm", (on ? rpm : 0).toFixed(3));
    }, 33);
    return () => {
      window.clearInterval(id);
      audio.current!.engineUpdate(false, 0, 0);
      audio.current!.tireUpdate(0);
    };
  }, []);

  return {
    muted,
    toggleMuted: () => setMuted((m) => !m),
    meter,
    volumes,
    setVolume: (key: keyof Volumes, value: number) =>
      setVolumes((old) => ({ ...old, [key]: Math.min(1, Math.max(0, value)) })),
    /** New event record: the fanfare (operator panel). */
    recordFanfare: () => audio.current!.recordFanfare(),
    /** Technical acceptance: a short test sound (follows the mute and the effects volume). */
    testSound: () => {
      const sfx = audio.current!;
      sfx.unlock();
      sfx.lapChime();
    },
    /** A short sample of a channel at its new volume. */
    preview: (key: keyof Volumes) => {
      const sfx = audio.current!;
      sfx.unlock();
      if (key === "voice") sfx.voice("go");
      else if (key === "effects") sfx.countdownBeep();
      else sfx.engineBlip();
    },
  };
}
