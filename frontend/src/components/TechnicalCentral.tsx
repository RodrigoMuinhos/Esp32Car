import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import {
  Battery,
  Camera,
  CircleCheck,
  CircleX,
  Clock,
  Cpu,
  ListChecks,
  Loader,
  Play,
  RotateCcw,
  ShieldAlert,
  ShieldCheck,
  Signal,
  Square,
  Thermometer,
  TriangleAlert,
  Usb,
  Volume2,
  Zap,
} from "lucide-react";
import { CameraFeed } from "./CameraFeed";
import { PedalsPanel, SteeringPanel, type Calibration } from "./Widgets";
import { carInfo } from "../slots";
import { unitVerdict } from "../unitVerdict";
import type {
  AcceptanceItemId,
  AcceptanceSummary,
  Fleet,
  FleetSlot,
  LogEntry,
  Telemetry,
  TestStatus,
  UnitState,
} from "../types/telemetry";

type Command = (type: string, data?: Record<string, unknown>) => void;
type Tab = "geral" | "diagnosticos" | "aceitacao" | "configuracoes";
const TABS: [Tab, string][] = [
  ["geral", "VISÃO GERAL"],
  ["diagnosticos", "DIAGNÓSTICOS"],
  ["aceitacao", "ACEITAÇÃO TÉCNICA"],
  ["configuracoes", "CONFIGURAÇÕES"],
];
export const STATE_TEXT: Record<UnitState, string> = {
  OFFLINE: "OFFLINE",
  CONNECTING: "CONECTANDO",
  READY: "PRONTO",
  TESTING: "TESTANDO",
  WARNING: "ATENÇÃO",
  FAULT: "FALHA",
  EMERGENCY_STOP: "EMERGÊNCIA",
};
const STATUS_TEXT: Record<TestStatus, string> = {
  idle: "AGUARDANDO",
  testing: "TESTANDO",
  passed: "APROVADO",
  failed: "FALHA",
};
/** Not measured on this car: shown as N/D, never made up. */
const ND = "N/D";

const ms = (n: number | null | undefined) => (n === null || n === undefined ? "—" : `${n} ms`);
const clock = (iso: string) => iso.slice(11, 19);
const uptime = (n: number | null | undefined) => {
  if (n === null || n === undefined) return "—";
  const s = Math.floor(n / 1000);
  return [Math.floor(s / 3600), Math.floor(s / 60) % 60, s % 60].map((v) => String(v).padStart(2, "0")).join(":");
};
/** Good / attention / critical, for the link numbers. */
const level = (value: number | null | undefined, good: number, bad: number) =>
  value === null || value === undefined ? "" : value < good ? "good" : value < bad ? "warn" : "bad";

function Panel({ title, sub, icon, tag, className = "", children }: {
  title: string;
  sub?: string;
  icon?: ReactNode;
  tag?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section className={`tc-panel ${className}`} aria-label={title}>
      <header>
        <h2>
          {icon}
          {title}
          {sub && <small>{sub}</small>}
        </h2>
        {tag}
      </header>
      {children}
    </section>
  );
}

function Badge({ tone, children }: { tone: "ok" | "warn" | "bad" | "idle"; children: ReactNode }) {
  return <span className={`tc-badge ${tone}`}>{children}</span>;
}

function Row({ label, children, tone = "" }: { label: string; children: ReactNode; tone?: string }) {
  return (
    <div className="tc-row">
      <span>{label}</span>
      <b className={tone}>{children}</b>
    </div>
  );
}

