import { test, expect } from "@playwright/test";
test("painel integrado detecta volante do Windows e só acende relé após confirmação", async ({
  page,
}) => {
  const received: { type: string; data: { relay?: number } }[] = [];
  await page.addInitScript(() =>
    Object.defineProperty(navigator, "getGamepads", { value: () => [] }),
  );
  await page.routeWebSocket(/\/ws\/telemetry$/, (ws) => {
    let relayMask = 0,
      phase = "idle";
    const timers: ReturnType<typeof setTimeout>[] = [];
    const send = () =>
      ws.send(
        JSON.stringify({
          type: "telemetry",
          data: {
            connected: true,
            carEnabled: false,
            controlAvailable: true,
            port: "COM7",
            phase,
            relayMask,
            usbConnected: true,
            usbInput: { steering: 0, throttle: 0, brake: 0 },
          },
        }),
      );
    const interval = setInterval(send, 50);
    ws.onClose(() => {
      clearInterval(interval);
      timers.forEach(clearTimeout);
    });
    ws.onMessage((message) => {
      const parsed = JSON.parse(String(message));
      received.push(parsed);
      if (parsed.type === "relay") {
        phase = "pulse";
        timers.push(
          setTimeout(() => {
            relayMask = 1 << (parsed.data.relay - 1);
            send();
          }, 200),
        );
        timers.push(
          setTimeout(() => {
            relayMask = 0;
            phase = "idle";
            send();
          }, 700),
        );
      }
    });
    send();
  });
  await page.goto("/");
  await expect(page.locator(".input-source")).toContainText(
    "VOLANTE USB DETECTADO",
  );
  await expect(page.locator(".relay-card .card-tag")).toContainText(
    "COM7 · ONLINE",
  );
  await page
    .getByRole("button", { name: "Testar relé K3", exact: true })
    .click();
  await expect
    .poll(() => received.some((m) => m.type === "relay" && m.data.relay === 3))
    .toBe(true);
  await expect(page.locator(".relay-on")).toHaveCount(0);
  await expect(page.locator(".relay-on")).toContainText("K3");
  await expect(page.locator(".relay-on")).toHaveCount(0);
  await page.screenshot({ path: "test-results/integrated-relays.png" });
});
test("segunda janela observa sem obter autorização de controle", async ({
  page,
}) => {
  await page.routeWebSocket(/\/ws\/telemetry$/, (ws) => {
    const interval = setInterval(
      () =>
        ws.send(
          JSON.stringify({
            type: "telemetry",
            data: {
              connected: true,
              controlAvailable: false,
              usbConnected: true,
              usbInput: { steering: 0, throttle: 0, brake: 0 },
            },
          }),
        ),
      50,
    );
    ws.onClose(() => clearInterval(interval));
  });
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: "Testar relé K1", exact: true }),
  ).toBeDisabled();
  await expect(page.locator("footer")).toContainText(
    "Outra janela está controlando",
  );
});
test("botão A conta 3-2-1 e larga, simulação reage, volta é registrada e ESC para", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/?mode=simulation");
  await expect(
    page.getByRole("heading", { name: "Seu carrinho. Em tempo real." }),
  ).toBeVisible();
  await expect(page.locator(".start-card")).toContainText("APERTE A PARA LARGAR");
  const throttle = page.getByRole("slider", { name: "Teste acelerador", exact: true });
  await expect(page.locator(".power-readout")).toContainText("BLOQUEADA");
  await page.getByRole("button", { name: "INICIAR (A)" }).click();
  await expect(page.locator(".start-card")).toContainText("PREPARE-SE");
  await expect(page.locator(".hud-count")).toHaveText("3");
  await expect(page.locator(".power-readout")).toContainText("BLOQUEADA");
  await expect(page.locator(".hud-count")).toHaveText("1", { timeout: 3000 });
  await expect(page.locator(".power-readout")).toContainText("LIBERADA", {
    timeout: 3000,
  });
  await expect(page.locator(".start-card")).toContainText("CORRIDA ATIVA");
  await throttle.fill("75");
  await expect(page.locator(".power-readout strong")).toHaveText("75%");
  await expect
    .poll(async () =>
      Number(await page.locator(".speed-number strong").innerText()),
    )
    .toBeGreaterThan(0);
  await page
    .getByRole("slider", { name: "Teste direção", exact: true })
    .fill("-50");
  await expect(page.locator(".angle strong")).toContainText("-23");
  await page
    .getByRole("button", { name: "Registrar volta", exact: true })
    .click();
  await expect(page.locator(".timing-card .card-tag")).toHaveText("VOLTA 02");
  await page.keyboard.press("Escape");
  await expect(page.locator(".power-readout")).toContainText("BLOQUEADA");
  await expect(page.locator(".start-card")).toContainText("CORRIDA FINALIZADA");
  await expect(page.locator(".speed-number strong")).toHaveText("00");
  await expect(page.locator(".timing-card")).toContainText("00:00.000");
  await expect(page.locator(".timing-card .card-tag")).toHaveText("VOLTA 01");
  expect(errors).toEqual([]);
});
test("acelerador 0,5s larga, toque curto cancela, B cancela a contagem e finaliza", async ({ page }) => {
  await page.goto("/?mode=simulation");
  const throttle = page.getByRole("slider", { name: "Teste acelerador", exact: true });
  await throttle.fill("60");
  await throttle.fill("0");
  await expect(page.locator(".start-card")).toContainText("Início cancelado");
  await page.getByRole("button", { name: "INICIAR (A)" }).click();
  await page.getByRole("button", { name: "CANCELAR (B)" }).click();
  await expect(page.locator(".start-card")).toContainText("Largada cancelada");
  await throttle.fill("60");
  await expect(page.locator(".power-readout")).toContainText("LIBERADA", {
    timeout: 2000,
  });
  await page.getByRole("button", { name: "FINALIZAR (B)" }).click();
  await expect(page.locator(".start-card")).toContainText("CORRIDA FINALIZADA");
  await expect(page.locator(".start-card")).toContainText("botão B");
  await expect(page.locator(".timing-card")).toContainText("00:00.000");
});
test("som pode ser desligado e a preferência fica salva", async ({ page }) => {
  await page.goto("/?mode=simulation");
  await page.getByRole("button", { name: "Desligar som" }).click();
  await expect(page.getByRole("button", { name: "Ligar som" })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("button", { name: "Ligar som" })).toBeVisible();
});
test("trocar de janela não interrompe a corrida", async ({ page }) => {
  await page.goto("/?mode=simulation");
  await page.getByRole("button", { name: "INICIAR (A)" }).click();
  await expect(page.locator(".power-readout")).toContainText("LIBERADA", {
    timeout: 5000,
  });
  await page.evaluate(() => window.dispatchEvent(new Event("blur")));
  await page.waitForTimeout(500);
  await expect(page.locator(".start-card")).toContainText("CORRIDA ATIVA");
  await expect(page.locator(".power-readout")).toContainText("LIBERADA");
});
test("modo real sem backend permanece bloqueado e não inventa sensores", async ({
  page,
}) => {
  await page.routeWebSocket(/\/ws\/telemetry$/, (ws) => ws.close());
  await page.goto("/?mode=simulation");
  await page
    .getByRole("button", { name: "CARRINHO REAL", exact: true })
    .click();
  await expect(page.locator(".header-status")).toContainText("DESCONECTADO");
  await expect(page.locator(".power-readout")).toContainText("BLOQUEADA");
  await expect(page.locator(".speed-number strong")).toHaveText("00");
  await expect(page.locator(".speed-card .card-tag")).toHaveText("ESTIMADA");
});
test("modo real mostra a corrida do backend e envia o volante do navegador sem Windows", async ({
  page,
}) => {
  const messages: { type: string; data: Record<string, unknown> }[] = [];
  await page.addInitScript(() => {
    const pad = {
      connected: true,
      id: "Test wheel",
      index: 0,
      mapping: "standard",
      axes: [0],
      buttons: Array.from({ length: 8 }, () => ({
        value: 0,
        pressed: false,
        touched: false,
      })),
    };
    Object.defineProperty(navigator, "getGamepads", { value: () => [pad] });
    Object.assign(window, { testPad: pad });
  });
  const backend = { phase: "idle", carEnabled: false };
  await page.routeWebSocket(/\/ws\/telemetry$/, (ws) => {
    const send = () =>
      ws.send(
        JSON.stringify({
          type: "telemetry",
          data: {
            connected: true,
            controlAvailable: true,
            usbConnected: false,
            raceId: backend.phase === "running" ? 1 : 0,
            ...backend,
          },
        }),
      );
    const interval = setInterval(send, 50);
    ws.onClose(() => clearInterval(interval));
    ws.onMessage((message) => messages.push(JSON.parse(String(message))));
    send();
  });
  await page.goto("/?mode=simulation");
  await page
    .getByRole("button", { name: "CARRINHO REAL", exact: true })
    .click();
  await page.evaluate(() => {
    (
      window as unknown as { testPad: { buttons: { value: number }[] } }
    ).testPad.buttons[7].value = 0.6;
  });
  await expect
    .poll(() =>
      messages.some((m) => m.type === "control" && m.data.throttle === 60),
    )
    .toBe(true);
  expect(messages.some((m) => m.type === "start" || m.type === "enable")).toBe(false);
  // Wheel A from the browser gamepad goes to the backend as "start".
  await page.evaluate(() => {
    (
      window as unknown as { testPad: { buttons: { pressed: boolean }[] } }
    ).testPad.buttons[0].pressed = true;
  });
  await expect
    .poll(() => messages.some((m) => m.type === "control" && m.data.start === true))
    .toBe(true);
  Object.assign(backend, { phase: "running", carEnabled: true });
  await expect(page.locator(".start-card")).toContainText("CORRIDA ATIVA");
  await expect(page.locator(".power-readout")).toContainText("LIBERADA");
  // 60% throttle -> about 40 * 0.6^1.4 = 19 km/h imaginary speed.
  await expect
    .poll(async () =>
      Number(await page.locator(".speed-number strong").innerText()),
    )
    .toBeGreaterThanOrEqual(17);
  await expect(page.locator(".race-hint")).toContainText("BOTÃO B FINALIZA");
  await page.getByRole("button", { name: /PARAR/ }).first().click();
  await expect.poll(() => messages.some((m) => m.type === "stop")).toBe(true);
});
for (const [width, height] of [
  [1366, 768],
  [1920, 1080],
  [1080, 1920],
  [390, 844],
]) {
  test(`layout ${width}x${height}`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await page.goto("/?mode=simulation");
    await page.evaluate(() => document.fonts.ready);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    if (width > 850)
      expect(
        await page.evaluate(
          () => document.documentElement.scrollHeight <= window.innerHeight,
        ),
      ).toBe(true);
    for (const selector of [
      ".speed-number",
      ".card-foot",
      ".power-bars",
      ".micro-note",
      ".pedals",
      ".steering-scale",
    ]) {
      const fits = await page.locator(selector).evaluate((element) => {
        const card = element.closest(".card")!.getBoundingClientRect();
        const box = element.getBoundingClientRect();
        return (
          box.bottom <= card.bottom &&
          box.right <= card.right &&
          box.top >= card.top
        );
      });
      expect(fits, `${selector} deve caber dentro do card`).toBe(true);
    }
    await page.screenshot({
      path: `test-results/cockpit-${width}.png`,
      fullPage: true,
    });
  });
}
