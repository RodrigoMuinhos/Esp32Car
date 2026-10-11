import { test, expect } from "@playwright/test";
import { fleet, serve, slotTelemetry } from "./helpers";

test("telão: transmissão para o público, só dados esportivos, nos estados da corrida", async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  const f = fleet(4, { event: { id: 1, name: "Fortaleza · Shopping", openedAt: "2026-10-10T13:00:00-03:00" },
    record: { lapMs: 8349, at: "2026-10-10T14:00:00-03:00", slot: 1, color: 1, raceId: 3 } },
    (n) => (n === 4 ? { blocked: true } : {}));
  await serve(page, (_, vaga) => slotTelemetry(f, vaga));
  await page.goto("/?tela=telao");
  const tv = page.locator(".telao-broadcast");
  // Nothing operational for the audience.
  for (const word of ["VISÃO MECÂNICO", "LARGAR TODOS", "SIMULAÇÃO", "CARRINHO REAL", "ENCERRAR EVENTO", "COM3"])
    await expect(page.getByText(word, { exact: false })).toHaveCount(0);
  await expect(tv.locator(".tv-live")).toContainText("AO VIVO");
  await expect(tv.locator(".tv-event")).toHaveText("Circuito CWB");
  // Before the start: the cars of the next race (PRONTO only when cleared).
  await expect(tv.locator(".tv-board-title")).toHaveText("PRÓXIMA CORRIDA");
  await expect(tv.locator(".tv-board li").nth(0)).toContainText("AZUL ELÉTRICO");
  await expect(tv.locator(".tv-board li").nth(0)).toContainText("PRONTO");
  await expect(tv.locator(".tv-board li").nth(3)).not.toContainText("PRONTO");
  await expect(tv.locator(".tv-best")).toContainText("00:08.349");
  // Countdown over the video.
  f.slots.forEach((s) => Object.assign(s, { phase: "countdown", countdown: 2.4 }));
  await expect(tv.locator(".tv-count")).toHaveText("3");
  // Racing: position · car · gap; the leader shows its best lap.
  f.slots.forEach((s) => Object.assign(s, { phase: "running", countdown: null, raceMode: 5 }));
  Object.assign(f, { classification: [
    { slot: 1, name: "AZUL ELÉTRICO", driver: "", position: 1, laps: 3, elapsedMs: 42582, bestLapMs: 8349, lastLapMs: 9000, lastMarkMs: 40000 },
    { slot: 2, name: "LARANJA", driver: "", position: 2, laps: 3, elapsedMs: 42582, bestLapMs: 9861, lastLapMs: 9900, lastMarkMs: 41512 },
    { slot: 3, name: "VERMELHO", driver: "", position: 3, laps: 2, elapsedMs: 42582, bestLapMs: 10214, lastLapMs: 10300, lastMarkMs: 30000 },
  ] });
  await expect(tv.locator(".tv-board-title")).toHaveText("CLASSIFICAÇÃO");
  await expect(tv.locator(".tv-board li.leader")).toContainText("AZUL ELÉTRICO");
  await expect(tv.locator(".tv-board li.leader")).toContainText("08.349");
  await expect(tv.locator(".tv-board li").nth(1)).toContainText("+1.512");
  await expect(tv.locator(".tv-board li").nth(2)).toContainText("+1 VOLTA");
  await expect(tv.locator(".tv-race")).toContainText("04 / 05");
  await expect(tv.locator(".tv-race")).toContainText("00:42.582");
  await expect(tv.locator(".tv-bar")).toContainText("1º AZUL ELÉTRICO");
  await expect(tv.locator(".tv-bar")).toContainText("3 CARRINHOS");
  // Last lap of the leader: a short notice.
  f.classification[0] = { ...f.classification[0], laps: 4, lastMarkMs: 49000 };
  await expect(tv.locator(".tv-notice")).toHaveText("ÚLTIMA VOLTA");
  await page.screenshot({ path: "test-results/telao-1920.png" });
  // The race ends: the last order stays as the final result.
  f.slots.forEach((s) => Object.assign(s, { phase: "finished" }));
  Object.assign(f, { classification: [] });
  const final = tv.locator(".tv-final");
  await expect(final).toContainText("RESULTADO FINAL");
  await expect(final.locator("li").nth(0)).toContainText("1º AZUL ELÉTRICO");
  await expect(tv.locator(".tv-board-title")).toHaveText("RESULTADO FINAL");
  // Same layout on a smaller 16:9 screen, no sideways scroll.
  await page.setViewportSize({ width: 1366, height: 768 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  // The next start clears the result.
  f.slots.forEach((s) => Object.assign(s, { phase: "countdown", countdown: 1.2 }));
  await expect(final).toHaveCount(0);
});
