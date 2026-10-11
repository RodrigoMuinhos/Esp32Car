import { test, expect } from "@playwright/test";
import { fleet, serve, slotTelemetry } from "./helpers";
test("visão piloto: HUD sobre o mapa da pista, dados nos espaços da moldura, campeão e o ponto do carrinho na simulação", async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  const f = fleet(4);
  const live: Record<string, unknown> = { phase: "idle", carEnabled: false, times: { elapsedMs: null, laps: 0, bestLapMs: null, lastLapMs: null, lastMarkMs: null } };
  await serve(page, (_, vaga) => slotTelemetry(f, vaga, live));
  await page.goto("/?grade=4"); // real cars. No view in the URL: the chosen view is remembered
  await page.getByRole("button", { name: "VISÃO PILOTO", exact: true }).click();
  const hud = page.locator(".pilot-hud");
  await expect(hud.locator(".hud-frame")).toBeVisible();
  // The arena background and the track map behind the frame, inside a thin black margin; no video.
  const back = await hud.locator(".hud-camera").boundingBox();
  expect(back!.x).toBeGreaterThan(5); // the black margin
  expect(back!.x).toBeLessThan(40);
  await expect(hud.locator(".hud-track img")).toHaveAttribute("src", "/hud/pista.png");
  await expect(hud.locator("video, iframe")).toHaveCount(0);
  await expect(hud.locator(".hud-track-dot")).toHaveCount(0); // real cars: no position sensor, no dot
  await expect(page.locator(".bc-banner")).toHaveText("ACELERE PARA LARGAR");
  await expect(hud.locator(".hud-me")).toContainText("01 AZUL ELÉTRICO");
  await expect(hud.locator(".hud-ranking li")).toHaveCount(4);
  await expect(hud.locator(".hud-speed")).toContainText("ESTIMADA"); // no speed sensor on the car
  // Racing: the server's order fills position and ranking (cars by color, no names); nothing over the track.
  Object.assign(f, { classification: [
    { slot: 2, name: "LARANJA", driver: "", position: 1, laps: 3, elapsedMs: 41000, bestLapMs: 11200, lastLapMs: 11500, lastMarkMs: 39000 },
    { slot: 1, name: "AZUL ELÉTRICO", driver: "", position: 2, laps: 2, elapsedMs: 41000, bestLapMs: 11820, lastLapMs: 12100, lastMarkMs: 30000 },
    { slot: 3, name: "VERMELHO", driver: "", position: 3, laps: 2, elapsedMs: 41000, bestLapMs: 12400, lastLapMs: 12600, lastMarkMs: 31000 },
  ] });
  Object.assign(live, { phase: "running", carEnabled: true, lapCount: 2, raceMode: 5,
    times: { elapsedMs: 47382, laps: 2, bestLapMs: 11820, lastLapMs: 12100, lastMarkMs: 30000 } });
  await expect(page.locator(".bc-banner")).toHaveCount(0);
  await expect(hud.locator(".hud-timer")).toHaveText("00:47.382");
  await expect(hud.locator(".hud-best")).toContainText("11.820");
  await expect(hud.locator(".hud-position")).toContainText("2/3");
  await expect(hud.locator(".hud-ranking li").nth(0)).toContainText("LARANJA");
  await expect(hud.locator(".hud-ranking li.me")).toContainText("AZUL ELÉTRICO");
  await expect(hud.locator(".hud-ranking li").nth(3)).toContainText("—");
  await expect(hud.locator(".hud-laps")).toContainText("03 / 05");
  await expect(hud.locator(".hud-me")).toContainText("NA PISTA");
  // The driving area (center of the window) is camera only.
  const blocked = await page.evaluate(() => {
    const s = document.querySelector(".hud-stage")!.getBoundingClientRect();
    const area = { l: s.x + s.width * 0.18, r: s.x + s.width * 0.82, t: s.y + s.height * 0.27, b: s.y + s.height * 0.55 };
    return [...document.querySelectorAll(".hud-data > :not(.hud-ranking), .hud-ranking li")].filter((e) => {
      const b = e.getBoundingClientRect();
      return b.right > area.l && b.left < area.r && b.bottom > area.t && b.top < area.b;
    }).map((e) => e.className);
  });
  expect(blocked).toEqual([]);
  await page.screenshot({ path: "test-results/hud-1920.png" });
  // Special states.
  Object.assign(live, { phase: "countdown", countdown: 2.2 });
  await expect(page.locator(".bc-banner")).toContainText("LARGADA EM");
  Object.assign(live, { phase: "finished", countdown: null, carEnabled: false });
  await expect(page.locator(".bc-banner")).toHaveText("BANDEIRADA");
  // After the last lap: the champion from the server's finishing order, and this car's place.
  Object.assign(f, { finishOrder: [{ slot: 2, color: 2, durationMs: 47210, position: 1 }, { slot: 1, color: 1, durationMs: 48003, position: 2 }] });
  const champion = page.locator(".hud-champion");
  await expect(champion).toContainText("CAMPEÃO");
  await expect(champion).toContainText("02 LARANJA");
  await expect(champion).toContainText("VOCÊ: 2º LUGAR");
  Object.assign(f, { finishOrder: [] });
  Object.assign(live, { connected: false });
  await expect(page.locator(".bc-banner")).toHaveText("SEM SINAL DO CARRINHO");
  Object.assign(live, { connected: true });
  // Same layout in a smaller 16:9 screen.
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.screenshot({ path: "test-results/hud-1366.png" });
  await page.reload();
  await expect(page.getByRole("button", { name: "VISÃO PILOTO", exact: true })).toHaveAttribute("aria-pressed", "true");
  // Leaving the HUD from its corner.
  await page.getByRole("button", { name: "Sair da visão piloto" }).click();
  await expect(page.getByRole("button", { name: "VISÃO MECÂNICO" })).toHaveAttribute("aria-pressed", "true");
  // SIMULAÇÃO: this car is a glowing dot running around the track, the opponents smaller dots.
  Object.assign(live, { phase: "running", carEnabled: true, times: { elapsedMs: 3000, laps: 0, bestLapMs: null, lastLapMs: null, lastMarkMs: 0 } });
  f.slots.forEach((s) => Object.assign(s, { phase: "running", times: { elapsedMs: 3000, laps: 0, bestLapMs: null, lastLapMs: null, lastMarkMs: 0 } }));
  await page.goto("/?mode=simulation&view=piloto");
  const dot = page.locator(".hud-track-dot");
  await expect(dot).toHaveCount(1);
  await expect(page.locator(".hud-track-rival")).toHaveCount(3);
  const first = await dot.getAttribute("transform");
  await page.waitForTimeout(600);
  expect(await dot.getAttribute("transform")).not.toBe(first); // it moves
});