/** Frames per second of the camera preview, measured for 2 s on the video itself. */
async function measureCamera(box: HTMLElement | null) {
  const video = box?.querySelector("video");
  if (!video || video.readyState < 2 || !video.srcObject)
    return { ok: false, message: "Câmera desligada ou sem imagem: ligue a câmera." };
  const frames = await new Promise<number>((resolve) => {
    let count = 0;
    const end = performance.now() + 2000;
    const quality = video.getVideoPlaybackQuality?.().totalVideoFrames;
    if (typeof video.requestVideoFrameCallback === "function") {
      const tick = () => {
        count++;
        if (performance.now() < end) video.requestVideoFrameCallback(tick);
        else resolve(count);
      };
      video.requestVideoFrameCallback(tick);
      setTimeout(() => resolve(count), 2600); // a frozen picture stops calling back
    } else
      setTimeout(() => resolve((video.getVideoPlaybackQuality?.().totalVideoFrames ?? 0) - (quality ?? 0)), 2000);
  });
  return { ok: frames > 0, fps: Math.round(frames / 2), width: video.videoWidth, height: video.videoHeight,
           message: frames > 0 ? undefined : "Imagem congelada." };
}

function AcceptanceSummaryBox({ acc }: { acc: AcceptanceSummary }) {
  const current = acc.items.find((i) => i.id === acc.current);
  const auxFailed = acc.failed.filter((id) => !acc.criticalFailed.includes(id));
  if (acc.running)
    return (
      <div className="tc-summary testing" aria-live="polite">
        <strong>{acc.passed}/{acc.total}</strong>
        <span>TESTANDO</span>
        <Loader className="tc-spin" size={34} />
        <em>{current?.label}</em>
      </div>
    );
  if (acc.released)
    return (
      <div className="tc-summary ok">
        <strong>{acc.passed}/{acc.total}</strong>
        <span>TESTES APROVADOS</span>
        <ShieldCheck size={38} />
        <em>UNIDADE APTA</em>
        <small>{auxFailed.length ? "Áudio com falha (auxiliar, não bloqueia)." : "Todos os sistemas funcionais."}</small>
      </div>
    );
  if (acc.criticalFailed.length)
    return (
      <div className="tc-summary bad">
        <strong>{acc.passed}/{acc.total}</strong>
        <span>{acc.failed.length} {acc.failed.length === 1 ? "FALHA" : "FALHAS"}</span>
        <ShieldAlert size={38} />
        <em>UNIDADE BLOQUEADA</em>
        <small>Corrija e refaça o teste do item com falha.</small>
      </div>
    );
  return (
    <div className="tc-summary idle">
      <strong>{acc.passed}/{acc.total}</strong>
      <span>ACEITE PENDENTE</span>
      <ListChecks size={36} />
      <em>{acc.required ? "CARRINHO BLOQUEADO" : "TREINO"}</em>
      <small>
        {acc.triggerText ? `Motivo: ${acc.triggerText}. ` : ""}
        {acc.required ? "Obrigatório antes de liberar." : "Obrigatório ao abrir o evento."}
      </small>
    </div>
  );
}

