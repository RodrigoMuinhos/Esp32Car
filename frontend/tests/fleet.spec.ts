import { test, expect } from "@playwright/test";
import { battery as simBattery, fleet as simFleet, serve, slotTelemetry as simTelemetry } from "./helpers";

const slot = (number: number, name: string, extra: Record<string, unknown> = {}) => ({
  number, name, driver: `Piloto 0${number}`, boardId: `ID${number}`, port: `COM${number + 2}`, firmware: 6,
  connected: true, wheel: number, wheelConnected: true, phase: "idle", countdown: null, enabled: false,
  mask: 0, relayMask: 0, input: { steering: 0, throttle: 0, brake: 0 }, lapCount: 0, raceMode: 0,
  selfTest: { running: false, results: [true, true, true, true], interrupted: false },
  status: "Aperte A para largar.", lastResult: null,
  times: { elapsedMs: null, laps: 0, bestLapMs: null, lastLapMs: null, lastMarkMs: null }, ...extra,
});

test("visão mecânico: grade de 4 por padrão, bateria, grade de 8 e análise individual", async ({ page }) => {
  const sent: { type: string; data: Record<string, unknown> }[] = [];
  const battery = (on: boolean, minutes: number) => ({ ...simBattery(minutes, on) });
  const fleet = {
    slots: [
      slot(1, "AZUL ELÉTRICO", { battery: battery(true, 10) }),
      slot(2, "LARANJA", { battery: battery(false, 0) }),
      slot(3, "VERMELHO", { battery: battery(true, 27) }),
      slot(4, "ROXO", { battery: battery(true, 31), blocked: true, blockReason: "battery" }),
    ],
    spareBoards: [], classification: [], pairing: null, autoTest: true, events: [],
  };
  await page.routeWebSocket(/\/ws\/telemetry(\?|$)/, (ws) => {
    const vaga = Number(new URL(ws.url()).searchParams.get("vaga")) || 1;
    const send = () => ws.send(JSON.stringify({ type: "telemetry", data: {
      connected: true, controlAvailable: true, usbConnected: true, phase: "idle",
      slot: { number: vaga, name: fleet.slots[vaga - 1].name }, fleet } }));
    const interval = setInterval(send, 50);
    ws.onClose(() => clearInterval(interval));
    ws.onMessage((m) => sent.push(JSON.parse(String(m))));
    send();
  });
  await page.goto("/?view=mecanico");
  await page.getByRole("button", { name: "CARRINHO REAL" }).click();
  const cards = page.locator(".mech-card");
  await expect(cards).toHaveCount(4);
  await expect(page.getByRole("button", { name: /4\s*GRADE/ })).toHaveAttribute("aria-pressed", "true");
  await expect(cards.nth(0)).toContainText("67%");
  await expect(cards.nth(0)).toContainText("20:00");
  await expect(cards.nth(0)).toContainText("BATERIA OK");
  await expect(cards.nth(2)).toContainText("TROQUE A BATERIA AGORA"); // 10%
  await expect(cards.nth(3)).toContainText("NÃO PODE RODAR"); // empty
  await cards.nth(1).getByRole("button", { name: "DESLIGADO" }).click();
  await expect.poll(() => sent.some((m) => m.type === "battery" && m.data.slot === 2 && m.data.action === "on")).toBe(true);
  await cards.nth(0).locator(".mech-battery-read").click(); // click the battery: zero it
  await cards.nth(0).getByRole("button", { name: "ZERAR · BATERIA 100%" }).click();
  await expect.poll(() => sent.some((m) => m.type === "battery" && m.data.slot === 1 && m.data.action === "new")).toBe(true);
  // Car 1 starts selected (this screen's slot); a click selects another one.
  await expect(cards.nth(0)).toHaveAttribute("aria-current", "true");
  // Click the car: it stays selected and offers the wheel sync (A + B for 2 s).
  await expect(cards.nth(3).getByRole("button", { name: "SINCRONIZAR CONTROLE" })).toHaveCount(0);
  await cards.nth(3).locator("header").click();
  await expect(cards.nth(3)).toHaveAttribute("aria-current", "true");
  await expect(cards.nth(0)).not.toHaveAttribute("aria-current", "true");
  await expect(page).toHaveURL(/vaga=4/);
  await cards.nth(3).getByRole("button", { name: "SINCRONIZAR CONTROLE" }).click();
  await expect.poll(() => sent.some((m) => m.type === "pairWheel" && m.data.slot === 4)).toBe(true);
  (fleet as { pairing: number | null }).pairing = 4;
  await expect(cards.nth(3)).toContainText("Segure A + B juntos por 2 s");
  (fleet as { pairing: number | null }).pairing = null;
  await page.getByRole("button", { name: /8\s*GRADE/ }).click();
  await expect(cards).toHaveCount(8);
  await expect(page.locator(".mech-card.free")).toHaveCount(4);
  await expect(page.locator(".mech-card.free").first()).toContainText("VAGA 05 — NÃO CONFIGURADA");
  // One slot configured: the next one offers + ADICIONAR CONTROLE, the others are placeholders.
  (fleet as { available?: number }).available = 1;
  await expect(page.locator(".mech-card.add")).toHaveCount(1);
  await expect(page.locator(".mech-card.add")).toContainText("ADICIONAR CONTROLE");
  await expect(page.locator(".mech-card.free")).toHaveCount(6);
  (fleet as { available?: number }).available = 4;
  await expect(page.locator(".mech-card.free")).toHaveCount(4);
  await cards.nth(2).locator("header").click(); // pick car 3 in the grid
  await page.getByRole("button", { name: /1\s*INDIVIDUAL/ }).click(); // and open it
  await expect(page).toHaveURL(/vaga=3/);
  await expect(page).toHaveURL(/grade=1/);
  // The Central Técnica of the chosen car only, fixed on it (no car tabs or selector).
  await expect(page.locator(".session-bar")).toContainText("CENTRAL TÉCNICA");
  await expect(page.locator(".session-bar")).toContainText("03 VERMELHO");
  await expect(page.locator(".car-tabs")).toHaveCount(0);
});

