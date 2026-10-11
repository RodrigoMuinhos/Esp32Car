import { useEffect, useRef, useState, type CSSProperties } from "react";
import { ArrowLeft } from "lucide-react";
import type { Fleet } from "../types/telemetry";
import { formatTime } from "../hooks/useRaceTimer";
import { CameraFeed } from "./CameraFeed";
import { carInfo } from "../slots";
import { VENUE_NAME } from "../venue";

/** Rows of the scoreboard (the frame has four). */
const ROWS = 4;
/** The final result stays on the big screen this long (contract: 2 min 30 s), or until the next start. */
const RESULT_MS = 150_000;
const LAST_LAP_MS = 3000;
const NEW_BEST_MS = 2500;
const short = (ms: number) => formatTime(ms).replace(/^00:/, "");

type Row = Fleet["classification"][number];

/**
 * Telão: a race broadcast for the audience, read-only. One 16:9 stage with the
 * frame (public/hud/telao-frame.png): the camera dominates in the frame's window,
 * the sports data sits in the frame's own slots (scoreboard, race, best lap,
 * bottom bar). Nothing operational (controls, boards, wheels, cameras, arena).
 * States: before the start (next race), countdown, racing (last lap notice),
 * final result. Cars are shown by color; drivers are anonymous.
 * `embedded`: the broadcast in the page flow; `onExit`: the Visão Corrida on the PC Central
 * (the same big screen, with a discreet way back to the other views).
 */
