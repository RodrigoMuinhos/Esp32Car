import { formatTime } from "./hooks/useRaceTimer";
import type { FleetSlot } from "./types/telemetry";

export type Tone = "ok" | "warn" | "bad" | "run" | "idle";
export type Verdict = { tone: Tone; title: string; short: string; detail: string };

/**
 * The first answer the operator needs, in the same words on the grid card and in
 * the Central Técnica: can this car run now, and if not, why. The server decides
 * (state, blockReason); this only puts it into words and points at the check to fix.
 */
export function unitVerdict(slot: FleetSlot): Verdict {
  const acc = slot.acceptance;
  const battery = slot.battery;
  if (slot.phase === "running")
    return { tone: "run", title: "CORRENDO", short: `VOLTA ${slot.times.laps + 1}`, detail: `Volta ${slot.times.laps + 1} · ${formatTime(slot.times.elapsedMs ?? 0)}` };
  if (slot.phase === "countdown" || slot.phase === "starting")
    return { tone: "run", title: "LARGANDO", short: "3-2-1", detail: slot.countdown !== null ? `GO em ${Math.ceil(slot.countdown)} s` : "Acelerador segurado" };
  if (slot.emergency)
    return { tone: "bad", title: "PARADA DE EMERGÊNCIA", short: "RESET", detail: "Central Técnica → RESET e novo aceite." };
  if (!slot.connected)
    return { tone: "bad", title: slot.boardId ? "CARRINHO DESCONECTADO" : "SEM CARRINHO", short: "SEM PLACA", detail: "Confira o cabo USB da placa." };
  if (slot.blockReason === "battery")
    return { tone: "bad", title: "NÃO PODE RODAR", short: `BATERIA ${battery?.percent ?? 0}%`, detail: `Bateria ${battery?.percent ?? 0}%: troque e clique em ZERAR.` };
  if (slot.blockReason === "acceptance_running")
    return { tone: "warn", title: "ACEITE EM ANDAMENTO", short: "EM TESTE", detail: acc?.items.find((i) => i.id === acc.current)?.label ?? "Testando…" };
  if (slot.blockReason === "acceptance") {
    const failed = acc?.items.filter((i) => acc.criticalFailed.includes(i.id)).map((i) => i.label.toLowerCase()) ?? [];
    return failed.length
      ? { tone: "bad", title: "NÃO PODE RODAR", short: "ACEITE COM FALHA", detail: `Aceite com falha: ${failed.join(", ")}.` }
      : { tone: "bad", title: "NÃO PODE RODAR", short: "ACEITE PENDENTE", detail: "Aceite técnico pendente: INICIAR ACEITAÇÃO na Central Técnica." };
  }
  if (slot.blocked) return { tone: "bad", title: "NÃO PODE RODAR", short: "BLOQUEADO", detail: slot.status };
  if (!slot.wheelConnected)
    return { tone: "bad", title: "VOLANTE AUSENTE", short: "SEM VOLANTE", detail: `Conecte o volante ${slot.wheel} ou sincronize outro.` };
  if (["selftest", "pulse", "test"].includes(slot.phase)) return { tone: "warn", title: "EM TESTE", short: "TESTE", detail: slot.status };
  if (acc?.criticalFailed.length)
    return { tone: "warn", title: "LIBERADO · TREINO", short: "ACEITE COM FALHA", detail: "Aceite com falha: corrija antes de abrir o evento." };
  return {
    tone: "ok",
    title: "LIBERADO PARA CORRER",
    short: acc?.released ? "ACEITE OK" : "TREINO",
    detail: acc?.released ? "Aceite aprovado." : "Treino: o aceite será exigido ao abrir o evento.",
  };
}