test("adicionar controle: só a próxima vaga, cor, alinhar, confirmar, comunicação e pula para a seguinte", async ({ page }) => {
  const sent: { type: string; data: Record<string, unknown> }[] = [];
  const fleet: Record<string, unknown> & { slots: Record<string, unknown>[] } = {
    slots: [
      slot(1, "AZUL ELÉTRICO", { color: 1 }),
      slot(2, "LARANJA", { color: 2 }),
      slot(3, "VERMELHO", { color: 3 }),
      slot(4, "ROXO", { color: 4 }),
    ],
    spareBoards: [], classification: [], pairing: null, autoTest: true, events: [],
    available: 1, capacity: 4, setup: null,
  };
  await page.routeWebSocket(/\/ws\/telemetry(\?|$)/, (ws) => {
    const send = () => ws.send(JSON.stringify({ type: "telemetry", data: {
      connected: true, controlAvailable: true, usbConnected: true, phase: "idle",
      slot: { number: 1, name: "AZUL ELÉTRICO", color: 1 }, fleet } }));
    const interval = setInterval(send, 50);
    ws.onClose(() => clearInterval(interval));
    ws.onMessage((m) => sent.push(JSON.parse(String(m))));
    send();
  });
  await page.goto("/?view=mecanico");
  await page.getByRole("button", { name: "CARRINHO REAL" }).click();
  const add = page.locator(".mech-card.add");
  await expect(add).toHaveCount(1);
  await expect(add).toHaveAttribute("aria-label", /Vaga 02/);
  await expect(page.locator(".mech-card.free")).toHaveCount(2); // 03 and 04: placeholders only
  await expect(page.locator(".mech-card.free").first()).not.toContainText("K1");
  await add.getByRole("button", { name: /ADICIONAR CONTROLE/ }).click();
  const colors = add.getByRole("radiogroup", { name: "Cor do carrinho" });
  await expect(colors.getByRole("radio")).toHaveCount(16);
  await expect(colors.getByRole("radio", { name: /AZUL ELÉTRICO/ })).toBeDisabled(); // in use by 01
  await colors.getByRole("radio", { name: "VERDE" }).click();
  await add.getByRole("button", { name: "CONTINUAR" }).click();
  await expect.poll(() => sent.some((m) => m.type === "setupStart" && m.data.color === 5)).toBe(true);
  // The server runs the wizard: sync...
  fleet.setup = { slot: 2, color: 5, step: "sync", seen: { left: false, right: false, throttle: false, brake: false }, input: null, board: true, pairing: true };
  await expect(add).toContainText("VERDE");
  await expect(add).toContainText("Segure A + B juntos por 2 s");
  // ...confirm wheel and pedals...
  fleet.setup = { slot: 2, color: 5, step: "confirm", seen: { left: true, right: false, throttle: true, brake: false }, input: { steering: 40, throttle: 0, brake: 0 }, board: true, pairing: false };
  await expect(add.locator(".setup-checks li.ok")).toHaveCount(2);
  await expect(add).toContainText("DIR 40");
  // ...and done: slot 2 works, the button moves to slot 3.
  fleet.setup = null;
  fleet.available = 2;
  fleet.slots[1] = slot(2, "VERDE", { color: 5 });
  await expect(page.locator(".mech-card:not(.add):not(.free)")).toHaveCount(2);
  await expect(page.locator(".mech-card").nth(1)).toContainText("02VERDE");
  await expect(page.locator(".mech-card.add")).toHaveAttribute("aria-label", /Vaga 03/);
  await page.locator(".mech-card.add").getByRole("button", { name: /ADICIONAR CONTROLE/ }).click();
  await page.locator(".mech-card.add").getByRole("button", { name: "CANCELAR" }).click();
  await expect(page.locator(".mech-card.add").getByRole("button", { name: /ADICIONAR CONTROLE/ })).toBeVisible();
});