export function TelaoView({ fleet, embedded = false, onExit }: { fleet: Fleet | null; embedded?: boolean; onExit?: () => void }) {
  // Camera controls hidden in a corner (the operator turns the camera on once; the audience never sees controls).
  const [cameraSlot, setCameraSlot] = useState<HTMLElement | null>(null);
  const order = fleet?.classification ?? [];
  const racing = order.length > 0;
  const colorOf = (slot: number) => fleet?.slots.find((s) => s.number === slot)?.color ?? slot;
  const countdown = Math.max(0, ...(fleet?.slots.map((s) => (s.phase === "countdown" && s.countdown !== null ? s.countdown : 0)) ?? [0]));
  const target = fleet?.slots.find((s) => order.some((r) => r.slot === s.number))?.raceMode ?? fleet?.slots[0]?.raceMode ?? 0;
  const leader = order[0];
  const [now, setNow] = useState(() => performance.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(performance.now()), 250);
    return () => clearInterval(id);
  }, []);
  // Final result: the last order the server sent before the race ended (shown, not computed).
  const lastOrder = useRef<Row[]>([]);
  const [final, setFinal] = useState<{ rows: Row[]; at: number } | null>(null);
  useEffect(() => {
    if (racing) {
      lastOrder.current = order;
      setFinal(null);
    } else if (lastOrder.current.length) {
      setFinal({ rows: lastOrder.current, at: performance.now() });
      lastOrder.current = [];
    }
  }, [racing, order]);
  useEffect(() => {
    if (countdown > 0) setFinal(null);
  }, [countdown]);
  const showFinal = final && now - final.at < RESULT_MS ? final : null;
  // Last lap of a time trial: a short notice over the video, once per car's last lap.
  const [lastLap, setLastLap] = useState<{ at: number } | null>(null);
  const lastLapKey = useRef("");
  const onLastLap = !!leader && target > 0 && leader.laps === target - 1;
  useEffect(() => {
    const key = onLastLap ? `${leader?.slot}-${target}-${leader?.lastMarkMs}` : "";
    if (onLastLap && key !== lastLapKey.current) setLastLap({ at: performance.now() });
    lastLapKey.current = key;
  }, [onLastLap, leader?.slot, leader?.lastMarkMs, target]);
  // New best lap of the event: highlighted for a moment.
  const record = fleet?.record ?? null;
  const recordAlert = fleet?.alerts.find((a) => a.kind === "record") ?? null;
  const seenRecord = useRef<number | null | undefined>(undefined);
  const [newBest, setNewBest] = useState<number | null>(null);
  useEffect(() => {
    const id = recordAlert?.id ?? null;
    if (seenRecord.current !== undefined && id !== null && id !== seenRecord.current) setNewBest(performance.now());
    seenRecord.current = id;
  }, [recordAlert?.id]);
  const bestFresh = newBest !== null && now - newBest < NEW_BEST_MS;
  // Before the start: the cars of the next race (configured and on the track); PRONTO when cleared to start.
  const ready = (fleet?.slots ?? []).filter((s) => s.number <= (fleet?.available ?? 0) && s.connected);
  const mode = showFinal ? "final" : racing ? "race" : "next";
  const rows = mode === "final" ? showFinal!.rows : mode === "race" ? order : [];
  const gap = (row: Row, i: number) => {
    if (i === 0) return row.bestLapMs !== null ? short(row.bestLapMs) : "—";
    if (!leader) return "—";
    if (row.laps < leader.laps) return `+${leader.laps - row.laps} ${leader.laps - row.laps === 1 ? "VOLTA" : "VOLTAS"}`;
    return row.lastMarkMs !== null && leader.lastMarkMs !== null ? `+${((row.lastMarkMs - leader.lastMarkMs) / 1000).toFixed(3)}` : "—";
  };
  const lap = leader ? (target ? Math.min(leader.laps + 1, target) : leader.laps + 1) : null;
  const lapText = lap === null ? "—" : `${String(lap).padStart(2, "0")}${target ? ` / ${String(target).padStart(2, "0")}` : ""}`;
  const time = leader?.elapsedMs != null ? formatTime(leader.elapsedMs) : "—";
  const leaderName = leader ? carInfo(colorOf(leader.slot)).name : "—";
  const pilots = mode === "next" ? ready.length : rows.length;
  return (
    <div className={`telao-broadcast ${embedded ? "embedded" : ""}`}>
      <div className="tv-stage">
        <div className="tv-camera">
          <CameraFeed label="AO VIVO" controlsSlot={cameraSlot} />
          <i className="tv-vignette" aria-hidden="true" />
          {countdown > 0 && <div className="tv-count" aria-live="polite">{Math.ceil(countdown)}</div>}
          {lastLap && now - lastLap.at < LAST_LAP_MS && racing && <div className="tv-notice">ÚLTIMA VOLTA</div>}
        </div>
        <img className="tv-frame" src="/hud/telao-frame.png" alt="" draggable={false} />
        <div className="tv-data">
          <div className="tv-live"><i aria-hidden="true" /> AO VIVO</div>
          <div className="tv-event">{VENUE_NAME}</div>
          <h2 className="tv-board-title">{mode === "final" ? "RESULTADO FINAL" : mode === "race" ? "CLASSIFICAÇÃO" : "PRÓXIMA CORRIDA"}</h2>
          <ol className="tv-board" aria-label={mode === "final" ? "Resultado final" : mode === "race" ? "Classificação" : "Próxima corrida"}>
            {Array.from({ length: ROWS }, (_, i) => {
              const row = rows[i];
              const slot = mode === "next" ? ready[i] : undefined;
              const info = row ? carInfo(colorOf(row.slot)) : slot ? carInfo(slot.color ?? slot.number) : null;
              return (
                <li key={i} className={i === 0 && row ? "leader" : ""} style={info ? ({ "--car": info.color } as CSSProperties) : undefined}>
                  <b>{mode === "next" ? (info ? String(slot!.number).padStart(2, "0") : "") : `${i + 1}`}</b>
                  <span>{info ? info.name : "—"}</span>
                  <em>{row ? (mode === "final" ? `${row.laps} ${row.laps === 1 ? "VOLTA" : "VOLTAS"}` : gap(row, i)) : mode === "next" && slot && !slot.blocked ? "PRONTO" : ""}</em>
                </li>
              );
            })}
          </ol>
          {mode === "next" && ready.length > ROWS && <div className="tv-more">+{ready.length - ROWS} carrinhos</div>}
          <section className="tv-race" aria-label="Corrida">
            <h3>CORRIDA</h3>
            <dl>
              <div><dt>VOLTA</dt><dd>{lapText}</dd></div>
              <div><dt>TEMPO</dt><dd>{time}</dd></div>
              <div className="wide"><dt>LÍDER</dt><dd>{leaderName}</dd></div>
            </dl>
          </section>
          <section className={`tv-best ${bestFresh ? "fresh" : ""}`} aria-label="Melhor volta">
            <h3>{bestFresh ? "NOVA MELHOR VOLTA" : "MELHOR VOLTA"}</h3>
            <strong>{record ? formatTime(record.lapMs) : "—"}</strong>
            <span>{record ? `${String(record.slot).padStart(2, "0")} ${carInfo(record.color || record.slot).name}` : "Sem evento aberto"}</span>
          </section>
          <div className="tv-bar">
            <span>VOLTA {lapText}</span>
            <span>{time}</span>
            <span>1º {leaderName}</span>
            <span>{pilots} {pilots === 1 ? "CARRINHO" : "CARRINHOS"}</span>
          </div>
        </div>
        {mode === "final" && (
          <div className="tv-final" role="status">
            <h2>RESULTADO FINAL</h2>
            <ol>
              {showFinal!.rows.slice(0, ROWS).map((row, i) => (
                <li key={row.slot} style={{ "--car": carInfo(colorOf(row.slot)).color } as CSSProperties}>
                  <b>{i + 1}º</b> {carInfo(colorOf(row.slot)).name}
                </li>
              ))}
            </ol>
          </div>
        )}
      </div>
      <div className="tv-tools">
        {onExit && (
          <button className="tv-exit" onClick={onExit} aria-label="Sair da visão corrida">
            <ArrowLeft size={14} /> VISÕES
          </button>
        )}
        <div className="camera-controls" ref={setCameraSlot} aria-label="Câmera do telão" />
      </div>
    </div>
  );
}
