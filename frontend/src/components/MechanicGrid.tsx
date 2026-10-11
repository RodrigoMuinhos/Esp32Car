import { memo, useEffect, useState, type CSSProperties, type MouseEvent } from "react";
import { Ban, BatteryFull, BatteryLow, BatteryMedium, BatteryWarning, Grid2x2, Grid3x3, LayoutGrid, Play, Power, RefreshCw, ScanSearch, ShieldCheck, Square, Usb, Wrench } from "lucide-react";
import type { Fleet, FleetSlot } from "../types/telemetry";
import { formatTime } from "../hooks/useRaceTimer";
import { carInfo } from "../slots";
import { SteeringWheelIcon } from "./SteeringWheelIcon";
import { SlotPlaceholder, SlotSetup } from "./SlotSetup";
import { EventRecord, EventTop } from "./EventRecord";
import { RaceOperations } from "./RaceControlView";
import { STATE_TEXT } from "./TechnicalCentral";
import { unitVerdict, type Tone } from "../unitVerdict";

type Command = (type: string, data?: Record<string, unknown>) => void;
/** Mechanic layouts: one car in detail (incident analysis) or a grid of 4, 8 or 16. */
export type MechLayout = 1 | 4 | 8 | 16;
export const MECH_LAYOUTS: MechLayout[] = [1, 4, 8, 16];

const RELAYS = ["ACEL", "FREIO", "DIR", "ESQ"];
/** How long a card flags its new personal best / record lap. */
const LAP_FLAG_MS = 10000;
const clock = (ms: number) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
};

/** Side tab: switch between the individual view and the grids. */
export function MechanicRail({ layout, onLayout }: { layout: MechLayout; onLayout: (layout: MechLayout) => void }) {
  const icons = { 1: Square, 4: Grid2x2, 8: LayoutGrid, 16: Grid3x3 } as const;
  return (
    <nav className="mech-rail" aria-label="Layout da Visão Mecânico">
      {MECH_LAYOUTS.map((value) => {
        const Icon = icons[value];
        return (
          <button
            key={value}
            className={layout === value ? "active" : ""}
            aria-pressed={layout === value}
            title={value === 1 ? "Individual: análise de intercorrência" : `Grade com ${value}`}
            onClick={() => onLayout(value)}
          >
            <Icon size={18} />
            <b>{value === 1 ? "1" : value}</b>
            <small>{value === 1 ? "INDIVIDUAL" : "GRADE"}</small>
          </button>
        );
      })}
    </nav>
  );
}

const BATTERY_ALERTS = {
  ok: { text: "BATERIA OK", Icon: BatteryFull },
  low: { text: "BATERIA BAIXA · TROQUE EM BREVE", Icon: BatteryMedium },
  critical: { text: "TROQUE A BATERIA AGORA", Icon: BatteryLow },
  stop: { text: "BATERIA VAZIA · TROQUE", Icon: BatteryWarning },
} as const;

