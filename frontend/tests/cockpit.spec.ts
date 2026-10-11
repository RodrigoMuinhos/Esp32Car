import { test, expect } from "@playwright/test";
import { fleet, serve, slotTelemetry } from "./helpers";

test("relé só acende depois da confirmação da placa (Central Técnica)", async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(navigator, "getGamepads", { value: () => [] }));
  const f = fleet(4);
  const live = { relayMask: 0 as number, phase: "idle" };
  const { sent } = await serve(page, (_, vaga) => {
    f.slots[0].relayMask = live.relayMask;
    return slotTelemetry(f, vaga, { relayMask: live.relayMask, phase: live.phase, port: "COM7" });
  });
  await page.goto("/?view=mecanico&grade=1&vaga=1");
  const relays = page.getByRole("region", { name: "TESTE DE ATUADORES" });
  await expect(relays).toContainText("COM7 · ONLINE");
  // K3 (steering only) pulses at once; it lights up only when the board confirms it.
  await relays.getByRole("button", { name: "Testar relé K3", exact: true }).click();
  await expect.poll(() => sent.some((m) => m.type === "relay" && m.data.relay === 3)).toBe(true);
  await expect(relays.locator(".tc-relay.on")).toHaveCount(0);
  live.relayMask = 4;
  await expect(relays.locator(".tc-relay.on")).toContainText("K3 · DIREITA");
  await expect(relays.locator(".tc-relay.on")).toContainText("LIGADO");
  live.relayMask = 0;
  await expect(relays.locator(".tc-relay.on")).toHaveCount(0);
});