test("race control: recorde do evento sempre visível, NOVO MELHOR TEMPO uma vez, sem dirigir pelo painel", async ({ page }) => {
  const fleet: Record<string, unknown> & { slots: Record<string, unknown>[]; alerts: Record<string, unknown>[] } = {
    slots: [slot(1, "AZUL ELÉTRICO", { color: 1 }), slot(2, "LARANJA"), slot(3, "VERMELHO"), slot(4, "ROXO")],
    spareBoards: [], classification: [], pairing: null, autoTest: true, events: [], available: 1, capacity: 4, setup: null,
    event: { id: 1, name: "Fortaleza", openedAt: "2026-10-10T13:00:00-03:00" },
    ranking: { topN: 8, total: 1, cutMs: null, rows: [] },
    record: { lapMs: 34120, at: "2026-10-10T14:02:00-03:00", slot: 1, color: 1, raceId: 3 },
    alerts: [{ id: 1, kind: "record", slot: 1, color: 1, lapMs: 34120, at: "2026-10-10T14:02:00-03:00" }],
  };
  await page.routeWebSocket(/\/ws\/telemetry(\?|$)/, (ws) => {
    const send = () => ws.send(JSON.stringify({ type: "telemetry", data: {
      connected: true, controlAvailable: true, usbConnected: true, phase: "idle",
      slot: { number: 1, name: "AZUL ELÉTRICO", color: 1 }, fleet } }));
    const interval = setInterval(send, 50);
    ws.onClose(() => clearInterval(interval));
    send();
  });
  await page.goto("/?view=mecanico");
  await page.getByRole("button", { name: "CARRINHO REAL" }).click();
  const bar = page.getByRole("region", { name: "Melhor volta do evento" });
  await expect(bar).toContainText("00:34.120");
  await expect(bar).toContainText("CARRINHO 01 AZUL ELÉTRICO");
  await page.waitForTimeout(400);
  await expect(page.locator(".record-alert")).toHaveCount(0); // the old record is not news
  // A new record lap closes on car 01.
  fleet.record = { lapMs: 32814, at: "2026-10-10T14:42:00-03:00", slot: 1, color: 1, raceId: 4 };
  fleet.alerts = [{ id: 2, kind: "record", slot: 1, color: 1, lapMs: 32814, at: "2026-10-10T14:42:00-03:00" }, ...fleet.alerts];
  fleet.slots[0].lastLap = { number: 3, lapMs: 32814, personalBest: true, record: true, ageMs: 100 };
  const alert = page.getByRole("alert").filter({ hasText: "NOVO MELHOR TEMPO" });
  await expect(alert).toContainText("00:32.814");
  await expect(alert).toContainText("NOVO RECORDE DO EVENTO");
  await expect(bar).toContainText("00:32.814");
  await expect(page.locator(".mech-lap-flag.record")).toContainText("VOLTA 3");
  await expect(alert).toBeHidden({ timeout: 9000 }); // back to normal; the record bar stays
  await expect(bar).toContainText("00:32.814");
  // The operator does not drive: the Central Técnica has no input source (keyboard/sliders) at all.
  await page.getByRole("button", { name: /1\s*INDIVIDUAL/ }).click();
  await expect(page.locator(".session-bar")).toContainText("CENTRAL TÉCNICA");
  await expect(page.getByRole("combobox", { name: "Fonte dos comandos" })).toHaveCount(0);
  await expect(page.locator(".test-sliders")).toHaveCount(0);
});