/** Charge left: 20% warns, 10% insists, 5% must not run. Click it to zero (full charge). */
function BatteryBlock({ slot, operator, command }: { slot: FleetSlot; operator: boolean; command: Command }) {
  const [menu, setMenu] = useState(false);
  const battery = slot.battery;
  if (!battery) return null;
  const left = Math.max(0, battery.capacityMs - battery.usedMs);
  const percent = battery.percent ?? Math.round((100 * left) / battery.capacityMs);
  const alert = battery.alert ?? "ok";
  const { text, Icon } = BATTERY_ALERTS[alert];
  return (
    <div className={`mech-battery ${alert} ${battery.on ? "on" : ""}`}>
      <button
        className="mech-battery-read"
        aria-expanded={menu}
        aria-label={`Bateria ${percent}%: ${text}. Clique para zerar.`}
        onClick={() => setMenu((open) => !open)}
      >
        <Icon size={18} />
        <strong>{percent}%</strong>
        <small>{clock(left)}</small>
        <span className="mech-battery-alert">{text}</span>
      </button>
      <div className="mech-battery-bar" aria-hidden="true">
        <i style={{ width: `${percent}%` }} />
      </div>
      {menu && (
        <div className="mech-battery-menu">
          <button
            className="zero"
            disabled={!operator}
            onClick={() => {
              command("battery", { slot: slot.number, action: "new" });
              setMenu(false);
            }}
          >
            <RefreshCw size={12} /> ZERAR · BATERIA 100%
          </button>
          <button onClick={() => setMenu(false)}>CANCELAR</button>
        </div>
      )}
      <button
        className={`mech-battery-power ${battery.on ? "active" : ""}`}
        aria-pressed={battery.on}
        disabled={!operator}
        onClick={() => command("battery", { slot: slot.number, action: battery.on ? "off" : "on" })}
      >
        <Power size={12} /> {battery.on ? "LIGADO · CONTANDO" : "DESLIGADO"}
      </button>
    </div>
  );
}

/** Click a car: sync its wheel (hold A + B together for 2 s on that wheel). */
function SyncBar({ slot, pairing, operator, command }: { slot: FleetSlot; pairing: boolean; operator: boolean; command: Command }) {
  return (
    <div className={`mech-sync ${pairing ? "waiting" : ""}`} role="status">
      {pairing ? (
        <>
          <SteeringWheelIcon size={20} />
          <span>
            Segure <b>A + B</b> juntos por 2 s no volante deste cockpit…
          </span>
          <button onClick={() => command("pairWheel", { slot: 0 })}>CANCELAR</button>
        </>
      ) : (
        <button className="sync" disabled={!operator} onClick={() => command("pairWheel", { slot: slot.number })}>
          <SteeringWheelIcon size={14} /> SINCRONIZAR CONTROLE
        </button>
      )}
    </div>
  );
}