test("segunda janela observa: testes bloqueados até assumir o controle", async ({ page }) => {
  const f = fleet(4);
  const { sent } = await serve(page, (_, vaga) => slotTelemetry(f, vaga, { controlAvailable: false }));
  await page.goto("/?view=mecanico&grade=1&vaga=1");
  await expect(page.getByRole("button", { name: "Testar relé K1", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "ASSUMIR CONTROLE NESTA JANELA" }).click();
  await expect.poll(() => sent.some((m) => m.type === "claim")).toBe(true);
});

test("autoteste rápido pede área livre, mostra cada relé e o autoteste ao conectar fica nas configurações", async ({ page }) => {
  const f = fleet(4, {}, (n) => (n === 1 ? { selfTest: { running: false, results: [true, false, true, true], interrupted: false } } : {}));
  const auto = { on: true };
  const { sent } = await serve(page, (_, vaga) =>
    slotTelemetry(f, vaga, { selfTest: { ...f.slots[0].selfTest, auto: auto.on } }));
  await page.goto("/?view=mecanico&grade=1&vaga=1");
  const relays = page.getByRole("region", { name: "TESTE DE ATUADORES" });
  await expect(relays.locator(".tc-relay.fail")).toContainText("K2");
  await expect(relays.locator(".tc-relay.fail")).toContainText("SEM RESPOSTA");
  await relays.getByRole("button", { name: /AUTOTESTE RÁPIDO/ }).click();
  const area = page.getByRole("dialog", { name: "CONFIRMAR ÁREA LIVRE" });
  await area.getByRole("button", { name: /ÁREA LIVRE · CONTINUAR/ }).click();
  await expect.poll(() => sent.some((m) => m.type === "selftest")).toBe(true);
  await page.getByRole("button", { name: "CONFIGURAÇÕES", exact: true }).click();
  await page.getByLabel("Autoteste dos relés ao conectar a placa").click(); // the server owns this setting
  await expect.poll(() => sent.some((m) => m.type === "autoTest" && m.data.enabled === false)).toBe(true);
  auto.on = false;
  await expect(page.getByLabel("Autoteste dos relés ao conectar a placa")).not.toBeChecked();
});

test("painel de som: desligar e volumes por canal ficam salvos", async ({ page }) => {
  await serve(page, (_, vaga) => slotTelemetry(fleet(4), vaga));
  await page.goto("/?view=mecanico");
  await page.getByRole("button", { name: "Som" }).click();
  const panel = page.getByRole("dialog", { name: "Som" });
  await panel.getByRole("button", { name: "Desligar som" }).click();
  await panel.getByLabel("Volume voz").fill("40");
  await expect(panel).toContainText("40%");
  await page.keyboard.press("Escape");
  await expect(panel).toBeHidden();
  await page.reload();
  await page.getByRole("button", { name: "Som" }).click();
  await expect(page.getByRole("button", { name: "Ligar som" })).toBeVisible();
  await expect(page.getByLabel("Volume voz")).toHaveValue("40");
  await expect(page.getByLabel("Volume motor e pneus")).toHaveValue("100");
});

test("sem servidor: nada é inventado, a tela diz que está conectando", async ({ page }) => {
  await page.routeWebSocket(/\/ws\/telemetry(\?|$)/, (ws) => ws.close());
  await page.goto("/?view=mecanico&grade=1");
  await expect(page.locator(".header-status")).toContainText("DESCONECTADO");
  await expect(page.locator(".fleet-wait")).toContainText("Conectando ao servidor da corrida");
  await expect(page.locator(".technical-central, .mech-card")).toHaveCount(0);
  await expect(page.locator("footer")).toContainText("SERVIDOR DESCONECTADO");
});

test("carrinho real: o volante do navegador vai ao servidor quando o Windows não vê volante; na simulação, nunca", async ({ page }) => {
  await page.addInitScript(() => {
    const pad = {
      connected: true, id: "Test wheel", index: 0, mapping: "standard", axes: [0],
      buttons: Array.from({ length: 8 }, () => ({ value: 0, pressed: false, touched: false })),
    };
    Object.defineProperty(navigator, "getGamepads", { value: () => [pad] });
    Object.assign(window, { testPad: pad });
  });
  const f = fleet(4, {}, () => ({ wheelConnected: false }));
  const { sent } = await serve(page, (_, vaga) => slotTelemetry(f, vaga, { usbConnected: false }));
  await page.goto("/?view=mecanico");
  await page.evaluate(() => {
    (window as unknown as { testPad: { buttons: { value: number }[] } }).testPad.buttons[7].value = 0.6;
  });
  await expect.poll(() => sent.some((m) => m.arena === "real" && m.type === "control" && m.data.throttle === 60)).toBe(true);
  expect(sent.some((m) => m.type === "start" || m.type === "enable")).toBe(false);
  await page.getByRole("button", { name: "SIMULAÇÃO", exact: true }).click();
  await page.waitForTimeout(600);
  expect(sent.some((m) => m.arena === "sim" && m.type === "control")).toBe(false);
});

test("ranking abre com o resultado da corrida, identifica o carrinho (sem nome de piloto) e fecha na largada", async ({ page }) => {
  await page.route("**/api/ranking*", (route) =>
    route.fulfill({
      json: {
        driver: "Rodrigo", totalRaces: 2, totalMs: 95000,
        bestLaps: [
          { driver: "Rodrigo", lapMs: 9100, date: "2026-10-04T10:00:00-03:00", raceId: 7, slot: 1 },
          { driver: "Ana", lapMs: 9800, date: "2026-10-03T18:00:00-03:00", raceId: 3, slot: 3 },
        ],
        mostLaps: [{ driver: "Rodrigo", laps: 4, durationMs: 52000, date: "2026-10-04T10:00:00-03:00", raceId: 7, slot: 1 }],
        recent: [{ id: 7, driver: "Rodrigo", date: "2026-10-04T10:00:00-03:00", durationMs: 52000, laps: 4, bestLapMs: 9100, reason: "Corrida finalizada pelo botão B.", slot: 1 }],
      },
    }),
  );
  const f = fleet(4);
  const live: Record<string, unknown> = { phase: "running", lastResult: null, driver: "Rodrigo" };
  await serve(page, (_, vaga) => slotTelemetry(f, vaga, live));
  await page.goto("/?view=mecanico");
  await page.waitForTimeout(300);
  Object.assign(live, {
    phase: "finished",
    lastResult: { raceId: 7, driver: "Rodrigo", durationMs: 52000, laps: 4, bestLapMs: 9100, position: 1, reason: "B", slot: 1 },
  });
  const dialog = page.getByRole("dialog", { name: "Ranking" });
  await expect(dialog).toContainText("CORRIDA FINALIZADA · CARRINHO 01 AZUL ELÉTRICO");
  await expect(dialog).toContainText("00:52.000");
  await expect(dialog.locator("tr.mine")).toContainText("00:09.100");
  await expect(dialog.locator("tr.mine")).toContainText("01 AZUL ELÉTRICO");
  await expect(dialog).toContainText("03 VERMELHO");
  await dialog.getByRole("tab", { name: "Histórico" }).click();
  await expect(dialog).toContainText("Botão B");
  // Drivers are not identified by name: no name field, and names from the server are not shown.
  await expect(dialog.getByLabel("Nome do piloto")).toHaveCount(0);
  await expect(dialog).not.toContainText("Rodrigo");
  await expect(dialog).not.toContainText("Ana");
  Object.assign(live, { phase: "countdown", countdown: 2.5 });
  await expect(dialog).toBeHidden();
});

for (const [width, height] of [
  [1280, 720],
  [1366, 768],
  [1920, 1080],
  [1080, 1920],
  [390, 844],
]) {
  test(`layout ${width}x${height}: grade e Central Técnica sem rolagem lateral`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await serve(page, (_, vaga) => slotTelemetry(fleet(16), vaga));
    for (const url of ["/?view=mecanico&grade=4", "/?view=mecanico&grade=16", "/?view=mecanico&grade=1&vaga=1", "/?view=corrida"]) {
      await page.goto(url);
      await page.locator(".mech-card, .technical-central, .telao-broadcast").first().waitFor();
      await page.evaluate(() => document.fonts.ready);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), url).toBe(true);
    }
    await page.screenshot({ path: `test-results/central-${width}.png`, fullPage: true });
  });
}

test("atalhos: F6 visão mecânico, F7 visão piloto, F8 visão corrida", async ({ page }) => {
  await serve(page, (_, vaga) => slotTelemetry(fleet(4), vaga));
  await page.goto("/?view=mecanico");
  await expect(page.locator(".mech-card").first()).toBeVisible();
  await page.keyboard.press("F7");
  await expect(page.locator(".pilot-hud")).toBeVisible();
  await page.keyboard.press("F8");
  await expect(page.locator(".telao-broadcast")).toBeVisible();
  await page.keyboard.press("F6");
  await expect(page.locator(".mech-card").first()).toBeVisible();
  await expect(page.getByRole("button", { name: "VISÃO MECÂNICO" })).toHaveAttribute("aria-pressed", "true");
});
