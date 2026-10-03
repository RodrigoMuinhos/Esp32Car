import { parseTelemetry, type Input, type Telemetry } from "../types/telemetry";
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
    const socket = new WebSocket(`ws://${host}:8080/ws/telemetry`);
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
  control(input: Input) {
    const now = performance.now();
    if (now - this.lastControl < 40) return;
    this.lastControl = now;
    this.send({ type: "control", data: input });
  }
  claimControl() {
    this.send({ type: "claim", data: {} });
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
