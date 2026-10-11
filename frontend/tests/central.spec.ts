import { test, expect } from "@playwright/test";

const ITEMS = [
  ["communication", "Comunicação com a placa", true],
  ["steering", "Volante", true],
  ["pedals", "Pedais", true],
  ["actuators", "Relés / atuadores", true],
  ["emergency", "Parada de emergência", true],
  ["camera", "Câmera", true],
  ["audio", "Áudio", false],
] as const;
type Status = "idle" | "testing" | "passed" | "failed";

function acceptance(statuses: Partial<Record<string, [Status, string]>>, extra: Record<string, unknown> = {}) {
  const items = ITEMS.map(([id, label, critical]) => {
    const [status, message] = statuses[id] ?? ["idle", "Aguardando."];
    return { id, label, critical, status, message, startedAt: null, finishedAt: null };
  });
  const failed = items.filter((i) => i.status === "failed").map((i) => i.id);
  return {
    items, running: false, current: null, waiting: null, required: true, trigger: "EVENT_START", triggerText: "evento aberto",
    lastRun: null, passed: items.filter((i) => i.status === "passed").length, total: 7, failed,
    criticalFailed: items.filter((i) => i.status === "failed" && i.critical).map((i) => i.id),
    released: items.every((i) => !i.critical || i.status === "passed"), ...extra,
  };
}