test("evento: abrir, TOP 8 provisório com corte, posição no cartão, avisos e encerrar", async ({ page }) => {
  const sent: { type: string; data: Record<string, unknown> }[] = [];
  const row = (position: number, code: string, slotN: number, ms: number, inTop: boolean) => ({
    position, raceId: position, code, slot: slotN, color: slotN, bestLapMs: ms, date: "2026-10-10T14:00:00-03:00", inTop });
  const fleet: Record<string, unknown> & { slots: Record<string, unknown>[]; alerts: Record<string, unknown>[] } = {
    slots: [slot(1, "AZUL ELÉTRICO", { color: 1 }), slot(2, "LARANJA", { color: 2 }), slot(3, "VERMELHO"), slot(4, "ROXO")],
    spareBoards: [], classification: [], pairing: null, autoTest: true, events: [], available: 2, capacity: 4, setup: null,
    event: null, record: null, ranking: { topN: 8, total: 0, cutMs: null, rows: [] }, alerts: [],
  };
  await page.routeWebSocket(/\/ws\/telemetry(\?|$)/, (ws) => {
    const send = () => ws.send(JSON.stringify({ type: "telemetry", data: {
      connected: true, controlAvailable: true, usbConnected: true, phase: "idle",
      slot: { number: 1, name: "AZUL ELÉTRICO", color: 1 }, fleet } }));
    const interval = setInterval(send, 50);
    ws.onClose(() => clearInterval(interval));
    ws.onMessage((m) => sent.push(JSON.parse(String(m))));
    send();
  });
  await page.route(/\/health$/, (r) => r.fulfill({ json: { lanUrls: [] } }));
  await page.goto("/?view=mecanico");
  await page.getByRole("button", { name: "CARRINHO REAL" }).click();
  const bar = page.getByRole("region", { name: "Evento", exact: true });
  await expect(bar).toContainText("SEM EVENTO ABERTO");
  await expect(bar).toContainText("Treino");
  await bar.getByRole("button", { name: /ABRIR EVENTO/ }).click();
  await bar.getByLabel("Nome do evento").fill("Fortaleza · Shopping Iguatemi");
  await bar.getByRole("button", { name: "ABRIR" }).click();
  await expect.poll(() => sent.some((m) => m.type === "eventOpen" && m.data.name === "Fortaleza · Shopping Iguatemi")).toBe(true);
  // The event is open; 9 sessions: the 9th is below the cut.
  const rows = [31842, 32104, 32380, 32814, 33041, 33228, 33490, 33722, 33900].map((ms, i) => row(i + 1, `CODE0${i + 1}`, (i % 2) + 1, ms, i < 8));
  Object.assign(fleet, {
    event: { id: 1, name: "Fortaleza · Shopping Iguatemi", openedAt: "2026-10-10T13:00:00-03:00" },
    record: { lapMs: 31842, at: "2026-10-10T14:00:00-03:00", slot: 1, color: 1, raceId: 1, code: "CODE01" },
    ranking: { topN: 8, total: 12, cutMs: 33722, rows },
  });
  fleet.slots[1].session = { code: "CODE04", position: 4, bestLapMs: 32814, inTop: true, total: 12 };
  const recordBar = page.getByRole("region", { name: "Melhor volta do evento" });
  await expect(recordBar).toContainText("FORTALEZA · SHOPPING IGUATEMI");
  await expect(recordBar).toContainText("TEMPO DE CORTE (TOP 8)");
  await expect(recordBar).toContainText("00:33.722");
  await expect(recordBar).toContainText("12 participantes");
  const top = page.getByRole("region", { name: "Top 8 provisório" });
  await expect(top.locator("li")).toHaveCount(9);
  await expect(top.locator("li.below")).toHaveCount(1); // 9th: below the cut, still listed
  await expect(top).toContainText("CORTE · 00:33.722");
  await expect(top).toContainText("+3 no ranking completo");
  // TOP 8 alerts are quiet toasts (no record here).
  fleet.alerts = [
    { id: 11, kind: "cut", slot: 0, color: 0, at: "", lapMs: 33722, topN: 8 },
    { id: 10, kind: "out", slot: 0, color: 0, at: "", slotOut: 2, colorOut: 2, code: "CODE09", position: 9, topN: 8 },
    { id: 9, kind: "top", slot: 2, color: 2, at: "", position: 4, code: "CODE04", lapMs: 32814, topN: 8 },
  ];
  const toasts = page.locator(".event-toast");
  await expect(toasts).toHaveCount(3);
  await expect(page.locator(".event-toast.top")).toContainText("ENTROU NO TOP 8");
  await expect(page.locator(".event-toast.top")).toContainText("POSIÇÃO #4");
  await expect(page.locator(".event-toast.out")).toContainText("SAIU DO TOP 8");
  await expect(page.locator(".event-toast.cut")).toContainText("NOVO TEMPO DE CORTE");
  await expect(page.locator(".record-alert")).toHaveCount(0);
  // The car panel in the grid shows its provisional position.
  await expect(page.locator(".mech-session").first()).toContainText("POSIÇÃO PROVISÓRIA #4");
  // Close the event: two steps.
  await recordBar.getByRole("button", { name: /ENCERRAR EVENTO/ }).click();
  await recordBar.getByRole("button", { name: "CONFIRMAR ENCERRAMENTO" }).click();
  await expect.poll(() => sent.some((m) => m.type === "eventClose")).toBe(true);
});