/** One check of the car: name, the value that matters, and its tone. */
function Check({ label, value, note, tone }: { label: string; value: string; note: string; tone: Tone }) {
  return (
    <div className={`mech-check ${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{note}</small>
    </div>
  );
}

function MechCard({
  slot,
  operator,
  command,
  onOpen,
  selected,
  onSelect,
  pairing,
}: {
  slot: FleetSlot;
  operator: boolean;
  command: Command;
  onOpen: (number: number) => void;
  selected: boolean;
  onSelect: (number: number) => void;
  pairing: boolean;
}) {
  const info = carInfo(slot.color ?? slot.number);
  const racing = slot.phase === "running" || slot.phase === "countdown";
  const test = slot.selfTest;
  const acc = slot.acceptance;
  const link = slot.link;
  const answer = unitVerdict(slot);
  const state = slot.state ?? (slot.connected ? "READY" : "OFFLINE");
  // A click on the card itself (not on one of its buttons) selects it.
  const select = (e: MouseEvent) => {
    if (!(e.target as HTMLElement).closest("button, input")) onSelect(slot.number);
  };
  const confirm = link?.confirmMs ?? null;
  // The selected car is the one the INDIVIDUAL tab opens; it also offers the wheel sync.
  return (
    <section
      className={`mech-card ${slot.connected ? "" : "offline"} ${selected || pairing ? "selected" : ""} battery-${slot.battery?.alert ?? "ok"}`}
      style={{ "--slot-color": info.color } as CSSProperties}
      aria-label={`Carrinho ${String(slot.number).padStart(2, "0")} ${info.name}`}
      aria-current={selected ? "true" : undefined}
      onClick={select}
    >
      <header>
        <b>{String(slot.number).padStart(2, "0")}</b>
        <strong>{info.name}</strong>
        <em className={`mech-state ${racing ? "racing" : state.toLowerCase()}`}>
          {racing ? (slot.phase === "running" ? "CORRENDO" : "LARGANDO") : STATE_TEXT[state]}
        </em>
      </header>
      <p className={`mech-verdict ${answer.tone}`} role="status">
        {answer.tone === "bad" ? <Ban size={15} /> : answer.tone === "ok" ? <ShieldCheck size={15} /> : <Play size={14} />}
        <b>{answer.title}</b>
        <span>{answer.detail}</span>
        <em>{answer.short}</em>
      </p>
      {/* Approved acceptance = the wheel was synced and checked: no sync offer (re-sync is in the Central Técnica). */}
      {((selected && !acc?.released) || pairing) && <SyncBar slot={slot} pairing={pairing} operator={operator} command={command} />}
      <div className="mech-checks">
        <Check
          label="PLACA"
          value={slot.connected ? (confirm !== null ? `${confirm} ms` : "OK") : "—"}
          note={slot.connected ? `${slot.port} · v${slot.firmware}${link?.late ? ` · ${link.late} atraso` : ""}` : "desconectada"}
          tone={!slot.connected ? "bad" : confirm !== null && confirm > 100 ? "warn" : "ok"}
        />
        <Check
          label="VOLANTE"
          value={slot.wheelConnected ? `CANAL ${slot.wheel}` : "AUSENTE"}
          note={slot.wheelConnected ? "sincronizado" : "conecte ou sincronize"}
          tone={slot.wheelConnected ? "ok" : "bad"}
        />
        <Check
          label="ACEITE"
          value={acc ? `${acc.passed}/${acc.total}` : "—"}
          note={!acc ? "—" : acc.released ? "APTO" : acc.running ? "EM TESTE" : acc.criticalFailed.length ? "COM FALHA" : "PENDENTE"}
          tone={!acc ? "idle" : acc.released ? "ok" : acc.running ? "warn" : acc.criticalFailed.length ? "bad" : acc.required ? "bad" : "idle"}
        />
      </div>
      {slot.lastLap && slot.lastLap.ageMs < LAP_FLAG_MS && (slot.lastLap.record || slot.lastLap.personalBest) && (
        <p className={`mech-lap-flag ${slot.lastLap.record ? "record" : "personal"}`}>
          ★ {slot.lastLap.record ? "NOVO RECORDE DO EVENTO" : "MELHOR VOLTA PESSOAL"} · VOLTA {slot.lastLap.number} ·{" "}
          {formatTime(slot.lastLap.lapMs)}
        </p>
      )}
      {slot.session && (
        <p className={`mech-session ${slot.session.inTop ? "top" : ""}`}>
          SESSÃO #{slot.session.code ?? "—"} · POSIÇÃO PROVISÓRIA <b>#{slot.session.position}</b>
          {slot.session.inTop ? " · NO TOP" : " · FORA DO CORTE"}
        </p>
      )}
      <BatteryBlock slot={slot} operator={operator} command={command} />
      {racing ? (
        <div className="mech-times">
          <div>
            <span>VOLTA</span>
            <strong>{slot.times.laps + 1}</strong>
          </div>
          <div>
            <span>TEMPO</span>
            <strong>{slot.times.elapsedMs !== null ? formatTime(slot.times.elapsedMs) : "—"}</strong>
          </div>
          <div>
            <span>MELHOR</span>
            <strong>{slot.times.bestLapMs !== null ? formatTime(slot.times.bestLapMs) : "—"}</strong>
          </div>
        </div>
      ) : (
        slot.lastResult && (
          <p className="mech-last">
            ÚLTIMA CORRIDA · {slot.lastResult.laps} {slot.lastResult.laps === 1 ? "volta" : "voltas"} ·{" "}
            {formatTime(slot.lastResult.durationMs)}
            {slot.lastResult.bestLapMs !== null && <> · melhor <b>{formatTime(slot.lastResult.bestLapMs)}</b></>}
          </p>
        )
      )}
      <div className="mech-relays" aria-label={`Relés da vaga ${slot.number}`} title="Relés confirmados pela placa">
        <span className="mech-relays-label">RELÉS</span>
        {RELAYS.map((relay, i) => {
          const on = slot.relayMask !== null && slot.relayMask & (1 << i);
          const result = test?.results[i];
          return (
            <span key={relay} className={`${on ? "on" : ""} ${result === false ? "fail" : ""}`}>
              K{i + 1}
              <small>
                {relay}
                {result === false ? " ✗" : ""}
              </small>
            </span>
          );
        })}
      </div>
      <footer>
        <button disabled={!operator || !slot.connected || racing} onClick={() => command("selftest", { slot: slot.number })}>
          <Wrench size={12} /> AUTOTESTE
        </button>
        <button className="open" onClick={() => onOpen(slot.number)} title="Abre a Central Técnica deste carrinho">
          <ScanSearch size={12} /> ANALISAR
        </button>
        <button className="danger" onClick={() => command("stop", { slot: slot.number })}>
          <Square size={11} fill="currentColor" /> PARAR
        </button>
      </footer>
    </section>
  );
}

/**
 * Visão Mecânico as a grid: one controller panel per car, in its color.
 * Slots are added one at a time (+ ADICIONAR CONTROLE on the next free one).
 */
export function MechanicGrid({
  fleet,
  layout,
  operator,
  command,
  onOpen,
  selected,
  onSelect,
}: {
  fleet: Fleet | null;
  layout: Exclude<MechLayout, 1>;
  operator: boolean;
  command: Command;
  onOpen: (number: number) => void;
  selected: number;
  onSelect: (number: number) => void;
}) {
  if (!fleet) return <p className="fleet-wait">Conectando ao servidor da corrida…</p>;
  // Configured slots work normally; only the next free one offers + ADICIONAR
  // CONTROLE (one at a time); the later ones are discreet placeholders.
  const cells = Array.from({ length: layout }, (_, i) => i + 1);
  const next = fleet.available + 1;
  return (
    <div className={`mech-grid grid-${layout}`}>
      {cells.map((number) => {
        const slot = fleet.slots.find((s) => s.number === number);
        if (slot && number <= fleet.available)
          return (
            <MechCard
              key={number}
              slot={slot}
              operator={operator}
              command={command}
              onOpen={onOpen}
              selected={selected === slot.number}
              onSelect={onSelect}
              pairing={fleet.pairing === slot.number}
            />
          );
        if (number === next && number <= fleet.capacity)
          return <SlotSetup key={number} number={number} fleet={fleet} operator={operator} command={command} />;
        return <SlotPlaceholder key={number} number={number} />;
      })}
    </div>
  );
}

type GridProps = {
  layout: Exclude<MechLayout, 1>;
  onOpen: (number: number) => void;
  selected: number;
  onSelect: (number: number) => void;
};
const LIVE_REFRESH_MS = 250;

/**
 * The grid isolated from the rest of the panel (which redraws every frame):
 * it reads the latest fleet a few times per second, so 16 panels stay light.
 * Callbacks must be stable (the panel passes them through refs).
 */
export const LiveMechanicGrid = memo(function LiveMechanicGrid({
  source,
  operator,
  command,
  ...props
}: GridProps & { source: { current: Fleet | null }; operator: boolean; command: Command }) {
  const [fleet, setFleet] = useState(source.current);
  useEffect(() => {
    const id = window.setInterval(() => setFleet(source.current), LIVE_REFRESH_MS);
    return () => window.clearInterval(id);
  }, [source]);
  return (
    <div className="mech-live">
      {fleet && <RaceOperations fleet={fleet} operator={operator} command={command} />}
      {fleet && <EventRecord fleet={fleet} operator={operator} command={command} />}
      {fleet?.event && fleet.ranking.rows.length > 0 && <EventTop ranking={fleet.ranking} open />}
      <MechanicGrid fleet={fleet} operator={operator} command={command} {...props} />
    </div>
  );
});
