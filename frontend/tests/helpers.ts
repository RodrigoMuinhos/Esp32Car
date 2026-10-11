import type { Page } from "@playwright/test";

/** Shapes the server sends (backend/fleet.py summary), for mocked WebSockets. */
export type Msg = { type: string; data: Record<string, unknown> };
export const NAMES = ["AZUL ELÉTRICO", "LARANJA", "VERMELHO", "ROXO", "VERDE", "AMARELO OURO", "CIANO", "ROSA",
  "AZUL MARINHO", "LIMA", "CORAL", "VIOLETA", "TURQUESA", "ÂMBAR", "MAGENTA", "ÍNDIGO"];
const ITEMS = [
  ["communication", "Comunicação com a placa", true],
  ["steering", "Volante", true],
  ["pedals", "Pedais", true],
  ["actuators", "Relés / atuadores", true],
  ["emergency", "Parada de emergência", true],
  ["camera", "Câmera", true],
  ["audio", "Áudio", false],
] as const;

export function acceptance(passed: boolean, extra: Record<string, unknown> = {}) {
  const items = ITEMS.map(([id, label, critical]) => ({
    id, label, critical, status: passed ? "passed" : "idle", message: passed ? "ok" : "Aguardando.", startedAt: null, finishedAt: null,
  }));
  return { items, running: false, current: null, waiting: null, released: passed, required: false, trigger: null,
    triggerText: null, lastRun: null, passed: passed ? 7 : 0, total: 7, failed: [], criticalFailed: [], ...extra };
}

export function battery(minutes: number, on = true) {
  const percent = Math.round((100 * (30 - minutes)) / 30);
  const alert = percent <= 5 ? "stop" : percent <= 10 ? "critical" : percent <= 20 ? "low" : "ok";
  return { on, usedMs: minutes * 60000, capacityMs: 1800000, percent: Math.max(0, percent), alert };
}

export function slot(number: number, extra: Record<string, unknown> = {}) {
  const port = extra.port ?? `COM${number + 2}`;
  return {
    number, name: NAMES[number - 1], color: number, driver: "", boardId: `ID${number}`, port, firmware: 6,
    connected: true, wheel: number, wheelConnected: true, phase: "idle", countdown: null, enabled: false,
    mask: 0, relayMask: 0, input: { steering: 0, throttle: 0, brake: 0 }, lapCount: 0, raceMode: 0,
    selfTest: { running: false, results: [true, true, true, true], interrupted: false },
    status: "Aperte A (ou segure o acelerador 0,5 s) para largar.", lastResult: null,
    times: { elapsedMs: null, laps: 0, bestLapMs: null, lastLapMs: null, lastMarkMs: null },
    battery: battery(5), blocked: false, blockReason: null, state: "READY", emergency: false,
    unitId: `RC-${String(number).padStart(2, "0")}`, acceptance: acceptance(false),
    link: { port, firmware: 6, boardId: `ID${number}`, confirmMs: 12, rateHz: 7, late: 0, restarts: 0, reconnects: 0, lastAckMs: 30, uptimeMs: 60000 },
    raw: null, deadzone: { steering: 15, pedals: 12 }, log: [], ...extra,
  };
}

export function fleet(count: number, extra: Record<string, unknown> = {}, slotExtra: (n: number) => Record<string, unknown> = () => ({})) {
  return {
    slots: Array.from({ length: count }, (_, i) => slot(i + 1, slotExtra(i + 1))),
    spareBoards: [], classification: [], pairing: null, autoTest: true, events: [], available: count, capacity: count,
    setup: null, event: null, record: null, ranking: { topN: 8, total: 0, cutMs: null, rows: [] }, alerts: [], ...extra,
  };
}

/**
 * Mocks the server: `telemetry(arena, vaga)` is sent every 50 ms on each socket
 * (arena "sim" when the panel asks for simulacao=1); messages are recorded with it.
 */
export async function serve(page: Page, telemetry: (arena: "real" | "sim", vaga: number) => Record<string, unknown>) {
  const sent: (Msg & { arena: string })[] = [];
  const sockets: string[] = [];
  await page.routeWebSocket(/\/ws\/telemetry(\?|$)/, (ws) => {
    const url = new URL(ws.url());
    const arena = url.searchParams.get("simulacao") === "1" ? "sim" : "real";
    const vaga = Number(url.searchParams.get("vaga")) || 1;
    sockets.push(arena);
    const send = () => ws.send(JSON.stringify({ type: "telemetry", data: telemetry(arena, vaga) }));
    const interval = setInterval(send, 50);
    ws.onClose(() => clearInterval(interval));
    ws.onMessage((m) => sent.push({ ...JSON.parse(String(m)), arena }));
    send();
  });
  await page.route(/\/health(\?|$)/, (r) => r.fulfill({ json: { lanUrls: [] } }));
  return { sent, sockets };
}

/** Per-slot telemetry around a fleet, the way the server sends it to ?vaga=N. */
export function slotTelemetry(f: ReturnType<typeof fleet>, vaga: number, extra: Record<string, unknown> = {}) {
  const s = f.slots[vaga - 1] ?? f.slots[0];
  return {
    connected: s.connected, controlAvailable: true, usbConnected: s.wheelConnected, phase: s.phase, port: s.port,
    relayMask: s.relayMask, carEnabled: s.phase === "running", status: s.status, countdown: s.countdown,
    selfTest: { ...s.selfTest, auto: true }, slot: { number: s.number, name: s.name, color: s.color },
    times: s.times, fleet: f, ...extra,
  };
}
