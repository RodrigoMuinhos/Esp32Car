import type { CSSProperties } from "react";
import type { Fleet } from "../types/telemetry";
import { formatTime } from "../hooks/useRaceTimer";
import { carFilter, carInfo, carLabel } from "../slots";

type Row = { slot: number; color: number; main: string; detail: string; racing: boolean };

/**
 * 1st-4th of the 4 colors. During a race: live order (laps, then time); between
 * races: the last result of each car, best lap first.
 */
export function standingRows(fleet: Fleet | null): Row[] {
  if (!fleet) return [];
  const colorOf = (slot: number) => fleet.slots.find((s) => s.number === slot)?.color ?? slot;
  if (fleet.classification.length) {
    const leader = fleet.classification[0];
    const racing = fleet.classification.map((r, i) => ({
      slot: r.slot,
      color: colorOf(r.slot),
      // Leader: race time. The others: laps behind, or seconds behind at the line.
      main:
        i === 0
          ? formatTime(r.elapsedMs ?? 0)
          : r.laps < leader.laps
            ? `+${leader.laps - r.laps} ${leader.laps - r.laps === 1 ? "VOLTA" : "VOLTAS"}`
            : `+${(((r.lastMarkMs ?? 0) - (leader.lastMarkMs ?? 0)) / 1000).toFixed(3)}`,
      detail: `${r.laps} ${r.laps === 1 ? "volta" : "voltas"}${r.bestLapMs ? ` · melhor ${formatTime(r.bestLapMs)}` : ""}`,
      racing: true,
    }));
    const rest = fleet.slots
      .filter((s) => s.number <= fleet.available && !racing.some((r) => r.slot === s.number) && s.connected)
      .map((s) => ({ slot: s.number, color: s.color ?? s.number, main: "—", detail: "fora da corrida", racing: false }));
    return [...racing, ...rest];
  }
  return fleet.slots
    .filter((s) => s.number <= fleet.available) // configured slots only
    .filter((s) => s.lastResult)
    .map((s) => {
      const r = s.lastResult!;
      // Time trial: whoever completed the laps first, by total time; else best lap.
      const [main, detail, sort] = r.completed
        ? [r.durationMs, `${r.laps} voltas completas`, r.durationMs]
        : r.bestLapMs
          ? [r.bestLapMs, "melhor volta", 1e9 + r.bestLapMs]
          : [r.durationMs, "sem voltas marcadas", 2e9 + r.durationMs];
      return { slot: s.number, color: s.color ?? s.number, main: formatTime(main), detail, racing: false, sort };
    })
    .sort((a, b) => a.sort - b.sort);
}

export function Standings({ fleet, big = false }: { fleet: Fleet | null; big?: boolean }) {
  const rows = standingRows(fleet);
  return (
    <section className={`standings-board ${big ? "big" : ""}`} aria-label="Classificação">
      <h3>CLASSIFICAÇÃO</h3>
      {rows.length ? (
        <ol>
          {rows.map((row, i) => {
            const info = carInfo(row.color);
            return (
              <li key={row.slot} style={{ "--slot-color": info.color } as CSSProperties}>
                <b className="pos">{i + 1}º</b>
                <img src="/car.png" alt="" style={{ filter: carFilter(info) }} />
                <span className="who">
                  <strong>{carLabel(row.slot, row.color)}</strong>
                  <small>{row.detail}</small>
                </span>
                <em className="time">{row.main}</em>
              </li>
            );
          })}
        </ol>
      ) : (
        <p className="standings-empty">Aguardando a largada.</p>
      )}
    </section>
  );
}
