import { useEffect, useRef, useState, type CSSProperties } from "react";
import { CalendarCheck, CalendarX, Flag, Star, Trophy } from "lucide-react";
import type { EventRanking, Fleet, FleetAlert } from "../types/telemetry";
import { formatTime } from "../hooks/useRaceTimer";
import { carInfo, carLabel } from "../slots";

type Command = (type: string, data?: Record<string, unknown>) => void;
const ALERT_MS = 6000;
const clockOf = (iso: string) => {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
};
const colorStyle = (slot: number, color?: number) => ({ "--slot-color": carInfo(color || slot).color }) as CSSProperties;

/**
 * The event bar of the operator screens: open/close the event, its record
 * (★ 00:32.814 · 07 CIANO · #A28391 · 14:42) and the cut time of the TOP N.
 * Outside an event it is practice: laps do not count for records or ranking.
 */
export function EventRecord({ fleet, operator, command }: { fleet: Fleet; operator: boolean; command: Command }) {
  const [step, setStep] = useState<"idle" | "naming" | "closing">("idle");
  const [name, setName] = useState("");
  const { event, record, ranking } = fleet;
  if (!event)
    return (
      <section className="event-record practice" aria-label="Evento">
        <span className="event-record-label">
          <CalendarX size={15} /> SEM EVENTO ABERTO
        </span>
        <span className="event-record-empty">Treino: voltas não contam para recorde nem ranking.</span>
        {step === "naming" ? (
          <form
            className="event-form"
            onSubmit={(e) => {
              e.preventDefault();
              if (!name.trim()) return;
              command("eventOpen", { name: name.trim() });
              setStep("idle");
              setName("");
            }}
          >
            <input
              aria-label="Nome do evento"
              placeholder="Ex.: Fortaleza · Shopping Iguatemi"
              value={name}
              maxLength={60}
              autoFocus
              onChange={(e) => setName(e.target.value)}
            />
            <button type="submit" className="event-go" disabled={!name.trim()}>
              ABRIR
            </button>
            <button type="button" onClick={() => setStep("idle")}>
              CANCELAR
            </button>
          </form>
        ) : (
          <button className="event-go" disabled={!operator} onClick={() => setStep("naming")}>
            <CalendarCheck size={14} /> ABRIR EVENTO
          </button>
        )}
      </section>
    );
  return (
    <section className="event-record" aria-label="Melhor volta do evento">
      <span className="event-record-label">
        <Trophy size={15} /> {event.name.toUpperCase()}
      </span>
      {record ? (
        <>
          <strong title="Melhor volta do evento">
            <Star size={16} fill="currentColor" /> {formatTime(record.lapMs)}
          </strong>
          <span className="event-record-car" style={colorStyle(record.slot, record.color)}>
            <i /> CARRINHO {carLabel(record.slot, record.color)}
            {record.code ? ` · #${record.code}` : ""}
          </span>
          <span className="event-record-time">{clockOf(record.at)}</span>
        </>
      ) : (
        <span className="event-record-empty">Nenhuma volta neste evento ainda.</span>
      )}
      <span className="event-cut" title={`Tempo do ${ranking.topN}º colocado`}>
        TEMPO DE CORTE (TOP {ranking.topN}) <b>{ranking.cutMs !== null ? formatTime(ranking.cutMs) : "—"}</b>
        <small>{ranking.total} {ranking.total === 1 ? "participante" : "participantes"}</small>
      </span>
      {step === "closing" ? (
        <span className="event-form">
          <button
            className="event-close"
            onClick={() => {
              command("eventClose");
              setStep("idle");
            }}
          >
            CONFIRMAR ENCERRAMENTO
          </button>
          <button onClick={() => setStep("idle")}>CANCELAR</button>
        </span>
      ) : (
        <button className="event-end" disabled={!operator} onClick={() => setStep("closing")}>
          <CalendarX size={14} /> ENCERRAR EVENTO
        </button>
      )}
    </section>
  );
}

