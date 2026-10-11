import { useState } from "react";
import { ArrowLeft } from "lucide-react";
import type { Fleet, RaceState } from "../types/telemetry";
import { formatTime } from "../hooks/useRaceTimer";
import { CameraFeed } from "./CameraFeed";
import { carInfo } from "../slots";

/** Rows of the left ranking (the frame has four). */
const RANK_ROWS = 4;
const lapTime = (ms: number) => formatTime(ms).replace(/^00:/, "");

/**
 * "Visão Piloto": a driver HUD, not a page. Five layers on a stage that fills the screen (every
 * position in % of the stage, so the data follows the frame on any screen):
 * 1) live camera behind the frame, inside a thin black margin;
 * 2) a light vignette for legibility;  3) the HUD frame (PNG), solid and glowing
 * and glowing over the camera; 4) the race data in the frame's own slots;
 * 5) special states (start, finish, no board / no wheel). The center stays free:
 * it is the driver's view of the track. Drivers are anonymous: cars by color.
 */
export function PilotView({
  slotNumber = 1,
  colorNumber,
  fleet,
  state,
  countdown,
  raceMode,
  lapCount,
  session,
  best,
  speed,
  connected,
  wheelConnected,
  onExit,
}: {
  /** Color slot of this cockpit. */
  slotNumber?: number;
  /** Color of the car (1..16); defaults to the slot number. */
  colorNumber?: number;
  /** The fleet, for the live order (position and the left ranking). */
  fleet: Fleet | null;
  state: RaceState;
  countdown: number | null;
  raceMode: number;
  lapCount: number;
  session: number;
  best: number | null;
  /** Estimated from the throttle: the car has no speed sensor. */
  speed: number | null;
  connected: boolean;
  wheelConnected: boolean;
  onExit: () => void;
}) {
  // Camera controls live in the corner tools, not over the picture.
  const [cameraSlot, setCameraSlot] = useState<HTMLElement | null>(null);
  const order = fleet?.classification ?? [];
  const colorOf = (slot: number) => fleet?.slots.find((s) => s.number === slot)?.color ?? slot;
  const mine = order.find((row) => row.slot === slotNumber);
  const racing = state === "running";
  const lap = raceMode ? Math.min(lapCount + 1, raceMode) : lapCount + 1;
  const second = countdown === null ? 0 : Math.max(1, Math.ceil(countdown));
  const banner = !connected
    ? { tone: "bad", text: "SEM SINAL DO CARRINHO" }
    : !wheelConnected
      ? { tone: "bad", text: "VOLANTE DESCONECTADO" }
      : state === "countdown"
        ? { tone: "yellow", text: `LARGADA EM ${second}` }
        : state === "starting"
          ? { tone: "yellow", text: "MANTENHA O ACELERADOR" }
          : state === "running"
            ? null // racing: nothing over the track
            : state === "finished"
              ? { tone: "checkered", text: "BANDEIRADA" }
              : { tone: "idle", text: "ACELERE PARA LARGAR" };
  const me = carInfo(colorNumber ?? slotNumber);
  return (
    <div className="pilot-hud" style={{ "--me": me.color } as React.CSSProperties}>
      {/* 1-2: the camera fills the whole screen behind the frame, with a light vignette */}
      <div className="hud-camera">
        <CameraFeed label="CÂMERA 1 · AÉREA" controlsSlot={cameraSlot} />
        <i className="hud-vignette" aria-hidden="true" />
      </div>
      <div className="hud-stage">
        {/* 3: the frame, glowing and slightly see-through over the camera */}
        <img className="hud-frame" src="/hud/pilot-frame.png" alt="" draggable={false} />
        {/* 4: race data in the frame's slots */}
        <div className="hud-data" aria-label="Dados da corrida">
          <div className="hud-timer" aria-label="Tempo de corrida">{formatTime(session)}</div>
          <div className="hud-best">
            <span>MELHOR VOLTA</span>
            <b>{best === null ? "—" : lapTime(best)}</b>
          </div>
          <div className="hud-position" aria-label="Posição">
            <span>POSIÇÃO</span>
            <b>
              {mine ? mine.position : "–"}
              <small>/{order.length || fleet?.available || "–"}</small>
            </b>
          </div>
          <ol className="hud-ranking" aria-label="Classificação">
            {Array.from({ length: RANK_ROWS }, (_, i) => {
              const row = order[i];
              const info = row ? carInfo(colorOf(row.slot)) : null;
              return (
                <li key={i} className={row && row.slot === slotNumber ? "me" : ""}>
                  <b>{i + 1}</b>
                  <span style={info ? ({ "--car": info.color } as React.CSSProperties) : undefined}>
                    {info ? info.name : "—"}
                  </span>
                </li>
              );
            })}
          </ol>
          <div className="hud-laps" aria-label="Volta">
            <span>VOLTA</span>
            <b>
              {String(lap).padStart(2, "0")}
              {raceMode ? <small> / {String(raceMode).padStart(2, "0")}</small> : null}
            </b>
            <em>{raceMode ? "CONTRA O RELÓGIO" : "LIVRE"}</em>
          </div>
          <div className="hud-speed" aria-label="Velocidade estimada">
            <b>{Math.round(speed ?? 0)}</b>
            <span>km/h</span>
            <em>ESTIMADA</em>
          </div>
          <div className="hud-me">
            <i aria-hidden="true" />
            {String(slotNumber).padStart(2, "0")} {me.name}
            <em className={racing ? "ok" : ""}>{racing ? "NA PISTA" : "NO BOX"}</em>
          </div>
        </div>
        {/* 5: special states, short and away from the driving area */}
        {banner && (
          <div className={`bc-banner hud-banner ${banner.tone}`} aria-live="polite">
            {banner.text}
          </div>
        )}
      </div>
      <div className="hud-tools">
        <button onClick={onExit} aria-label="Sair da visão piloto">
          <ArrowLeft size={14} /> VISÕES
        </button>
        <div className="camera-controls" ref={setCameraSlot} aria-label="Câmera da pista" />
      </div>
    </div>
  );
}
