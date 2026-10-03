import type { CSSProperties, ReactNode } from "react";
import {
  Activity,
  Battery,
  Flag,
  Gauge,
  Radio,
  RotateCcw,
  Settings2,
  Signal,
  Thermometer,
  Timer,
  Usb,
  Zap,
} from "lucide-react";
import type {
  DriveMode,
  Input,
  RaceState,
  Telemetry,
} from "../types/telemetry";
import { formatTime } from "../hooks/useRaceTimer";

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
export function Speedometer({
  speed,
  maxSpeed,
  simulation,
  estimated = false,
}: {
  speed: number | null;
  maxSpeed: number;
  simulation: boolean;
  estimated?: boolean;
}) {
  const percent = Math.min(100, Math.max(0, ((speed ?? 0) / maxSpeed) * 100));
  return (
    <Card
      title="Velocidade"
      icon={<Gauge />}
      tag={simulation ? "SIMULADA" : estimated ? "ESTIMADA" : "TELEMETRIA"}
      className="speed-card"
    >
      <div className="gauge-wrap">
        <div
          className="speed-ring"
          style={{ "--progress": `${percent * 2.7}deg` } as CSSProperties}
        />
        <div className="gauge-ticks">
          {Array.from({ length: 41 }, (_, i) => (
            <i
              key={i}
              className={i % 5 === 0 ? "major" : ""}
              style={{ transform: `rotate(${-135 + i * 6.75}deg)` }}
            />
          ))}
        </div>
        <div className="speed-number">
          <strong>
            {speed === null
              ? "—"
              : Math.round(speed).toString().padStart(2, "0")}
          </strong>
          <span>KM/H</span>
        </div>
        <div
          className="gauge-needle"
          style={{ transform: `rotate(${-135 + percent * 2.7}deg)` }}
        />
        <span className="gauge-min">0</span>
        <span className="gauge-max">{maxSpeed}</span>
      </div>
      <div className="card-foot">
        <span>
          {speed === null
            ? "Sensor não disponível"
            : estimated
              ? "PROPORCIONAL AO ACELERADOR"
              : "VELOCIDADE ATUAL"}
        </span>
        <span className="cyan">
          {simulation
            ? "MODELO VIRTUAL"
            : estimated
              ? "REFERÊNCIA ESTIMADA"
              : "DADOS DO CARRINHO"}
        </span>
      </div>
    </Card>
  );
}
export function SteeringPanel({
  steering,
  raw,
}: {
  steering: number;
  raw: number;
}) {
  return (
    <Card
      title="Direção"
      icon={<RotateCcw />}
      tag="EIXO X"
      className="steering-card"
    >
      <div className="steering-content">
        <div
          className="wheel"
          style={{ transform: `rotate(${raw * 0.45}deg)` }}
        >
          <img src="/volante.png" alt="Volante" draggable={false} />
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
export function PowerGauge({
  power,
  enabled,
}: {
  power: number;
  enabled: boolean;
}) {
  return (
    <Card
      title="Potência solicitada"
      icon={<Zap />}
      tag="INPUT"
      className="power-card"
    >
      <div
        className="power-readout"
        style={{ "--power": `${power * 2.7}deg` } as CSSProperties}
      >
        <strong>
          {Math.round(power)}
          <small>%</small>
        </strong>
        <span className={enabled ? "green" : ""}>
          {enabled ? "LIBERADA" : "BLOQUEADA"}
        </span>
      </div>
      <div className="power-bars">
        {Array.from({ length: 30 }, (_, i) => (
          <i
            key={i}
            style={{
              background:
                i < (power / 100) * 30
                  ? i > 23
                    ? "#ff5264"
                    : i > 17
                      ? "#f6bd58"
                      : "#fc6f20"
                  : undefined,
            }}
          />
        ))}
      </div>
      <div className="scale-labels">
        <span>0</span>
        <span>25</span>
        <span>50</span>
        <span>75</span>
        <span>100%</span>
      </div>
      <p className="micro-note">Relés físicos acionam ligado / desligado.</p>
    </Card>
  );
}
export function PedalsPanel({
  throttle,
  brake,
}: Pick<Input, "throttle" | "brake">) {
  return (
    <Card
      title="Pedais"
      icon={<Activity />}
      tag="AO VIVO"
      className="pedals-card"
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
export function StartSequence({
  state,
  status,
  countdown,
}: {
  state: RaceState;
  status: string;
  countdown: number | null;
}) {
  // Countdown lights go red, orange, yellow, then green on GO.
  const second = countdown === null ? 0 : Math.max(1, Math.ceil(countdown));
  const [title, detail, light, count] =
    state === "countdown"
      ? ["PREPARE-SE", "Carrinho liberado no GO · B cancela", 3 - second, String(second)]
      : state === "starting"
        ? ["MANTENHA O ACELERADOR", "Solte para cancelar", 1, "0,5"]
        : state === "running"
          ? ["CORRIDA ATIVA", "B finaliza · 15 s parado encerra", 3, "GO"]
          : state === "finished"
            ? ["CORRIDA FINALIZADA", status, -1, "FIM"]
            : [
                "APERTE A PARA LARGAR",
                /cancelad/i.test(status) ? status : "ou segure o acelerador 0,5 s",
                -1,
                "A",
              ];
  const progress =
    state === "countdown" && countdown !== null
      ? 1 - countdown / 3
      : state === "running"
        ? 1
        : 0;
  const lit = light >= 0 ? `light-${light} lit` : "";
  return (
    <Card
      title="Largada"
      icon={<Flag />}
      tag={
        state === "idle"
          ? "AGUARDANDO"
          : state === "finished"
            ? "ENCERRADA"
            : state === "running"
              ? "EM PISTA"
              : "LARGANDO"
      }
      className="start-card"
    >
      <div className="start-lights race-hud">
        <div className={`start-light hud-message ${lit}`}>
          <i />
          <div>
            <strong>{title}</strong>
            <small>{detail}</small>
            <span className="hud-progress">
              <b style={{ width: `${Math.min(1, Math.max(0, progress)) * 100}%` }} />
            </span>
          </div>
        </div>
        <div className={`start-light hud-count ${lit}`}>
          <strong>{count}</strong>
        </div>
      </div>
    </Card>
  );
}
export function TrackMap({
  position,
  simulation,
  enabled,
}: {
  position: Telemetry["position"];
  simulation: boolean;
  enabled: boolean;
}) {
  return (
    <Card
      title="Mapa da pista"
      icon={<Flag />}
      tag={
        <>
          <i className="tiny-dot" /> CIRCUITO 01
        </>
      }
      className="track-card"
    >
      <div className="track-info">
        <span className="pill">
          {simulation ? "TRAJETÓRIA ILUSTRATIVA" : "POSIÇÃO DO CARRINHO"}
        </span>
        <span className="map-coordinate">
          {position
            ? `X ${position.x.toFixed(1)} · Y ${position.y.toFixed(1)}`
            : "SEM LOCALIZAÇÃO"}
        </span>
      </div>
      <div className="map-canvas">
        <div className="map-plane">
          <svg
            viewBox="0 0 1000 355"
            preserveAspectRatio="xMidYMid slice"
            className="map-art"
            aria-label="Mapa da pista"
          >
            <image
              href="/rele-pista.jpg"
              width="1000"
              height="355"
              preserveAspectRatio="none"
            />
            {simulation && (
              <ellipse
                cx="500"
                cy="178"
                rx="400"
                ry="120"
                className="virtual-path"
              />
            )}
          </svg>
          {position && (
            <div
              className="vehicle-marker"
              style={{
                left: `${position.x}%`,
                top: `${position.y}%`,
                transform: `translate(-50%, -50%) rotate(${position.heading}deg)`,
              }}
            >
              <span>▲</span>
            </div>
          )}
          {!position && (
            <div className="map-empty">Aguardando localização do carrinho</div>
          )}
          <span className="map-north">N ↑</span>
        </div>
      </div>
      <div className="track-bottom">
        <span>
          <i className={`tiny-dot ${enabled ? "green-dot" : ""}`} />
          {enabled ? "SESSÃO EM ANDAMENTO" : "AGUARDANDO LARGADA"}
        </span>
        <span>
          {simulation
            ? "MAPA REAL · POSIÇÃO SIMULADA"
            : "LOCALIZAÇÃO VIA BACKEND"}
        </span>
      </div>
    </Card>
  );
}
export function RelayPanel({
  telemetry,
  available,
  onTest,
  onStop,
  onClaim,
}: {
  telemetry: Telemetry;
  available: boolean;
  onTest: (relay: number) => void;
  onStop: () => void;
  onClaim: () => void;
}) {
  const labels = ["Acelerar", "Freio / ré", "Direita", "Esquerda"];
  return (
    <Card
      title="Controle dos relés"
      icon={<Radio />}
      tag={`${telemetry.port} · ${telemetry.connected ? "ONLINE" : "OFFLINE"}`}
      className="relay-card"
    >
      <div className="relay-confirmations">
        {labels.map((label, index) => (
          <span
            key={label}
            className={
              telemetry.relayMask !== null && telemetry.relayMask & (1 << index)
                ? "relay-on"
                : ""
            }
          >
            <i />K{index + 1}
            <small>
              {telemetry.relayMask === null
                ? "SEM RESPOSTA"
                : telemetry.relayMask & (1 << index)
                  ? "LIGADO"
                  : "DESLIGADO"}
            </small>
          </span>
        ))}
      </div>
      {telemetry.connected && !telemetry.controlAvailable && (
        <button className="claim-button" onClick={onClaim}>
          ASSUMIR CONTROLE NESTA JANELA
        </button>
      )}
      <div className="relay-pad">
        {[1, 2, 3, 4].map((n) => (
          <button
            key={n}
            className={`relay-key relay-key-${n}`}
            disabled={!available}
            onClick={() => onTest(n)}
            aria-label={`Testar relé K${n}`}
          >
            <strong>{["▲", "▼", "▶", "◀"][n - 1]}</strong>
            <span>
              K{n} · {labels[n - 1]}
            </span>
          </button>
        ))}
        <button
          className="relay-stop"
          onClick={onStop}
          aria-label="Desligar todos os relés"
        >
          ■<small>PARAR</small>
        </button>
      </div>
      <div className="relay-note">
        {telemetry.phase === "countdown"
          ? "Largada em preparação · relés bloqueados"
          : telemetry.carEnabled
            ? "Volante no comando · confirmação ao vivo acima"
            : "Clique para testar · pulso de 0,5 segundo"}
        <span>
          {telemetry.connected
            ? "ESTADO CONFIRMADO PELO ESP32"
            : "AGUARDANDO A PLACA"}
        </span>
      </div>
    </Card>
  );
}
export function CarStatus({
  telemetry,
  simulation,
}: {
  telemetry: Telemetry;
  simulation: boolean;
}) {
  return (
    <Card
      title="Status do carrinho"
      icon={<Radio />}
      tag={simulation ? "VIRTUAL" : "RC · 01"}
      className="status-card"
    >
      <div className="car-status-body">
        <div className="car-illustration">
          <img src="/car.png" alt="Carrinho RC off-road" draggable={false} />
          <span className={telemetry.connected ? "green" : "red"}>
            <i className="tiny-dot" />
            {telemetry.connected
              ? simulation
                ? "SIMULADO"
                : "ONLINE"
              : "OFFLINE"}
          </span>
        </div>
        <div className="car-metrics">
          <span>
            <Battery />
            Bateria <b>{value(telemetry.battery, "%")}</b>
          </span>
          <span>
            <Thermometer />
            Temperatura <b>{value(telemetry.temperature, "°C")}</b>
          </span>
          <span>
            <Zap />
            Motor{" "}
            <b className={telemetry.carEnabled ? "green" : ""}>
              {telemetry.carEnabled ? "LIBERADO" : "BLOQUEADO"}
            </b>
          </span>
          <span>
            <Signal />
            Sinal <b>{value(telemetry.signal, "%")}</b>
          </span>
        </div>
      </div>
    </Card>
  );
}
export function TimingPanel({
  timer,
  running,
}: {
  timer: ReturnType<typeof import("../hooks/useRaceTimer").useRaceTimer>;
  running: boolean;
}) {
  return (
    <Card
      title="Cronometragem"
      icon={<Timer />}
      tag={`VOLTA ${String(timer.laps.length + 1).padStart(2, "0")}`}
      className="timing-card"
    >
      <div className="lap-time">
        <span>TEMPO DA VOLTA</span>
        <strong>{formatTime(timer.lapTime)}</strong>
      </div>
      <div className="timing-details">
        <div>
          <span>MELHOR VOLTA</span>
          <strong className="green">
            {timer.best === null ? "— — : — —" : formatTime(timer.best)}
          </strong>
        </div>
        <div>
          <span>TEMPO DE SESSÃO</span>
          <strong>{formatTime(timer.session)}</strong>
        </div>
        <button
          className="icon-button"
          disabled={!running}
          onClick={timer.lap}
          title="Registrar volta manualmente"
          aria-label="Registrar volta"
        >
          <Flag size={18} />
        </button>
      </div>
    </Card>
  );
}
export function ControlSettings({
  mode,
  setMode,
  steering,
  setSteering,
  throttle,
  setThrottle,
  locked,
}: {
  mode: DriveMode;
  setMode: (v: DriveMode) => void;
  steering: number;
  setSteering: (n: number) => void;
  throttle: number;
  setThrottle: (n: number) => void;
  locked: boolean;
}) {
  return (
    <Card
      title="Ajustes do controle"
      icon={<Settings2 />}
      tag="SENSIBILIDADE"
      className="settings-card"
    >
      <div className="settings-sliders">
        <label>
          DIREÇÃO <b>{steering}%</b>
          <input
            aria-label="Sensibilidade da direção"
            type="range"
            min="10"
            max="100"
            value={steering}
            disabled={locked}
            onChange={(e) => setSteering(+e.target.value)}
          />
        </label>
        <label>
          ACELERADOR <b>{throttle}%</b>
          <input
            aria-label="Sensibilidade do acelerador"
            type="range"
            min="10"
            max="100"
            value={throttle}
            disabled={locked}
            onChange={(e) => setThrottle(+e.target.value)}
          />
        </label>
      </div>
      <div className="mode-tabs">
        {(["normal", "sport", "precision"] as const).map((m) => (
          <button
            key={m}
            disabled={locked}
            className={mode === m ? "selected" : ""}
            onClick={() => setMode(m)}
          >
            {{ normal: "NORMAL", sport: "ESPORTIVO", precision: "PRECISÃO" }[m]}
          </button>
        ))}
      </div>
    </Card>
  );
}
export function InputSource({
  name,
  supported,
}: {
  name?: string;
  supported?: boolean;
}) {
  return (
    <span className="input-source" title={name}>
      <Usb size={13} />
      {name
        ? supported
          ? "VOLANTE USB DETECTADO"
          : "CONTROLE SEM MAPEAMENTO"
        : "PRESSIONE UM BOTÃO DO VOLANTE PARA DETECTAR"}
    </span>
  );
}