/** TOP N PROVISÓRIO: the first sessions, the cut line, and who is just below it. */
export function EventTop({ ranking, open }: { ranking: EventRanking; open: boolean }) {
  return (
    <section className="event-top" aria-label={`Top ${ranking.topN} provisório`}>
      <h3>
        <Flag size={14} /> TOP {ranking.topN} PROVISÓRIO
      </h3>
      {!open ? (
        <p className="event-top-empty">Abra um evento para começar o ranking.</p>
      ) : !ranking.rows.length ? (
        <p className="event-top-empty">Nenhuma volta neste evento ainda.</p>
      ) : (
        <ol>
          {ranking.rows.map((row) => (
            <li key={row.raceId} className={row.inTop ? "" : "below"} style={colorStyle(row.slot, row.color)}>
              {row.position === ranking.topN + 1 && (
                <span className="event-cut-line">
                  CORTE · {ranking.cutMs !== null ? formatTime(ranking.cutMs) : "—"}
                </span>
              )}
              <b>{row.position}</b>
              <span className="event-top-code">#{row.code ?? "—"}</span>
              <span className="event-top-car">
                <i /> {carLabel(row.slot, row.color)}
              </span>
              <em>{formatTime(row.bestLapMs)}</em>
            </li>
          ))}
        </ol>
      )}
      {open && ranking.total > ranking.rows.length && (
        <p className="event-top-more">+{ranking.total - ranking.rows.length} no ranking completo (🏆)</p>
      )}
    </section>
  );
}

function toastText(alert: FleetAlert) {
  const top = `TOP ${alert.topN ?? 8}`;
  if (alert.kind === "top")
    return {
      title: `ENTROU NO ${top}`,
      line: `POSIÇÃO #${alert.position} · CARRINHO ${carLabel(alert.slot, alert.color)}${alert.code ? ` · #${alert.code}` : ""}`,
      time: alert.lapMs,
    };
  if (alert.kind === "out")
    return {
      title: `SAIU DO ${top}`,
      line: `${alert.code ? `#${alert.code} · ` : ""}CARRINHO ${carLabel(alert.slotOut, alert.colorOut)} · AGORA #${alert.position}`,
      time: undefined,
    };
  return { title: "NOVO TEMPO DE CORTE", line: top, time: alert.lapMs };
}

/**
 * Operator alerts, each shown once (by id): the event record big, with the
 * fanfare; entering/leaving the TOP N and the new cut time as quiet toasts.
 * Old alerts are not replayed when the panel opens.
 */
export function RecordAlert({ alerts, onSound }: { alerts: FleetAlert[]; onSound: () => void }) {
  const seen = useRef<number | null>(null);
  const [record, setRecord] = useState<FleetAlert | null>(null);
  const [toasts, setToasts] = useState<FleetAlert[]>([]);
  const latest = alerts[0]?.id ?? 0;
  useEffect(() => {
    if (seen.current === null) {
      seen.current = latest; // panel just opened: these alerts are not news
      return;
    }
    const fresh = alerts.filter((a) => a.id > (seen.current ?? 0));
    if (!fresh.length) return;
    seen.current = latest;
    const newRecord = fresh.find((a) => a.kind === "record");
    if (newRecord) {
      setRecord(newRecord);
      onSound();
    }
    const quiet = fresh.filter((a) => a.kind !== "record");
    if (quiet.length) setToasts((old) => [...quiet, ...old].slice(0, 4));
  }, [latest]);
  useEffect(() => {
    if (!record) return;
    const id = window.setTimeout(() => setRecord(null), ALERT_MS);
    return () => window.clearTimeout(id);
  }, [record]);
  useEffect(() => {
    if (!toasts.length) return;
    const id = window.setTimeout(() => setToasts((old) => old.slice(0, -1)), ALERT_MS);
    return () => window.clearTimeout(id);
  }, [toasts]);
  return (
    <>
      {record && (
        <div className="record-alert" role="alert" style={colorStyle(record.slot, record.color)}>
          <span>NOVO MELHOR TEMPO</span>
          <strong>
            <Star size={26} fill="currentColor" /> {formatTime(record.lapMs ?? 0)}
          </strong>
          <span>NOVO RECORDE DO EVENTO</span>
          <small>
            <i /> CARRINHO {carLabel(record.slot, record.color)}
          </small>
        </div>
      )}
      {toasts.length > 0 && (
        <div className="event-toasts" role="status">
          {toasts.map((toast) => {
            const text = toastText(toast);
            return (
              <div key={toast.id} className={`event-toast ${toast.kind}`}>
                <strong>{text.title}</strong>
                <span>{text.line}</span>
                {text.time !== undefined && <b>{formatTime(text.time)}</b>}
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