test("SIMULAÇÃO: as mesmas telas do real, na arena simulada do servidor (grades cheias, aceite, bateria)", async ({ page }) => {
  const sim = simFleet(16, {}, (n) => ({ port: `SIM${n}`, battery: simBattery(n === 11 ? 29 : n === 9 ? 25 : n === 10 ? 27.5 : 4),
    ...(n === 11 ? { blocked: true, blockReason: "battery", state: "WARNING" } : {}) }));
  const real = simFleet(4);
  const { sent, sockets } = await serve(page, (arena, vaga) => simTelemetry(arena === "sim" ? sim : real, vaga));
  await page.goto("/?view=mecanico");
  // Real arena: only what is plugged in; nothing simulated.
  await expect(page.locator(".mech-card:not(.free)")).toHaveCount(4);
  await expect(page.locator(".arena-badge")).toHaveCount(0);
  await expect(page.locator("main")).not.toContainText("SIM1");
  await page.getByRole("button", { name: "SIMULAÇÃO", exact: true }).click();
  await expect(page).toHaveURL(/mode=simulation/);
  await expect(page.locator(".arena-badge")).toContainText("NADA MOVE CARRINHO REAL");
  expect(sockets).toContain("sim");
  const cards = page.locator(".mech-card:not(.free)");
  await expect(cards).toHaveCount(4);
  await expect(cards.first().locator(".mech-check").first()).toContainText("SIM1");
  await page.getByRole("button", { name: /16\s*GRADE/ }).click();
  await expect(cards).toHaveCount(16);
  await expect(page.locator(".mech-card.free")).toHaveCount(0);
  await expect(page.locator(".mech-battery.low").first()).toBeVisible();
  await expect(page.locator(".mech-battery.critical").first()).toBeVisible();
  // The empty battery: the card says why it cannot run; ZERAR goes to the simulation arena.
  const empty = page.locator(".mech-card:has(.mech-battery.stop)").first();
  await expect(empty.locator(".mech-verdict.bad")).toContainText("NÃO PODE RODAR");
  await empty.locator(".mech-battery-read").click();
  await empty.getByRole("button", { name: "ZERAR · BATERIA 100%" }).click();
  await expect.poll(() => sent.some((m) => m.arena === "sim" && m.type === "battery" && m.data.slot === 11 && m.data.action === "new")).toBe(true);
  // The same Central Técnica as the real cars.
  await cards.nth(6).locator("header").click();
  await page.getByRole("button", { name: /1\s*INDIVIDUAL/ }).click();
  await expect(page).toHaveURL(/vaga=7/);
  await expect(page.locator(".session-bar")).toContainText("CENTRAL TÉCNICA");
  await expect(page.getByRole("region", { name: "ACEITAÇÃO TÉCNICA" })).toBeVisible();
  await page.getByRole("button", { name: /INICIAR ACEITAÇÃO/ }).click();
  await expect.poll(() => sent.some((m) => m.arena === "sim" && m.type === "acceptanceStart" && m.data.slot === 7)).toBe(true);
  expect(sent.some((m) => m.arena === "real" && m.type === "acceptanceStart")).toBe(false);
});

