import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseTelemetry, processInput } from "./types/telemetry";
import { readGamepad } from "./hooks/useControls";
import { TelemetrySocket } from "./services/telemetrySocket";
describe("dados e controles", () => {
  it("descarta mensagens inválidas e limita valores físicos", () => {
    expect(parseTelemetry("broken")).toBeNull();
    expect(parseTelemetry('{"type":"control","data":{}}')).toBeNull();
    expect(
      parseTelemetry(
        '{"type":"telemetry","data":{"battery":400,"steering":-200,"speed":null,"connected":"yes"}}',
      ),
    ).toEqual({ battery: 100, steering: -100, speed: null });
    expect(
      parseTelemetry(
        '{"type":"telemetry","data":{"speed":"fast","position":{"x":null,"y":2,"heading":3}}}',
      ),
    ).toBeNull();
  });
  it("aplica sensibilidade, modo e prioridade do freio", () => {
    expect(
      processInput(
        { steering: 100, throttle: 80, brake: 0 },
        "normal",
        50,
        100,
      ),
    ).toEqual({ steering: 35, throttle: 56, brake: 0 });
    expect(
      processInput({ steering: 3, throttle: 80, brake: 20 }, "sport", 100, 100),
    ).toEqual({ steering: 0, throttle: 0, brake: 20 });
  });
  it("lê RT/RB e LT/LB, incluindo pedais simultâneos", () => {
    const buttons = Array.from({ length: 8 }, (_, i) => ({
      value: i === 7 ? 0.7 : i === 4 ? 1 : 0,
      pressed: false,
      touched: false,
    }));
    expect(readGamepad({ axes: [-0.5], buttons })).toEqual({
      steering: -50,
      throttle: 70,
      brake: 100,
    });
  });
});
class FakeSocket {
  static OPEN = 1;
  static instances: FakeSocket[] = [];
  readyState = 1;
  bufferedAmount = 0;
  onopen?: () => void;
  onmessage?: (event: { data: string }) => void;
  onclose?: () => void;
  sent: string[] = [];
  constructor() {
    FakeSocket.instances.push(this);
  }
  send(message: string) {
    this.sent.push(message);
  }
  close() {
    this.readyState = 3;
    this.onclose?.();
  }
}
describe("WebSocket", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    FakeSocket.instances = [];
    vi.stubGlobal("window", globalThis);
    vi.stubGlobal("WebSocket", FakeSocket);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });
  it("não para o carrinho ao conectar, limita a frequência e para só com PARAR", () => {
    const status = vi.fn();
    const data = vi.fn();
    const client = new TelemetrySocket(data, status);
    client.connect();
    const socket = FakeSocket.instances[0];
    socket.onopen?.();
    expect(socket.sent).toHaveLength(0);
    socket.onmessage?.({
      data: '{"type":"telemetry","data":{"connected":true,"hold":{"action":"start","remaining":1.2},"raceId":3}}',
    });
    expect(status).toHaveBeenLastCalledWith(true);
    expect(data).toHaveBeenLastCalledWith(
      expect.objectContaining({ hold: { action: "start", remaining: 1.2 }, raceId: 3 }),
    );
    vi.advanceTimersByTime(100);
    for (let i = 0; i < 100; i++)
      client.control({ throttle: 100, brake: 0, steering: 0 });
    expect(socket.sent).toHaveLength(1);
    expect(JSON.parse(socket.sent[0])).toEqual({
      type: "control",
      data: { throttle: 100, brake: 0, steering: 0 },
    });
    client.stopCar();
    expect(JSON.parse(socket.sent.at(-1)!).type).toBe("stop");
    vi.advanceTimersByTime(1800);
    expect(status).toHaveBeenLastCalledWith(false);
    expect(socket.readyState).toBe(3);
    client.close();
    vi.advanceTimersByTime(3000);
    expect(FakeSocket.instances).toHaveLength(1);
  });
});
