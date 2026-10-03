import { useCallback, useEffect, useRef, useState } from "react";
export function formatTime(ms: number) {
  return `${Math.floor(ms / 60000)
    .toString()
    .padStart(2, "0")}:${Math.floor((ms / 1000) % 60)
    .toString()
    .padStart(2, "0")}.${Math.floor(ms % 1000)
    .toString()
    .padStart(3, "0")}`;
}
export function useRaceTimer(running: boolean) {
  const [session, setSession] = useState(0);
  const [laps, setLaps] = useState<number[]>([]);
  const clock = useRef({ start: 0, elapsed: 0, lapStart: 0 });
  useEffect(() => {
    if (!running) return;
    clock.current.start = performance.now() - clock.current.elapsed;
    let frame = 0;
    const tick = () => {
      clock.current.elapsed = performance.now() - clock.current.start;
      setSession(clock.current.elapsed);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      clock.current.elapsed = performance.now() - clock.current.start;
      setSession(clock.current.elapsed);
    };
  }, [running]);
  const lap = useCallback(() => {
    if (!running) return;
    const elapsed = performance.now() - clock.current.start;
    const duration = elapsed - clock.current.lapStart;
    setLaps((values) => [...values, duration]);
    clock.current.lapStart = elapsed;
  }, [running]);
  const reset = useCallback(() => {
    clock.current = { start: performance.now(), elapsed: 0, lapStart: 0 };
    setSession(0);
    setLaps([]);
  }, []);
  return {
    session,
    lapTime: Math.max(0, session - clock.current.lapStart),
    best: laps.length ? Math.min(...laps) : null,
    laps,
    lap,
    reset,
  };
}