test("central técnica: aceite guiado, área livre, som, câmera, emergência e dados que não são inventados", async ({ page }) => {
  const sent: { type: string; data: Record<string, unknown> }[] = [];
  const unit: Record<string, unknown> = {
    number: 3, name: "VERMELHO", color: 3, driver: "", boardId: "AAA", port: "COM7", firmware: 6, connected: true,
    wheel: 3, wheelConnected: true, phase: "idle", countdown: null, enabled: false, mask: 0, relayMask: 0,
    input: { steering: 0, throttle: 0, brake: 0 }, lapCount: 0, raceMode: 0,
    selfTest: { running: false, results: [true, true, true, true], interrupted: false },
    status: "Aceite técnico pendente: rode INICIAR ACEITAÇÃO na Central Técnica.", lastResult: null,
    times: { elapsedMs: null, laps: 0, bestLapMs: null, lastLapMs: null, lastMarkMs: null },
    battery: { on: true, usedMs: 600000, capacityMs: 1800000, percent: 67, alert: "ok" },
    blocked: true, blockReason: "acceptance", state: "WARNING", emergency: false, unitId: "RC-03",
    acceptance: acceptance({}),
    link: { port: "COM7", firmware: 6, boardId: "AAA", confirmMs: 12, rateHz: 7, late: 0, restarts: 0, reconnects: 1, lastAckMs: 40, uptimeMs: 3723000 },
    raw: { steering: 32715, throttle: 31, brake: 0 }, deadzone: { steering: 15, pedals: 12 },
    log: [
      { at: "2026-10-10T21:36:02.000-03:00", severity: "info", source: "Volante", message: "Volante sincronizado (canal 3)." },
      { at: "2026-10-10T21:36:00.000-03:00", severity: "success", source: "Placa", message: "Placa conectada: AAA em COM7 (firmware v6)." },
    ],
  };
  const fleet = {
    slots: [1, 2, 3, 4].map((n) => (n === 3 ? unit : { ...unit, number: n, color: n, name: "", acceptance: acceptance({}) })),
    spareBoards: [], classification: [], pairing: null, autoTest: true, events: [], available: 4, capacity: 4, setup: null,
    event: { id: 1, name: "Fortaleza", openedAt: "2026-10-10T13:00:00-03:00" }, record: null,
    ranking: { topN: 8, total: 0, cutMs: null, rows: [] }, alerts: [],
  };
  await page.routeWebSocket(/\/ws\/telemetry(\?|$)/, (ws) => {
    const send = () => ws.send(JSON.stringify({ type: "telemetry", data: {
      connected: true, controlAvailable: true, usbConnected: true, phase: "idle", port: "COM7", relayMask: 0,
      selfTest: { running: false, results: [true, true, true, true], interrupted: false, auto: true },
      slot: { number: 3, name: "VERMELHO", color: 3 }, fleet } }));
    const interval = setInterval(send, 50);
    ws.onClose(() => clearInterval(interval));
    ws.onMessage((m) => sent.push(JSON.parse(String(m))));
    send();
  });
  await page.route(/\/health$/, (r) => r.fulfill({ json: { lanUrls: [] } }));
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.goto("/?view=mecanico&grade=1&vaga=3");
  const central = page.locator(".technical-central");
  await expect(page.locator(".session-bar")).toContainText("CENTRAL TÉCNICA");
  await expect(page.locator(".session-bar")).toContainText("03 VERMELHO");
  await expect(page.locator(".env-port")).toContainText("COM7 · ONLINE");
  for (const tab of ["VISÃO GERAL", "DIAGNÓSTICOS", "ACEITAÇÃO TÉCNICA", "CONFIGURAÇÕES"])
    await expect(central.getByRole("button", { name: tab, exact: true })).toBeVisible();
  // No track map, no driving from here; the unit is fixed (no selector).
  await expect(page.locator(".track-card, .map-card, .track-map")).toHaveCount(0);
  await expect(page.getByRole("combobox", { name: "Fonte dos comandos" })).toHaveCount(0);
  await expect(page.locator(".tc-bottom select")).toHaveCount(0);
  await expect(page.locator(".tc-unit")).toContainText("03 · VERMELHO");
  // Pending acceptance with an open event: blocked, and why.
  const table = page.getByRole("region", { name: "ACEITAÇÃO TÉCNICA" });
  await expect(table.locator("tbody tr")).toHaveCount(7);
  await expect(table.locator(".tc-status.idle")).toHaveCount(7);
  await expect(page.locator(".tc-summary")).toContainText("ACEITE PENDENTE");
  await expect(page.locator(".tc-summary")).toContainText("CARRINHO BLOQUEADO");
  await expect(page.locator(".tc-summary")).toContainText("evento aberto");
  await expect(page.locator(".tc-verdict.bad")).toContainText("NÃO PODE RODAR");
  await expect(page.locator(".tc-verdict.bad")).toContainText("Aceite técnico pendente");
  await expect(page.locator(".tc-state")).toContainText("ATENÇÃO");
  // Real data only: USB link (no IP/RSSI), raw axes and dead zone; not measured = N/D.
  const comm = page.getByRole("region", { name: "COMUNICAÇÃO" });
  await expect(comm).toContainText("12 ms");
  await expect(comm).toContainText("não se aplica (USB)");
  await expect(page.locator(".tc-raw").first()).toContainText("32715");
  await expect(page.locator(".tc-raw").first()).toContainText("15%");
  const vehicle = page.getByRole("region", { name: "STATUS DO CARRINHO" });
  await expect(vehicle).toContainText("67%");
  await expect(vehicle).toContainText("01:02:03");
  await expect(vehicle.getByText("N/D")).toHaveCount(2); // temperature, radio signal
  await expect(page.getByRole("region", { name: "LOG DO SISTEMA" }).locator("li")).toHaveCount(2);
  // INICIAR ACEITAÇÃO: the whole acceptance.
  await table.getByRole("button", { name: /INICIAR ACEITAÇÃO/ }).click();
  await expect.poll(() => sent.some((m) => m.type === "acceptanceStart" && m.data.slot === 3 && !m.data.items)).toBe(true);
  // The relays wait for ÁREA LIVRE.
  unit.acceptance = acceptance({ communication: ["passed", "COM7 · confirmação 12 ms"], steering: ["passed", "ok"], pedals: ["passed", "ok"],
    actuators: ["testing", "Confirme ÁREA LIVRE: o carrinho pode se mover."] }, { running: true, current: "actuators", waiting: "area" });
  const area = page.getByRole("dialog", { name: "CONFIRMAR ÁREA LIVRE" });
  await expect(area).toContainText("O carrinho poderá se mover");
  await expect(page.locator(".tc-summary")).toContainText("TESTANDO");
  await area.getByRole("button", { name: /ÁREA LIVRE · CONTINUAR/ }).click();
  await expect.poll(() => sent.some((m) => m.type === "acceptanceArea" && m.data.slot === 3)).toBe(true);
  // Camera: measured on this PC (no picture here -> reported as failed, never invented).
  unit.acceptance = acceptance({ communication: ["passed", ""], steering: ["passed", ""], pedals: ["passed", ""], actuators: ["passed", "4/4"],
    emergency: ["passed", "30 ms"], camera: ["testing", "Clique em TESTAR IMAGEM com a câmera ligada."] }, { running: true, current: "camera", waiting: "camera" });
  await expect.poll(() => sent.find((m) => m.type === "acceptanceReport" && m.data.item === "camera")?.data.ok).toBe(false);
  // Audio: plays the test sound and asks.
  unit.acceptance = acceptance({ communication: ["passed", ""], steering: ["passed", ""], pedals: ["passed", ""], actuators: ["passed", "4/4"],
    emergency: ["passed", "30 ms"], camera: ["passed", "1920×1080 · 30 FPS"], audio: ["testing", "Clique em TESTAR SOM."] }, { running: true, current: "audio", waiting: "audio" });
  const heard = page.getByRole("dialog", { name: "VOCÊ OUVIU O SOM?" });
  await heard.getByRole("button", { name: "SIM", exact: true }).click();
  await expect.poll(() => sent.some((m) => m.type === "acceptanceReport" && m.data.item === "audio" && m.data.ok === true)).toBe(true);
  // Approved: green only on status.
  unit.acceptance = acceptance(Object.fromEntries(ITEMS.map(([id]) => [id, ["passed", "ok"]])),
    { trigger: null, triggerText: null, lastRun: { result: "passed", at: "2026-10-10T21:40:00-03:00" } });
  Object.assign(unit, { blocked: false, blockReason: null, state: "READY", status: "Aperte A para largar." });
  await expect(page.locator(".tc-summary.ok")).toContainText("7/7");
  await expect(page.locator(".tc-summary.ok")).toContainText("UNIDADE APTA");
  await expect(page.locator(".tc-state")).toContainText("PRONTO");
  await expect(page.locator(".tc-verdict.ok")).toContainText("LIBERADO PARA CORRER");
  await expect(page.locator(".tc-summary-line")).toContainText("ACEITE APTO");
  await page.screenshot({ path: "test-results/central-1366.png", fullPage: true });
  // Manual K1 pulse: ÁREA LIVRE first (cancel sends nothing); K3 (steering) goes at once.
  await page.getByRole("button", { name: "Testar relé K1", exact: true }).click();
  await page.getByRole("dialog", { name: "CONFIRMAR ÁREA LIVRE" }).getByRole("button", { name: "CANCELAR" }).click();
  expect(sent.some((m) => m.type === "relay")).toBe(false);
  await page.getByRole("button", { name: "Testar relé K1", exact: true }).click();
  await page.getByRole("dialog", { name: "CONFIRMAR ÁREA LIVRE" }).getByRole("button", { name: /ÁREA LIVRE · CONTINUAR/ }).click();
  await expect.poll(() => sent.some((m) => m.type === "relay" && m.data.relay === 1)).toBe(true);
  await page.getByRole("button", { name: "Testar relé K3", exact: true }).click();
  await expect.poll(() => sent.some((m) => m.type === "relay" && m.data.relay === 3)).toBe(true);
  // Emergency: from the bottom bar; RESET only after it.
  await expect(page.locator(".tc-reset")).toBeDisabled();
  await page.locator(".tc-bottom .tc-emergency").click();
  await expect.poll(() => sent.some((m) => m.type === "emergency" && m.data.slot === 3)).toBe(true);
  Object.assign(unit, { emergency: true, state: "EMERGENCY_STOP", blocked: true, status: "PARADA DE EMERGÊNCIA acionada: aperte RESET." });
  await expect(page.locator(".tc-state")).toContainText("EMERGÊNCIA");
  await page.locator(".tc-reset").click();
  await expect.poll(() => sent.some((m) => m.type === "emergencyReset" && m.data.slot === 3)).toBe(true);
  Object.assign(unit, { emergency: false, state: "READY", blocked: false, status: "Aperte A para largar." });
  // 1366 x 768: no sideways scroll (the page may scroll down).
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  // The grid shows each car's acceptance.
  await page.getByRole("button", { name: /4\s*GRADE/ }).click();
  const aceite = (n: number) => page.locator(".mech-card").nth(n).locator(".mech-check").filter({ hasText: "ACEITE" });
  await expect(aceite(2)).toContainText("7/7");
  await expect(aceite(2)).toContainText("APTO");
  await expect(aceite(0)).toContainText("PENDENTE");
  await expect(page.locator(".mech-card").nth(2).locator(".mech-verdict")).toContainText("LIBERADO PARA CORRER");
  // Selected and approved: the wheel was already synced and checked, so no sync offer.
  await expect(page.locator(".mech-card").nth(2)).toHaveAttribute("aria-current", "true");
  await expect(page.locator(".mech-card").nth(2).getByRole("button", { name: "SINCRONIZAR CONTROLE" })).toHaveCount(0);
  await page.locator(".mech-card").nth(0).locator("header").click(); // pending acceptance: offered
  await expect(page.locator(".mech-card").nth(0).getByRole("button", { name: "SINCRONIZAR CONTROLE" })).toBeVisible();
});
