import {
  parseTelemetry,
  type Buttons,
  type Input,
  type Telemetry,
} from "../types/telemetry";
import { arenaQuery } from "../arena";
export class TelemetrySocket {
  private socket: WebSocket | null = null;
  private retry = 0;
  private watchdog = 0;
  private stopped = false;
  private lastMessage = 0;
  private lastControl = 0;
  constructor(
    private onData: (data: Partial<Telemetry>) => void,
    private onStatus: (online: boolean) => void,
  ) {}
  connect() {
    if (this.stopped) return;
    const host = window.location?.hostname || "localhost";
    // Served by the app: same port (8080, or the next free one). Vite dev: 8080.
    const pagePort = window.location?.port;
    const port = pagePort && pagePort !== "5173" ? pagePort : "8080";
    // Each cockpit tablet follows its color (?vaga=N). The central PC itself is also
    // the operator (the server only accepts that from this computer).
    const params = new URLSearchParams(window.location?.search ?? "");
    const vaga = params.get("vaga") ?? "1";
    const local = ["localhost", "127.0.0.1"].includes(host);
    const socket = new WebSocket(
      `ws://${host}:${port}/ws/telemetry?vaga=${encodeURIComponent(vaga)}${local ? "&painel=1" : ""}${arenaQuery()}`,
    );
    this.socket = socket;
    socket.onopen = () => {
      this.lastMessage = performance.now();
      this.watchdog = window.setInterval(() => {
        if (performance.now() - this.lastMessage > 1500) socket.close();
      }, 250);
    };
    socket.onmessage = (event) => {
      const data = parseTelemetry(String(event.data));
      if (data) {
        this.lastMessage = performance.now();
        this.onStatus(true);
        this.onData(data);
      }
    };
    socket.onerror = () => socket.close();
    socket.onclose = () => {
      window.clearInterval(this.watchdog);
      this.onStatus(false);
      if (!this.stopped)
        this.retry = window.setTimeout(() => this.connect(), 2000);
    };
  }
  private send(message: object) {
    if (
      this.socket?.readyState === WebSocket.OPEN &&
      this.socket.bufferedAmount < 4096
    )
      this.socket.send(JSON.stringify(message));
  }
  /** Pedal/wheel input read by the browser, used when Windows has no wheel. */
  control(input: Input, buttons: Buttons) {
    const now = performance.now();
    if (now - this.lastControl < 40) return;
    this.lastControl = now;
    this.send({ type: "control", data: { ...input, ...buttons } });
  }
  claimControl() {
    this.send({ type: "claim", data: {} });
  }
  /** Lap flag pressed: the backend times it with its own clock. */
  lap() {
    this.send({ type: "lap", data: {} });
  }
  /** 0 = free race, 3/5 = time trial. */
  setMode(laps: number) {
    this.send({ type: "mode", data: { laps } });
  }
  /** Operator commands (start/stop everyone, assign boards, pair wheels...). */
  command(type: string, data: Record<string, unknown> = {}) {
    this.send({ type, data });
  }
  /** Pulses K1..K4 briefly; the ESP32 must confirm each one. */
  selfTest() {
    this.send({ type: "selftest", data: {} });
  }
  setAutoTest(enabled: boolean) {
    this.send({ type: "autoTest", data: { enabled } });
  }
  testRelay(relay: number) {
    this.send({ type: "relay", data: { relay } });
  }
  stopCar() {
    this.send({ type: "stop", data: {} });
  }
  close() {
    this.stopped = true;
    clearTimeout(this.retry);
    clearInterval(this.watchdog);
    this.socket?.close();
  }
}
