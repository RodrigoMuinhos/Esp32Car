import type { CSSProperties } from "react";
import { Flag, MonitorPlay, Play, Square, Usb } from "lucide-react";
import type { Fleet } from "../types/telemetry";
import { carInfo } from "../slots";
import { simulationArena } from "../arena";

type Command = (type: string, data?: Record<string, unknown>) => void;

/**
 * Race operation at the top of the Visão Mecânico (the Visão Corrida is the big
 * screen only): start/stop everyone, race mode, self-test on plug, ready count,
 * open the big screen; boards waiting for a slot.
 */
export function RaceOperations({ fleet, command, operator }: { fleet: Fleet; command: Command; operator: boolean }) {
  const mode = fleet.slots[0]?.raceMode ?? 0;
  const anyRacing = fleet.slots.some((s) => s.phase === "running" || s.phase === "countdown");
  // Only configured slots take part (the next ones are added in the grid).
  const cars = fleet.slots.filter((s) => s.number <= fleet.available);
  const ready = cars.filter((s) => s.connected && s.wheelConnected && !s.blocked).length;
  return (
    <>
      <div className="fleet-bar" role="toolbar" aria-label="Operação da corrida">
        <button className="start-all" disabled={!operator || anyRacing || !ready} onClick={() => command("startAll")}>
          <Play size={16} fill="currentColor" /> LARGAR TODOS · 3, 2, 1
        </button>
        <button className="stop-all" onClick={() => command("stopAll")} disabled={!operator}>
          <Square size={14} fill="currentColor" /> PARAR TODOS
        </button>
        <div className="fleet-mode" role="radiogroup" aria-label="Modo da corrida">
          {[0, 3, 5].map((laps) => (
            <button
              key={laps}
              role="radio"
              aria-checked={mode === laps}
              className={mode === laps ? "active" : ""}
              disabled={!operator || anyRacing}
              onClick={() => command("mode", { laps })}
            >
              {laps ? `${laps} VOLTAS` : "LIVRE"}
            </button>
          ))}
        </div>
        <label className="fleet-auto">
          <input
            type="checkbox"
            checked={fleet.autoTest}
            disabled={!operator}
            onChange={(e) => command("autoTest", { enabled: e.target.checked })}
          />
          autoteste ao plugar
        </label>
        <span className="fleet-ready">
          <Flag size={14} /> {ready}/{cars.length} PRONTOS
        </span>
        <a className="fleet-link" href={simulationArena() ? "/?tela=telao&mode=simulation" : "/?tela=telao"} target="_blank" rel="noreferrer">
          <MonitorPlay size={14} /> ABRIR TELÃO
        </a>
      </div>
      {!operator && <p className="fleet-warning">Comandos gerais só no computador da corrida (PC Central).</p>}
      {fleet.spareBoards.length > 0 && (
        <section className="spare-boards mech-spare" aria-label="Carrinhos novos">
          <h3>CARRINHO NOVO PLUGADO</h3>
          {fleet.spareBoards.map((board) => (
            <div key={board.port} className="spare">
              <span>
                <Usb size={13} /> {board.boardId} · {board.port}
                <small>
                  {board.selfTest.running
                    ? " testando…"
                    : board.selfTest.results.every((r) => r === true)
                      ? " teste OK"
                      : board.selfTest.results.some((r) => r === false)
                        ? " falhou no teste"
                        : ""}
                </small>
              </span>
              <div>
                {cars.map((slot) => (
                  <button
                    key={slot.number}
                    style={{ "--slot-color": carInfo(slot.color ?? slot.number).color } as CSSProperties}
                    disabled={!operator || slot.phase === "running" || slot.phase === "countdown"}
                    onClick={() => command("assign", { port: board.port, slot: slot.number })}
                  >
                    {carInfo(slot.color ?? slot.number).name}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </section>
      )}
    </>
  );
}