function AcceptancePanel({ acc, busy, operator, command, slot, onSound, onImage }: {
  acc: AcceptanceSummary;
  busy: boolean;
  operator: boolean;
  command: Command;
  slot: number;
  onSound: () => void;
  onImage: () => void;
}) {
  const locked = !operator || busy;
  const start = (items?: AcceptanceItemId[]) => command("acceptanceStart", items ? { slot, items } : { slot });
  const current = acc.items.find((i) => i.id === acc.current);
  return (
    <Panel title="ACEITAÇÃO TÉCNICA" icon={<ListChecks />} className="tc-acceptance"
      tag={acc.lastRun && <small className="tc-tag">Último aceite: {clock(acc.lastRun.at)} · {acc.lastRun.result === "passed" ? "APTA" : "BLOQUEADA"}</small>}>
      <div className="tc-acceptance-body">
        <table>
          <thead>
            <tr>
              <th>ITEM</th>
              <th>STATUS</th>
              <th>DETALHES</th>
            </tr>
          </thead>
          <tbody>
            {acc.items.map((item) => (
              <tr key={item.id} className={item.status}>
                <td>
                  {item.label}
                  {!item.critical && <small> · auxiliar</small>}
                </td>
                <td>
                  <span className={`tc-status ${item.status}`}>
                    {item.status === "passed" ? <CircleCheck size={15} /> : item.status === "failed" ? <CircleX size={15} /> : item.status === "testing" ? <Loader size={15} className="tc-spin" /> : <i />}
                    {STATUS_TEXT[item.status]}
                  </span>
                </td>
                <td>{item.status === "idle" ? "—" : item.message}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <AcceptanceSummaryBox acc={acc} />
      </div>
      {acc.running && current && <p className="tc-step" aria-live="polite">{current.label}: {current.message}</p>}
      <div className="tc-actions">
        <button onClick={onSound} disabled={locked}><Volume2 size={15} /> TESTAR SOM</button>
        <button onClick={onImage} disabled={locked}><Camera size={15} /> TESTAR IMAGEM</button>
        <button onClick={() => start(["communication"])} disabled={locked || acc.running}><Usb size={15} /> TESTE DE COMUNICAÇÃO</button>
        <button onClick={() => start(["actuators"])} disabled={locked || acc.running}><Zap size={15} /> TESTE SEQUENCIAL</button>
        {acc.running ? (
          <button className="tc-primary" onClick={() => command("acceptanceCancel", { slot })} disabled={!operator}>
            <Square size={14} /> CANCELAR ACEITE
          </button>
        ) : (
          <button className="tc-primary" onClick={() => start()} disabled={locked}>
            <Play size={15} fill="currentColor" /> INICIAR ACEITAÇÃO
          </button>
        )}
      </div>
      {!operator && <p className="tc-note">Aceite e testes só pelo PC Central.</p>}
    </Panel>
  );
}

const RELAY_INFO = [
  { name: "ACELERAR", icon: "▲", moves: true },
  { name: "FREIO / RÉ", icon: "▼", moves: true },
  { name: "DIREITA", icon: "▶", moves: false },
  { name: "ESQUERDA", icon: "◀", moves: false },
];

/** K1-K4, one block each: what it does, the state the board confirmed, the last test, TESTAR. */
function ActuatorPanel({ slot, telemetry, acc, available, operator, onPulse, onSequence, onQuick, onClaim, onEmergency }: {
  slot: FleetSlot;
  telemetry: Telemetry;
  acc: AcceptanceSummary;
  available: boolean;
  operator: boolean;
  onPulse: (relay: number) => void;
  onSequence: () => void;
  onQuick: () => void;
  onClaim: () => void;
  onEmergency: () => void;
}) {
  const mask = telemetry.connected ? telemetry.relayMask : null;
  const quick = telemetry.selfTest;
  const relaysCheck = acc.items.find((i) => i.id === "actuators");
  return (
    <Panel title="TESTE DE ATUADORES" sub="RELÉS" icon={<Zap />} className="tc-relays"
      tag={<small className="tc-tag">{telemetry.port} · {telemetry.connected ? "ONLINE" : "OFFLINE"}</small>}>
      <div className="tc-relay-grid">
        {RELAY_INFO.map((relay, i) => {
          const on = mask !== null && (mask & (1 << i)) !== 0;
          const result = quick.results[i];
          return (
            <div key={relay.name} className={`tc-relay ${on ? "on" : ""} ${result === false ? "fail" : ""}`}>
              <b>K{i + 1} · {relay.name}</b>
              <span className="tc-relay-state">
                <i /> {mask === null ? "SEM RESPOSTA" : on ? "LIGADO" : "DESLIGADO"}
              </span>
              <small>{result === true ? "Último teste: OK" : result === false ? "Último teste: SEM RESPOSTA" : "Ainda não testado"}</small>
              <button aria-label={`Testar relé K${i + 1}`} disabled={!available} onClick={() => onPulse(i + 1)}>
                {relay.icon} TESTAR
              </button>
            </div>
          );
        })}
      </div>
      {telemetry.connected && !telemetry.controlAvailable && (
        <button className="tc-claim" onClick={onClaim}>ASSUMIR CONTROLE NESTA JANELA</button>
      )}
      <div className="tc-actions">
        <button onClick={onSequence} disabled={!operator || acc.running || !available}>
          <Zap size={15} /> TESTE SEQUENCIAL K1→K4 (0,5 s)
        </button>
        <button onClick={onQuick} disabled={!available || quick.running}>
          <Loader size={15} /> AUTOTESTE RÁPIDO
        </button>
        <span className="tc-tag" aria-live="polite">
          {quick.running ? "Autoteste em andamento…" : relaysCheck && relaysCheck.status !== "idle" ? `Aceite: ${relaysCheck.message}` : `${slot.unitId ?? ""} · estado confirmado pela placa`}
        </span>
      </div>
      <button className="tc-emergency inline" onClick={onEmergency}>
        <TriangleAlert size={16} /> PARADA DE EMERGÊNCIA
      </button>
    </Panel>
  );
}

function CommunicationPanel({ slot }: { slot: FleetSlot }) {
  const link = slot.link;
  const confirm = link?.confirmMs ?? null;
  return (
    <Panel title="COMUNICAÇÃO" sub="PLACA ESP32 · USB" icon={<Usb />} className="tc-comm"
      tag={<Badge tone={slot.connected ? "ok" : "bad"}>{slot.connected ? "CONECTADO" : "DESCONECTADO"}</Badge>}>
      <Row label="Porta">{link?.port ?? "—"}</Row>
      <Row label="Firmware / ID">{link?.firmware ? `v${link.firmware}` : "—"} · {link?.boardId ?? "—"}</Row>
      <Row label="Confirmação do comando" tone={level(confirm, 40, 100)}>{ms(confirm)}</Row>
      <Row label="Taxa de confirmação" tone={slot.connected ? (link && link.rateHz >= 4 ? "good" : "warn") : ""}>{link ? `${link.rateHz} Hz` : "—"}</Row>
      <Row label="Confirmações atrasadas" tone={link?.late ? "warn" : "good"}>{link?.late ?? 0}</Row>
      <Row label="Reconexões / reinícios" tone={(link?.reconnects || link?.restarts) ? "warn" : ""}>{link?.reconnects ?? 0} / {link?.restarts ?? 0}</Row>
      <Row label="Última confirmação">{link?.lastAckMs !== null && link?.lastAckMs !== undefined ? `há ${link.lastAckMs} ms` : "—"}</Row>
      <Row label="IP / sinal (RSSI)">não se aplica (USB)</Row>
    </Panel>
  );
}

function AudioPanel({ muted, waiting }: { muted: boolean; waiting: boolean }) {
  return (
    <Panel title="ÁUDIO" icon={<Volume2 />} className="tc-audio"
      tag={<Badge tone={muted ? "warn" : "ok"}>{muted ? "SOM DESLIGADO" : "OK"}</Badge>}>
      <Row label="Saída">Som do PC Central (navegador)</Row>
      <Row label="Som do painel" tone={muted ? "warn" : "good"}>{muted ? "DESLIGADO (alto-falante no topo)" : "LIGADO"}</Row>
      <Row label="Dispositivo">padrão do Windows</Row>
      {waiting && <p className="tc-note">Toque o som de teste e responda se ouviu.</p>}
    </Panel>
  );
}

function VehiclePanel({ slot, telemetry }: { slot: FleetSlot; telemetry: Telemetry }) {
  const mask = slot.relayMask;
  const on = mask === null ? null : [0, 1, 2, 3].filter((i) => mask & (1 << i)).map((i) => `K${i + 1}`);
  const battery = slot.battery;
  return (
    <Panel title="STATUS DO CARRINHO" icon={<Cpu />} className="tc-vehicle" tag={<small className="tc-tag">{slot.unitId}</small>}>
      <div className="tc-two">
        <div>
          <Row label="Bateria (estimada)" tone={battery?.alert === "ok" ? "good" : battery ? "warn" : ""}>
            <Battery size={14} /> {battery?.percent ?? "—"}%
          </Row>
          <div className="tc-bar" aria-hidden="true"><i style={{ width: `${battery?.percent ?? 0}%` }} className={battery?.alert} /></div>
          <Row label="Temperatura"><Thermometer size={14} /> {ND}</Row>
          <Row label="Motor">{telemetry.carEnabled ? "LIBERADO" : "BLOQUEADO"}</Row>
          <Row label="Sinal do rádio"><Signal size={14} /> {ND}</Row>
        </div>
        <div>
          <Row label="Nível de comando">liga / desliga (sem proporcional)</Row>
          <Row label="Relés (K1–K4)" tone={on && on.length ? "warn" : ""}>{on === null ? "sem resposta" : on.length ? `${on.join(", ")} ligado` : "todos desligados"}</Row>
          <Row label="Firmware">{slot.firmware ? `v${slot.firmware}` : "—"}</Row>
          <Row label="Tempo online"><Clock size={14} /> {uptime(slot.link?.uptimeMs)}</Row>
        </div>
      </div>
      <p className="tc-note">Bateria por tempo de uso (30 min por carga). Tensão, temperatura e sinal não são medidos neste carrinho.</p>
    </Panel>
  );
}

function CameraPanel({ box, fps }: { box: React.RefObject<HTMLDivElement | null>; fps: { fps?: number; width?: number; height?: number; ok: boolean } | null }) {
  const [live, setLive] = useState(false);
  useEffect(() => {
    const id = window.setInterval(() => {
      const v = box.current?.querySelector("video");
      setLive(!!v && v.readyState >= 2 && !!v.srcObject);
    }, 1000);
    return () => clearInterval(id);
  }, [box]);
  return (
    <Panel title="CÂMERA" sub="VÍDEO" icon={<Camera />} className="tc-camera"
      tag={<Badge tone={live ? "ok" : "idle"}>{live ? "ONLINE" : "SEM IMAGEM"}</Badge>}>
      <div className="tc-camera-body">
        <div className="tc-preview fleet-camera" ref={box}>
          <CameraFeed label="CÂMERA DA PISTA" />
        </div>
        <div>
          <Row label="Resolução">{fps?.width ? `${fps.width}×${fps.height}` : "—"}</Row>
          <Row label="FPS (medido)" tone={fps?.fps ? (fps.fps >= 24 ? "good" : fps.fps >= 15 ? "warn" : "bad") : ""}>{fps?.fps ?? "—"}</Row>
          <Row label="Codec">{ND}</Row>
          <Row label="Latência">{ND}</Row>
          <Row label="Status">{live ? "TRANSMITINDO" : "SEM IMAGEM"}</Row>
        </div>
      </div>
    </Panel>
  );
}

function LogPanel({ log, full = false }: { log: LogEntry[]; full?: boolean }) {
  return (
    <Panel title="LOG DO SISTEMA" icon={<ListChecks />} className={`tc-log ${full ? "full" : ""}`}>
      {log.length ? (
        <ol>
          {log.map((entry, i) => (
            <li key={`${entry.at}-${i}`} className={entry.severity}>
              <i />
              <time>{clock(entry.at)}</time>
              <span>{entry.source}</span>
              <p>{entry.message}</p>
            </li>
          ))}
        </ol>
      ) : (
        <p className="tc-note">Sem eventos ainda.</p>
      )}
    </Panel>
  );
}

function ConfigPanel({ slot, fleet, telemetry, operator, command, onAutoTest }: {
  slot: FleetSlot;
  fleet: Fleet;
  telemetry: Telemetry;
  operator: boolean;
  command: Command;
  onAutoTest: (enabled: boolean) => void;
}) {
  return (
    <Panel title="CONFIGURAÇÕES" icon={<Cpu />} className="tc-config">
      <Row label="Unidade">{String(slot.number).padStart(2, "0")} · {carInfo(slot.color ?? slot.number).name} (ID técnico {slot.unitId})</Row>
      <Row label="Volante do cockpit">canal {slot.wheel} · {slot.wheelConnected ? "conectado" : "ausente"}</Row>
      <Row label="Zona morta (relés)">direção {slot.deadzone?.steering ?? "—"}% · pedais {slot.deadzone?.pedals ?? "—"}%</Row>
      <Row label="Cockpits da instalação">{fleet.slots.length} (configurados {fleet.available}; volantes XInput até {fleet.capacity})</Row>
      <div className="tc-config-actions">
        <button disabled={!operator} onClick={() => command("pairWheel", { slot: slot.number })}>SINCRONIZAR VOLANTE (A + B 2 s)</button>
        <button disabled={!operator} onClick={() => command("battery", { slot: slot.number, action: "new" })}>ZERAR BATERIA (BATERIA NOVA)</button>
        <label>
          <input type="checkbox" checked={telemetry.selfTest.auto} disabled={!telemetry.connected} onChange={(e) => onAutoTest(e.target.checked)} />
          Autoteste dos relés ao conectar a placa
        </label>
      </div>
      <p className="tc-note">Número de cockpits e TOP N: configuração da instalação (banco ou linha de comando).</p>
    </Panel>
  );
}

/**
 * Central Técnica: commissioning, acceptance, monitoring and maintenance of ONE car,
 * fixed on it (the car is chosen before, in the grid). The server decides every
 * state; this screen shows it and asks for checks.
 */
export function TechnicalCentral({
  slot,
  fleet,
  telemetry,
  operator,
  command,
  calibration,
  raw,
  steering,
  muted,
  onTestSound,
  relays,
}: {
  slot: FleetSlot;
  fleet: Fleet;
  telemetry: Telemetry;
  operator: boolean;
  command: Command;
  calibration: Calibration;
  raw: { steering: number; throttle: number; brake: number };
  steering: number;
  muted: boolean;
  onTestSound: () => void;
  relays: { available: boolean; onTest: (relay: number) => void; onStop: () => void; onClaim: () => void; onSelfTest: () => void; onAutoTest: (enabled: boolean) => void };
}) {
  const [tab, setTab] = useState<Tab>("geral");
  // A manual relay test that can move the car (K1, K2, self-test) waits for ÁREA LIVRE here.
  const [pending, setPending] = useState<null | { label: string; run: () => void }>(null);
  const [heard, setHeard] = useState(false); // the test sound played, waiting for SIM / NÃO
  const [cameraResult, setCameraResult] = useState<Awaited<ReturnType<typeof measureCamera>> | null>(null);
  const box = useRef<HTMLDivElement | null>(null);
  const info = carInfo(slot.color ?? slot.number);
  const acc = slot.acceptance;
  const busy = ["starting", "countdown", "running"].includes(slot.phase) || !!slot.emergency;
  const waiting = acc?.waiting ?? null;
  const number = slot.number;

  const measuring = useRef(false);
  const testImage = useCallback(async (report: boolean) => {
    if (measuring.current) return;
    measuring.current = true;
    const result = await measureCamera(box.current);
    measuring.current = false;
    setCameraResult(result);
    if (report) command("acceptanceReport", { slot: number, item: "camera", ...result });
  }, [command, number]);
  // The camera check is measured here, on the PC Central, as soon as the server asks.
  useEffect(() => {
    if (waiting === "camera") void testImage(true);
  }, [waiting, testImage]);
  // The audio check: play the test sound once and ask.
  const playSound = useRef(onTestSound);
  playSound.current = onTestSound;
  useEffect(() => {
    if (waiting === "audio") {
      playSound.current();
      setHeard(true);
    } else setHeard(false);
  }, [waiting]);

  if (!acc) return <p className="fleet-wait">Aguardando o servidor da frota…</p>;
  const soundButton = () => (waiting === "audio" ? onTestSound() : command("acceptanceStart", { slot: number, items: ["audio"] }));
  const imageButton = () => (waiting === "camera" ? void testImage(true) : acc.running ? void testImage(false) : command("acceptanceStart", { slot: number, items: ["camera"] }));
  const state = slot.state ?? "OFFLINE";
  const verdict = unitVerdict(slot);
  const ok = (good: boolean) => (good ? "OK" : "FALHA");
  const item = (id: AcceptanceItemId) => acc.items.find((i) => i.id === id)!;

  const steeringPanel = (
    <div className="tc-input">
      <SteeringPanel steering={steering} raw={raw.steering} calibration={calibration} />
      <p className="tc-raw">
        BRUTO: <b>{slot.raw ? slot.raw.steering : "—"}</b> · ZONA MORTA: <b>{slot.deadzone?.steering ?? "—"}%</b>
      </p>
    </div>
  );
  const pedalsPanel = (
    <div className="tc-input">
      <PedalsPanel throttle={raw.throttle} brake={raw.brake} calibration={calibration} />
      <p className="tc-raw">
        BRUTO: acel. <b>{slot.raw ? slot.raw.throttle : "—"}</b> · freio <b>{slot.raw ? slot.raw.brake : "—"}</b> · ZONA MORTA: <b>{slot.deadzone?.pedals ?? "—"}%</b>
      </p>
    </div>
  );
  const acceptancePanel = (
    <AcceptancePanel acc={acc} busy={busy} operator={operator} command={command} slot={number} onSound={soundButton} onImage={imageButton} />
  );
  const actuators = (
    <ActuatorPanel
      slot={slot}
      telemetry={telemetry}
      acc={acc}
      available={relays.available && !acc.running}
      operator={operator}
      onPulse={(n) =>
        RELAY_INFO[n - 1].moves
          ? setPending({ label: `Pulso de 0,5 s em K${n} (${RELAY_INFO[n - 1].name.toLowerCase()}).`, run: () => relays.onTest(n) })
          : relays.onTest(n)
      }
      onSequence={() => command("acceptanceStart", { slot: number, items: ["actuators"] })}
      onQuick={() => setPending({ label: "Autoteste rápido: K1, K2, K3 e K4 em pulsos curtos.", run: relays.onSelfTest })}
      onClaim={relays.onClaim}
      onEmergency={() => (operator ? command("emergency", { slot: number }) : relays.onStop())}
    />
  );
  const panels: Record<Tab, ReactNode> = {
    geral: (
      <div className="tc-grid">
        <div className="tc-col">{steeringPanel}<CommunicationPanel slot={slot} /><AudioPanel muted={muted} waiting={waiting === "audio"} /></div>
        <div className="tc-col tc-center">{acceptancePanel}{actuators}<VehiclePanel slot={slot} telemetry={telemetry} /></div>
        <div className="tc-col">{pedalsPanel}<CameraPanel box={box} fps={cameraResult} /></div>
        <LogPanel log={slot.log ?? []} />
      </div>
    ),
    diagnosticos: (
      <div className="tc-grid">
        <div className="tc-col"><CommunicationPanel slot={slot} />{steeringPanel}</div>
        <div className="tc-col tc-center"><VehiclePanel slot={slot} telemetry={telemetry} /><LogPanel log={slot.log ?? []} full /></div>
        <div className="tc-col">{pedalsPanel}</div>
      </div>
    ),
    aceitacao: (
      <div className="tc-grid">
        <div className="tc-col tc-wide">{acceptancePanel}</div>
        <div className="tc-col">{actuators}<CameraPanel box={box} fps={cameraResult} /><AudioPanel muted={muted} waiting={waiting === "audio"} /></div>
      </div>
    ),
    configuracoes: (
      <div className="tc-grid">
        <div className="tc-col tc-wide">
          <ConfigPanel slot={slot} fleet={fleet} telemetry={telemetry} operator={operator} command={command} onAutoTest={relays.onAutoTest} />
        </div>
      </div>
    ),
  };
  return (
    <div className={`technical-central state-${state.toLowerCase()}`}>
      <nav className="tc-tabs" aria-label="Central Técnica">
        {TABS.map(([key, label]) => (
          <button key={key} className={tab === key ? "active" : ""} aria-pressed={tab === key} onClick={() => setTab(key)}>
            {label}
          </button>
        ))}
        <span className={`tc-state ${state.toLowerCase()}`} aria-label="Estado da unidade">
          <i /> {STATE_TEXT[state]}
        </span>
      </nav>
      <p className={`tc-verdict ${verdict.tone}`} role="status">
        {verdict.tone === "bad" ? <ShieldAlert size={17} /> : verdict.tone === "ok" ? <ShieldCheck size={17} /> : <Play size={15} />}
        <b>{verdict.title}</b>
        <span>{verdict.detail}</span>
      </p>
      {panels[tab]}
      <div className="tc-bottom" role="contentinfo">
        <div className="tc-unit">
          <small>UNIDADE</small>
          <strong>
            <b style={{ background: info.color }} aria-hidden="true" />
            {String(number).padStart(2, "0")} · {info.name}
          </strong>
        </div>
        <p className="tc-summary-line">
          PLACA {ok(slot.connected)} · VOLANTE {ok(slot.wheelConnected)} · VÍDEO{" "}
          {item("camera").status === "passed" ? "OK" : item("camera").status === "failed" ? "FALHA" : "—"} · ÁUDIO{" "}
          {item("audio").status === "passed" ? "OK" : item("audio").status === "failed" ? "FALHA" : "—"} · ACEITE{" "}
          {acc.released ? "APTO" : acc.running ? "EM ANDAMENTO" : "PENDENTE"}
        </p>
        <button className="tc-reset" disabled={!operator || !slot.emergency} onClick={() => command("emergencyReset", { slot: number })}
          title="Libera a unidade depois da parada de emergência (o aceite precisa ser refeito)">
          <RotateCcw size={16} /> RESET
        </button>
        <button className="tc-emergency" onClick={() => (operator ? command("emergency", { slot: number }) : relays.onStop())}>
          <TriangleAlert size={18} /> PARADA DE EMERGÊNCIA <kbd>ESC</kbd>
        </button>
      </div>
      {pending && (
        <div className="modal-backdrop">
          <section className="tc-dialog" role="dialog" aria-modal="true" aria-labelledby="tc-pulse-title">
            <TriangleAlert size={30} />
            <h2 id="tc-pulse-title">CONFIRMAR ÁREA LIVRE</h2>
            <p>{pending.label} O carrinho poderá se mover.</p>
            <div>
              <button onClick={() => setPending(null)}>CANCELAR</button>
              <button className="tc-primary" autoFocus onClick={() => { pending.run(); setPending(null); }}>
                ÁREA LIVRE · CONTINUAR
              </button>
            </div>
          </section>
        </div>
      )}
      {waiting === "area" && (
        <div className="modal-backdrop">
          <section className="tc-dialog" role="dialog" aria-modal="true" aria-labelledby="tc-area-title">
            <TriangleAlert size={30} />
            <h2 id="tc-area-title">CONFIRMAR ÁREA LIVRE</h2>
            <p>O carrinho poderá se mover durante o teste. Deixe-o suspenso ou com a pista livre.</p>
            <div>
              <button onClick={() => command("acceptanceCancel", { slot: number })}>CANCELAR</button>
              <button className="tc-primary" autoFocus disabled={!operator} onClick={() => command("acceptanceArea", { slot: number })}>
                ÁREA LIVRE · CONTINUAR
              </button>
            </div>
          </section>
        </div>
      )}
      {heard && waiting === "audio" && (
        <div className="modal-backdrop">
          <section className="tc-dialog" role="dialog" aria-modal="true" aria-labelledby="tc-audio-title">
            <Volume2 size={30} />
            <h2 id="tc-audio-title">VOCÊ OUVIU O SOM?</h2>
            <p>{muted ? "O som do painel está desligado (alto-falante no topo)." : "Um som curto de teste foi tocado."}</p>
            <div>
              <button onClick={onTestSound}>TOCAR DE NOVO</button>
              <button onClick={() => command("acceptanceReport", { slot: number, item: "audio", ok: false })}>NÃO</button>
              <button className="tc-primary" onClick={() => command("acceptanceReport", { slot: number, item: "audio", ok: true })}>SIM</button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
