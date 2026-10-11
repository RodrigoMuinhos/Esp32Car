import { useEffect, useRef } from "react";
import type { RaceTimes } from "../types/telemetry";
import { TRACK_LANES } from "../trackLanes";

const POINTS = TRACK_LANES[0].length;
/** Index of the finish line (checkered strip on the top straight, ~69% of the width). */
const FINISH = TRACK_LANES[1].reduce((best, [x, y], i) => {
  const [bx, by] = TRACK_LANES[1][best];
  return Math.hypot(x - 69, y - 21) < Math.hypot(bx - 69, by - 21) ? i : best;
}, 0);
const DEFAULT_LAP_MS = 10000;
/** A lap is split in this many stretches; each one picks a lane (changes are smooth). */
const STRETCHES = 10;

export type MapCar = { slot: number; color: string; racing: boolean; times: RaceTimes | null };

/** Repeatable pseudo-random 0..1 (same lap, stretch and car: same lane). */
const noise = (a: number, b: number, c: number) => {
  const s = Math.sin(a * 127.1 + b * 311.7 + c * 74.7) * 43758.5453;
  return s - Math.floor(s);
};
const at = (lane: number, index: number) => TRACK_LANES[lane][((index % POINTS) + POINTS) % POINTS];
/** Point on the track: fractional position along it and a fractional lane (0 outer .. 3 inner). */
function trackPoint(position: number, lane: number): [number, number] {
  const i = Math.floor(position), t = position - i;
  const l = Math.min(2, Math.floor(lane)), u = lane - l;
  const mix = (li: number) => {
    const [x0, y0] = at(li, i), [x1, y1] = at(li, i + 1);
    return [x0 + (x1 - x0) * t, y0 + (y1 - y0) * t];
  };
  const [ax, ay] = mix(l), [bx, by] = mix(l + 1);
  return [ax + (bx - ax) * u, ay + (by - ay) * u];
}
/** Lane at a point of the race (in laps): each stretch picks one, changes are smooth. */
function laneAt(laps: number, slot: number) {
  const lap = Math.floor(laps), s = (laps - lap) * STRETCHES, k = Math.floor(s), into = s - k;
  const laneOf = (n: number) => (n < 0 ? (slot - 1) % 4 : Math.floor(noise(lap, n, slot) * 4));
  const from = laneOf(k - 1), to = laneOf(k), blend = Math.min(1, into * 3);
  return from + (to - from) * (blend * blend * (3 - 2 * blend));
}

/**
 * Track map of the Visão Piloto (frontend/public/hud/pista.png, see-through). In the
 * SIMULAÇÃO arena a glowing dot in the car color shows where this car is, and smaller,
 * dimmer dots in the opposite color show the opponents, with the gap in seconds to the
 * car just ahead and just behind. Every dot runs continuously around the loop (never
 * stops or jumps): it follows the server's laps at the pace of the car's last lap. The
 * real cars have no position sensor: no dots.
 */
export function TrackMap({ cars, me, simulation }: { cars: MapCar[]; me: number; simulation: boolean }) {
  const layer = useRef<SVGSVGElement>(null);
  // Latest data and when it arrived (to move smoothly between messages).
  const latest = useRef({ cars, me, at: performance.now() });
  latest.current = { cars, me, at: performance.now() };
  useEffect(() => {
    if (!simulation) return;
    // Race progress of each car, in laps (continuous), and the race it belongs to.
    const state = new Map<number, { pos: number; elapsed: number }>();
    let frame = 0, last = performance.now();
    const draw = (now: number) => {
      const dt = Math.min(100, now - last);
      last = now;
      const { cars: list, me: mine, at: since } = latest.current;
      const progress = new Map<number, { pos: number; lapMs: number }>();
      for (const car of list) {
        const t = car.times;
        let s = state.get(car.slot);
        if (!car.racing || !t || t.elapsedMs === null) {
          state.delete(car.slot);
          progress.set(car.slot, { pos: 0, lapMs: DEFAULT_LAP_MS });
          continue;
        }
        const elapsed = t.elapsedMs + (now - since);
        if (!s || elapsed < s.elapsed - 1000) s = { pos: 0, elapsed }; // a new race starts on the line
        const lapMs = t.lastLapMs ?? t.bestLapMs ?? DEFAULT_LAP_MS;
        const target = t.laps + Math.min(1.25, Math.max(0, (elapsed - (t.lastMarkMs ?? 0)) / lapMs));
        // Always forward, at the car's pace, gently catching up with the server's laps.
        const speed = (1 / lapMs) * Math.min(1.8, Math.max(0.5, 1 + 1.5 * (target - s.pos)));
        s.pos += speed * dt;
        s.elapsed = elapsed;
        state.set(car.slot, s);
        progress.set(car.slot, { pos: s.pos, lapMs });
      }
      const mineAt = progress.get(mine);
      // Gaps (s) to the closest car ahead and behind, at this car's pace.
      let ahead: [number, number] | null = null, behind: [number, number] | null = null;
      if (mineAt)
        for (const [slot, p] of progress) {
          if (slot === mine) continue;
          const d = p.pos - mineAt.pos;
          if (d >= 0 && (!ahead || d < ahead[1])) ahead = [slot, d];
          if (d < 0 && (!behind || d > behind[1])) behind = [slot, d];
        }
      for (const car of list) {
        const node = layer.current?.querySelector<SVGGElement>(`[data-slot="${car.slot}"]`);
        if (!node) continue;
        const pos = progress.get(car.slot)?.pos ?? 0;
        const [x, y] = trackPoint(FINISH + (pos - Math.floor(pos)) * POINTS, Math.max(0, Math.min(3, laneAt(pos, car.slot))));
        node.setAttribute("transform", `translate(${x} ${y})`);
        const label = node.querySelector("text");
        if (label && mineAt) {
          const gap = car.slot === ahead?.[0] ? ahead[1] : car.slot === behind?.[0] ? behind[1] : null;
          label.textContent = gap === null ? "" : `${gap >= 0 ? "+" : "−"}${Math.abs((gap * mineAt.lapMs) / 1000).toFixed(1)}s`;
        }
      }
      frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, [simulation]);
  const others = cars.filter((c) => c.slot !== me);
  const mine = cars.find((c) => c.slot === me);
  return (
    <div className="hud-track" aria-label="Mapa da pista">
      <img src="/hud/pista.png" alt="" draggable={false} />
      {simulation && (
        <svg ref={layer} viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
          {others.map((car) => (
            <g key={car.slot} data-slot={car.slot} className="hud-track-rival">
              <ellipse rx="0.85" ry="1.28" />
              {/* the map is wider than tall (1541:1021): undo the stretch so the text reads right */}
              <text x="2.4" y="-1.6" transform="scale(0.663 1)" />
            </g>
          ))}
          {mine && (
            <g data-slot={mine.slot} className="hud-track-dot" style={{ color: mine.color }}>
              <ellipse rx="3.4" ry="5.1" className="halo" />
              <ellipse rx="1.5" ry="2.25" className="ring" />
              <ellipse rx="0.8" ry="1.2" className="core" />
            </g>
          )}
        </svg>
      )}
    </div>
  );
}
