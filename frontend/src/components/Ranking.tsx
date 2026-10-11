import { useEffect, useState } from "react";
import { Flag, Trophy, X } from "lucide-react";
import type { RaceResult, Ranking } from "../types/telemetry";
import { fetchRanking } from "../services/rankingApi";
import { formatTime } from "../hooks/useRaceTimer";
import { carLabel } from "../slots";

type Tab = "event" | "trial" | "laps" | "most" | "recent";

const dateFormat = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});
const shortDate = (iso: string) => {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : dateFormat.format(date);
};
/** Short label for why a race ended. */
export function reasonLabel(reason: string) {
  if (/botão B/i.test(reason)) return "Botão B";
  if (/emergência/i.test(reason)) return "Emergência (X)";
  if (/concluída/i.test(reason)) return "Completou ✔";
  if (/inatividade/i.test(reason)) return "Inatividade";
  if (/painel/i.test(reason)) return "PARAR";
  if (/ESP32/i.test(reason)) return "Placa desconectada";
  if (/volante/i.test(reason)) return "Volante desconectado";
  return reason || "—";
}
const medal = (position: number) =>
  position === 1 ? "🥇" : position === 2 ? "🥈" : position === 3 ? "🥉" : `${position}º`;

export function RankingModal({
  result,
  onClose,
}: {
  /** Race that just ended, highlighted at the top; null when opened from the header. */
  result: RaceResult | null;
  onClose: () => void;
}) {
  const [ranking, setRanking] = useState<Ranking | null>(null);
  const [error, setError] = useState(false);
  const [tab, setTab] = useState<Tab>(
    result?.completed ? "trial" : result?.laps ? "laps" : "event",
  );
  const [trialLaps, setTrialLaps] = useState(result?.targetLaps === 5 ? 5 : 3);
  useEffect(() => {
    let alive = true;
    // The result arrives a moment after the race is saved: load it when it changes.
    fetchRanking()
      .then((data) => alive && (setRanking(data), setError(false)))
      .catch(() => alive && setError(true));
    return () => {
      alive = false;
    };
  }, [result?.raceId]);
  const highlight = result?.raceId;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <section
        className="help-modal ranking-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="ranking-title"
        onClick={(e) => e.stopPropagation()}
      >
        <button className="icon-button close-modal" aria-label="Fechar ranking" onClick={onClose}>
          <X />
        </button>
        <span className="eyebrow">HISTÓRICO DE CORRIDAS</span>
        <h2 id="ranking-title">
          <Trophy size={22} /> Ranking
        </h2>

        {result && (
          <div className="race-result" aria-live="polite">
            <Flag size={18} />
            <div>
              <strong>
                {result.completed
                  ? `CONTRA O RELÓGIO · ${result.targetLaps} VOLTAS · CARRINHO ${carLabel(result.slot, result.color)}`
                  : `CORRIDA FINALIZADA · CARRINHO ${carLabel(result.slot, result.color)}`}
              </strong>
              {result.completed && result.trialPosition !== null && (
                <span>
                  <b>{medal(result.trialPosition)}</b> no ranking de {result.targetLaps} voltas
                </span>
              )}
              <span>
                Tempo <b>{formatTime(result.durationMs)}</b>
                {result.bestLapMs !== null ? (
                  <>
                    {" "}· Melhor volta <b>{formatTime(result.bestLapMs)}</b>
                    {result.position !== null && (
                      <> · <b>{medal(result.position)}</b> no ranking</>
                    )}
                  </>
                ) : (
                  <> · sem voltas marcadas (use a bandeira para marcar cada volta)</>
                )}
              </span>
            </div>
          </div>
        )}

        <div className="ranking-tabs" role="tablist">
          {(
            [
              ["event", "Evento"],
              ["trial", "Contra o relógio"],
              ["laps", "Melhores voltas"],
              ["most", "Mais voltas"],
              ["recent", "Histórico"],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              role="tab"
              aria-selected={tab === key}
              className={tab === key ? "active" : ""}
              onClick={() => setTab(key)}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="ranking-table" role="tabpanel">
          {error ? (
            <p className="ranking-empty">
              O ranking fica salvo no app do carrinho. Abra o RC Racing (modo carrinho real) para ver.
            </p>
          ) : !ranking ? (
            <p className="ranking-empty">Carregando…</p>
          ) : tab === "event" ? (
            ranking.event ? (
              <>
                <p className="event-summary">
                  <b>{ranking.event.name}</b> · TOP {ranking.event.topN} PROVISÓRIO · tempo de corte{" "}
                  <b>{ranking.event.cutMs !== null ? formatTime(ranking.event.cutMs) : "—"}</b> ·{" "}
                  {ranking.event.total} {ranking.event.total === 1 ? "participante" : "participantes"}
                </p>
                {ranking.event.rows.length ? (
                  <table>
                    <thead>
                      <tr><th>#</th><th>Sessão</th><th>Carrinho</th><th>Melhor volta</th><th>Data</th></tr>
                    </thead>
                    <tbody>
                      {ranking.event.rows.map((row) => (
                        <tr
                          key={row.raceId}
                          className={`${row.raceId === highlight ? "mine" : ""} ${row.inTop ? "" : "below-cut"} ${
                            row.position === ranking.event!.topN ? "cut-row" : ""
                          }`}
                        >
                          <td>{row.position}</td>
                          <td>#{row.code ?? "—"}</td>
                          <td>{carLabel(row.slot, row.color)}</td>
                          <td className="time">{formatTime(row.bestLapMs)}</td>
                          <td>{shortDate(row.date)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <p className="ranking-empty">Nenhuma volta neste evento ainda.</p>
                )}
              </>
            ) : (
              <p className="ranking-empty">Nenhum evento aberto. Abra um evento na Visão Mecânico ou na Visão Corrida.</p>
            )
          ) : tab === "trial" ? (
            <>
              <div className="trial-switch" role="group" aria-label="Voltas do contra o relógio">
                {[3, 5].map((n) => (
                  <button key={n} className={trialLaps === n ? "active" : ""} onClick={() => setTrialLaps(n)}>
                    {n} voltas
                  </button>
                ))}
              </div>
              {ranking.timeTrials?.[String(trialLaps)]?.length ? (
                <table>
                  <thead>
                    <tr><th>#</th><th>Carrinho</th><th>Tempo total</th><th>Melhor volta</th><th>Data</th></tr>
                  </thead>
                  <tbody>
                    {ranking.timeTrials[String(trialLaps)].map((row, i) => (
                      <tr key={row.raceId} className={row.raceId === highlight ? "mine" : ""}>
                        <td>{medal(i + 1)}</td>
                        <td>{carLabel(row.slot, row.color)}</td>
                        <td className="time">{formatTime(row.durationMs)}</td>
                        <td className="time">{row.bestLapMs === null ? "—" : formatTime(row.bestLapMs)}</td>
                        <td>{shortDate(row.date)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <p className="ranking-empty">
                  Nenhuma corrida de {trialLaps} voltas completa ainda. Escolha "{trialLaps} VOLTAS" na
                  Cronometragem e marque cada volta com Y (ou a bandeira).
                </p>
              )}
            </>
          ) : tab === "laps" ? (
            ranking.bestLaps.length ? (
              <table>
                <thead>
                  <tr><th>#</th><th>Carrinho</th><th>Volta</th><th>Data</th></tr>
                </thead>
                <tbody>
                  {ranking.bestLaps.map((row, i) => (
                    <tr key={`${row.raceId}-${i}`} className={row.raceId === highlight ? "mine" : ""}>
                      <td>{medal(i + 1)}</td>
                      <td>{carLabel(row.slot, row.color)}</td>
                      <td className="time">{formatTime(row.lapMs)}</td>
                      <td>{shortDate(row.date)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="ranking-empty">Nenhuma volta marcada ainda. Durante a corrida, toque na bandeira a cada volta.</p>
            )
          ) : tab === "most" ? (
            ranking.mostLaps.length ? (
              <table>
                <thead>
                  <tr><th>#</th><th>Carrinho</th><th>Voltas</th><th>Tempo</th><th>Data</th></tr>
                </thead>
                <tbody>
                  {ranking.mostLaps.map((row, i) => (
                    <tr key={row.raceId} className={row.raceId === highlight ? "mine" : ""}>
                      <td>{medal(i + 1)}</td>
                      <td>{carLabel(row.slot, row.color)}</td>
                      <td>{row.laps}</td>
                      <td className="time">{formatTime(row.durationMs)}</td>
                      <td>{shortDate(row.date)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="ranking-empty">Nenhuma corrida com voltas marcadas ainda.</p>
            )
          ) : ranking.recent.length ? (
            <table>
              <thead>
                <tr><th>Data</th><th>Carrinho</th><th>Tempo</th><th>Voltas</th><th>Melhor</th><th>Fim</th></tr>
              </thead>
              <tbody>
                {ranking.recent.map((row) => (
                  <tr key={row.id} className={row.id === highlight ? "mine" : ""}>
                    <td>{shortDate(row.date)}</td>
                    <td>{carLabel(row.slot, row.color)}</td>
                    <td className="time">{formatTime(row.durationMs)}</td>
                    <td>{row.laps}</td>
                    <td className="time">{row.bestLapMs === null ? "—" : formatTime(row.bestLapMs)}</td>
                    <td>{reasonLabel(row.reason)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="ranking-empty">Nenhuma corrida ainda. Aperte A no volante para largar.</p>
          )}
        </div>
        {ranking && (
          <p className="ranking-totals">
            {ranking.totalRaces} corrida{ranking.totalRaces === 1 ? "" : "s"} · {formatTime(ranking.totalMs)} de pista
          </p>
        )}
      </section>
    </div>
  );
}
