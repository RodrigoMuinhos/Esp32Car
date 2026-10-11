import type { ReactNode } from "react";
import { Activity, Battery, RotateCcw, Signal } from "lucide-react";
import type { Input } from "../types/telemetry";

export function Card({
  title,
  icon,
  tag,
  children,
  className = "",
}: {
  title: string;
  icon?: ReactNode;
  tag?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`card ${className}`}>
      <div className="card-heading">
        <h2>
          {icon}
          {title}
        </h2>
        {tag && <span className="card-tag">{tag}</span>}
      </div>
      {children}
    </section>
  );
}
const value = (n: number | null, unit = "") =>
  n === null ? "—" : `${Math.round(n)}${unit}`;
export function HeaderStatus({
  connected,
  signal,
  battery,
  simulation,
}: {
  connected: boolean;
  signal: number | null;
  battery: number | null;
  simulation: boolean;
}) {
  return (
    <div className="header-status">
      <span className={`connection ${connected ? "online" : ""}`}>
        <i />
        {simulation ? "SIMULAÇÃO" : connected ? "CONECTADO" : "DESCONECTADO"}
      </span>
      <span>
        <Signal size={15} />
        {value(signal, "%")}
      </span>
      <span>
        <Battery size={17} />
        {value(battery, "%")}
      </span>
    </div>
  );
}
/** Live wheel and pedal readings are for measuring: they run only while calibration is on. */
export type Calibration = { on: boolean; toggle: () => void };

function CalibrationToggle({ calibration }: { calibration: Calibration }) {
  return (
    <button
      className={`calibration-toggle ${calibration.on ? "active" : ""}`}
      aria-pressed={calibration.on}
      onClick={calibration.toggle}
      title="Mede direção e pedais ao vivo"
    >
      CALIBRAÇÃO {calibration.on ? "LIGADA" : "DESLIGADA"}
    </button>
  );
}

export function SteeringPanel({
  steering: liveSteering,
  raw: liveRaw,
  calibration,
}: {
  steering: number;
  raw: number;
  calibration?: Calibration;
}) {
  const paused = calibration ? !calibration.on : false;
  const steering = paused ? 0 : liveSteering;
  const raw = paused ? 0 : liveRaw;
  return (
    <Card
      title="Direção"
      icon={<RotateCcw />}
      tag={calibration ? <CalibrationToggle calibration={calibration} /> : "EIXO X"}
      className={`steering-card ${paused ? "calibration-off" : ""}`}
    >
      <div className="steering-content">
        <div
          className="wheel"
          style={{ transform: `rotate(${raw * 0.45}deg)` }}
        >
          <img className="wheel-icon" src="/icons/volante.png" alt="Volante" draggable={false} />
        </div>
        <div className="angle">
          <strong>
            {raw > 0 ? "+" : ""}
            {(raw * 0.45).toFixed(0)}
            <small>°</small>
          </strong>
          <span>VOLANTE USB / INPUT</span>
          <p>
            Saída <b>{steering.toFixed(0)}%</b>
          </p>
        </div>
      </div>
      <div className="steering-scale">
        <i style={{ left: `${50 + steering / 2}%` }} />
      </div>
      <div className="scale-labels">
        <span>−45° ESQUERDA</span>
        <span>0°</span>
        <span>DIREITA +45°</span>
      </div>
    </Card>
  );
}
export function PedalsPanel({
  throttle: liveThrottle,
  brake: liveBrake,
  calibration,
}: Pick<Input, "throttle" | "brake"> & { calibration?: Calibration }) {
  const paused = calibration ? !calibration.on : false;
  const throttle = paused ? 0 : liveThrottle;
  const brake = paused ? 0 : liveBrake;
  return (
    <Card
      title="Pedais"
      icon={<Activity />}
      tag={calibration ? <CalibrationToggle calibration={calibration} /> : "AO VIVO"}
      className={`pedals-card ${paused ? "calibration-off" : ""}`}
    >
      <div className="pedals">
        {[
          { title: "ACELERADOR", n: throttle, color: "green", key: "RT / RB" },
          { title: "FREIO / K2", n: brake, color: "red", key: "LT / LB" },
        ].map((p) => (
          <div className={`pedal-column ${p.color}`} key={p.title}>
            <div className="pedal-readout">
              {Math.round(p.n)}
              <small>%</small>
            </div>
            <div className="pedal">
              <div className="pedal-fill" style={{ height: `${p.n}%` }} />
              <div className="pedal-lines" />
            </div>
            <strong>{p.title}</strong>
            <span>{p.key}</span>
          </div>
        ))}
      </div>
    </Card>
  );
}