test("operação na visão mecânico: carrinho novo, largar todos, parear volante; a visão corrida é só o telão", async ({ page }) => {
  const sent: { type: string; data: Record<string, unknown> }[] = [];
  const fleet = {
    slots: [
      slot(1, "AZUL ELÉTRICO"),
      slot(2, "LARANJA", { connected: false, port: null, status: "Carrinho LARANJA desconectado" }),
      slot(3, "VERMELHO"),
      slot(4, "ROXO", { wheelConnected: false }),
    ],
    spareBoards: [{ port: "COM9", boardId: "RESERVA", firmware: 6, connected: true,
                    selfTest: { running: false, results: [true, true, true, true], interrupted: false } }],
    classification: [], pairing: null as number | null, autoTest: true, events: ["Vaga 02 LARANJA: carrinho desconectado."],
  };
  await page.routeWebSocket(/\/ws\/telemetry(\?|$)/, (ws) => {
    const send = () => ws.send(JSON.stringify({ type: "telemetry", data: {
      connected: true, controlAvailable: true, usbConnected: true, phase: "idle",
      slot: { number: 1, name: "AZUL ELÉTRICO" }, fleet } }));
    const interval = setInterval(send, 50);
    ws.onClose(() => clearInterval(interval));
    ws.onMessage((m) => sent.push(JSON.parse(String(m))));
    send();
  });
  await page.goto("/?view=mecanico");
  const cards = page.locator(".mech-card");
  await expect(cards).toHaveCount(4);
  await expect(cards.nth(1).locator(".mech-verdict")).toContainText("CARRINHO DESCONECTADO");
  await expect(cards.nth(3).locator(".mech-verdict")).toContainText("VOLANTE AUSENTE");
  await expect(page.locator(".fleet-ready")).toContainText("2/4 PRONTOS");
  // Spare board: put it in the orange slot.
  const spare = page.getByRole("region", { name: "Carrinhos novos" });
  await expect(spare).toContainText("RESERVA · COM9");
  await expect(spare).toContainText("teste OK");
  await spare.getByRole("button", { name: "LARANJA" }).click();
  await expect.poll(() => sent.some((m) => m.type === "assign" && m.data.port === "COM9" && m.data.slot === 2)).toBe(true);
  await page.getByRole("button", { name: /LARGAR TODOS/ }).click();
  await expect.poll(() => sent.some((m) => m.type === "startAll")).toBe(true);
  await cards.nth(3).locator("header").click();
  await cards.nth(3).getByRole("button", { name: "SINCRONIZAR CONTROLE" }).click();
  await expect.poll(() => sent.some((m) => m.type === "pairWheel" && m.data.slot === 4)).toBe(true);
  fleet.pairing = 4;
  await expect(cards.nth(3)).toContainText("Segure A + B juntos por 2 s no volante deste cockpit");
  await cards.nth(0).getByRole("button", { name: "PARAR", exact: true }).click();
  await expect.poll(() => sent.some((m) => m.type === "stop" && m.data.slot === 1)).toBe(true);
  // Visão Corrida: only the big screen (no operation there), with a discreet way back.
  await page.getByRole("button", { name: "VISÃO CORRIDA" }).click();
  await expect(page.locator(".telao-broadcast")).toBeVisible();
  await expect(page.locator(".telao-broadcast .fleet-bar, .telao-broadcast .mech-card")).toHaveCount(0);
  await page.getByRole("button", { name: "Sair da visão corrida" }).click();
  await expect(page.getByRole("button", { name: "VISÃO MECÂNICO" })).toHaveAttribute("aria-pressed", "true");
});
