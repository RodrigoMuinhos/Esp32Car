import { useState, type CSSProperties, type ReactNode } from "react";
import { Check, Plus, Usb } from "lucide-react";
import type { Fleet, FleetSetup } from "../types/telemetry";
import { SLOT_INFO, carInfo } from "../slots";
import { SteeringWheelIcon } from "./SteeringWheelIcon";

type Command = (type: string, data?: Record<string, unknown>) => void;
const nn = (n: number) => String(n).padStart(2, "0");

/** A slot that is not configured yet and is not the next one: a discreet placeholder. */
export function SlotPlaceholder({ number }: { number: number }) {
  return (
    <section className="mech-card free" aria-label={`Vaga ${nn(number)} não configurada`}>
      <p className="slot-placeholder">
        VAGA {nn(number)} — NÃO CONFIGURADA
      </p>
    </section>
  );
}

function Step({ n, title, state, children }: { n: number; title: string; state: "done" | "active" | "next"; children?: ReactNode }) {
  return (
    <li className={`setup-step ${state}`}>
      <b>{state === "done" ? <Check size={13} /> : n}</b>
      <div>
        <strong>{title}</strong>
        {state === "active" && children}
      </div>
    </li>
  );
}

function Wizard({ setup, fleet, command }: { setup: FleetSetup; fleet: Fleet; command: Command }) {
  const order = ["sync", "confirm", "comms"] as const;
  const at = order.indexOf(setup.step);
  const state = (i: number) => (i < at ? "done" : i === at ? "active" : "next");
  const checks: [keyof FleetSetup["seen"], string][] = [
    ["left", "VOLANTE TODO À ESQUERDA"],
    ["right", "VOLANTE TODO À DIREITA"],
    ["throttle", "ACELERADOR NO FUNDO"],
    ["brake", "FREIO NO FUNDO"],
  ];
  return (
    <div className="setup-wizard">
      <ol>
        <Step n={1} title="ESCOLHER A COR" state="done" />
        <Step n={2} title="ALINHAR O CONTROLE" state={state(0)}>
          <p className="setup-hint">
            <SteeringWheelIcon size={16} /> Segure <b>A + B</b> juntos por 2 s no volante deste cockpit.
          </p>
        </Step>
        <Step n={3} title="CONFIRMAR VOLANTE E PEDAIS" state={state(1)}>
          <ul className="setup-checks">
            {checks.map(([key, label]) => (
              <li key={key} className={setup.seen[key] ? "ok" : ""}>
                {setup.seen[key] ? <Check size={12} /> : <span className="dot" />} {label}
              </li>
            ))}
          </ul>
          {setup.input && (
            <p className="setup-live">
              DIR <b>{Math.round(setup.input.steering)}</b> · ACEL <b>{Math.round(setup.input.throttle)}</b> · FREIO{" "}
              <b>{Math.round(setup.input.brake)}</b>
            </p>
          )}
        </Step>
        <Step n={4} title="COMUNICAÇÃO COM O CARRINHO" state={state(2)}>
          <p className="setup-hint">
            <Usb size={14} /> {setup.board ? "Placa respondendo…" : "Conecte a placa (ESP32) deste carrinho no PC Central."}
          </p>
          {!setup.board &&
            fleet.spareBoards
              .filter((board) => board.connected)
              .map((board) => (
                <div key={board.port} className="setup-board">
                  <span>
                    <Usb size={12} /> Placa plugada sem vaga: <b>{board.boardId} · {board.port}</b>
                  </span>
                  <button onClick={() => command("assign", { port: board.port, slot: setup.slot })}>USAR ESTA PLACA</button>
                </div>
              ))}
        </Step>
      </ol>
      <button className="setup-cancel" onClick={() => command("setupCancel")}>
        CANCELAR
      </button>
    </div>
  );
}

/**
 * The next free slot: one big "+ ADICIONAR CONTROLE"; then the color, and the
 * wizard run by the server (sync the wheel, confirm it, check the board).
 */
export function SlotSetup({ number, fleet, operator, command }: { number: number; fleet: Fleet; operator: boolean; command: Command }) {
  const [picking, setPicking] = useState(false);
  const [color, setColor] = useState<number | null>(null);
  const setup = fleet.setup?.slot === number ? fleet.setup : null;
  const used = new Set(fleet.slots.filter((s) => s.number <= fleet.available).map((s) => s.color ?? s.number));
  const shown = setup ? carInfo(setup.color) : color ? carInfo(color) : null;
  return (
    <section
      className={`mech-card add ${shown ? "colored" : ""}`}
      style={shown ? ({ "--slot-color": shown.color } as CSSProperties) : undefined}
      aria-label={`Vaga ${nn(number)}: adicionar controle`}
    >
      <header>
        <b>{nn(number)}</b>
        <strong>{shown ? shown.name : "NOVO CONTROLE"}</strong>
      </header>
      {setup ? (
        <Wizard setup={setup} fleet={fleet} command={command} />
      ) : picking ? (
        <div className="color-picker">
          <p className="setup-title">ESCOLHA A COR DO CARRINHO</p>
          <div className="color-grid" role="radiogroup" aria-label="Cor do carrinho">
            {SLOT_INFO.map((car) => {
              const taken = used.has(car.number);
              return (
                <button
                  key={car.number}
                  role="radio"
                  aria-checked={color === car.number}
                  disabled={taken}
                  className={color === car.number ? "active" : ""}
                  style={{ "--car-color": car.color } as CSSProperties}
                  onClick={() => setColor(car.number)}
                  title={taken ? `${car.name}: em uso` : car.name}
                >
                  <i />
                  {car.name}
                  {taken && <small>EM USO</small>}
                </button>
              );
            })}
          </div>
          <div className="setup-actions">
            <button
              className="setup-go"
              disabled={!color}
              onClick={() => {
                command("setupStart", { color });
                setPicking(false);
              }}
            >
              CONTINUAR
            </button>
            <button
              onClick={() => {
                setPicking(false);
                setColor(null);
              }}
            >
              CANCELAR
            </button>
          </div>
        </div>
      ) : (
        <button className="add-control" disabled={!operator} onClick={() => setPicking(true)}>
          <Plus size={28} /> ADICIONAR CONTROLE
        </button>
      )}
    </section>
  );
}
