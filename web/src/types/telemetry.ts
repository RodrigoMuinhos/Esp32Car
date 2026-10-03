export type Input = { steering: number; throttle: number; brake: number };
export type RaceState = "idle" | "running" | "finished";
/** Wheel buttons: A (start) and B (finish). */
export type Buttons = { start: boolean; finish: boolean };
export const NO_BUTTONS: Buttons = { start: false, finish: false };
export type DriveMode = "normal" | "sport" | "precision";
export interface Telemetry extends Input {
  connected: boolean;
  speed: number | null;
  battery: number | null;
  signal: number | null;
  temperature: number | null;
  carEnabled: boolean;
  relayMask: number | null;
  requestedMask: number;
  controlAvailable: boolean;
  usbConnected: boolean;
  usbInput: Input;
  port: string;
  phase: string;
  raceId: number;
  status: string;
  position: { x: number; y: number; heading: number } | null;
}
export const ZERO_INPUT: Input = { steering: 0, throttle: 0, brake: 0 };
export const EMPTY_TELEMETRY: Telemetry = {
  ...ZERO_INPUT,
  connected: false,
  speed: null,
  battery: null,
  signal: null,
  temperature: null,
  carEnabled: false,
  relayMask: null,
  requestedMask: 0,
  controlAvailable: false,
  usbConnected: false,
  usbInput: ZERO_INPUT,
  port: "COM7",
  phase: "idle",
  raceId: 0,
  status: "Conectando à placa...",
  position: null,
};
export const SIMULATION_MODE = false;
export const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value));
export function processInput(
  input: Input,
  mode: DriveMode,
  steeringGain: number,
  throttleGain: number,
): Input {
  const gains = { normal: [0.7, 0.7], sport: [1, 1], precision: [0.45, 0.5] }[
    mode
  ];
  const steering = Math.abs(input.steering) < 4 ? 0 : input.steering;
  return {
    steering: clamp((steering * gains[0] * steeringGain) / 100, -100, 100),
    throttle:
      input.brake > 5
        ? 0
        : clamp((input.throttle * gains[1] * throttleGain) / 100, 0, 100),
    brake: clamp(input.brake, 0, 100),
  };
}
export function parseTelemetry(raw: string): Partial<Telemetry> | null {
  try {
    const message = JSON.parse(raw);
    if (
      message?.type !== "telemetry" ||
      !message.data ||
      typeof message.data !== "object"
    )
      return null;
    const data = message.data;
    const out: Partial<Telemetry> = {};
    const ranges = {
      speed: [0, 200],
      throttle: [0, 100],
      brake: [0, 100],
      steering: [-100, 100],
      battery: [0, 100],
      signal: [0, 100],
      temperature: [-50, 200],
    };
    for (const [key, range] of Object.entries(ranges)) {
      const k = key as keyof typeof ranges;
      if (typeof data[k] === "number" && Number.isFinite(data[k]))
        out[k] = clamp(data[k], range[0], range[1]);
      else if (
        data[k] === null &&
        ["speed", "battery", "signal", "temperature"].includes(k)
      )
        Object.assign(out, { [k]: null });
    }
    if (typeof data.connected === "boolean") out.connected = data.connected;
    if (typeof data.carEnabled === "boolean") out.carEnabled = data.carEnabled;
    for (const key of ["controlAvailable", "usbConnected"] as const)
      if (typeof data[key] === "boolean") out[key] = data[key];
    for (const key of ["port", "phase", "status"] as const)
      if (typeof data[key] === "string") out[key] = data[key].slice(0, 240);
    for (const key of ["relayMask", "requestedMask"] as const)
      if (Number.isInteger(data[key]) && data[key] >= 0 && data[key] <= 15)
        out[key] = data[key];
    if (data.relayMask === null) out.relayMask = null;
    if (Number.isInteger(data.raceId) && data.raceId >= 0) out.raceId = data.raceId;
    const usb = data.usbInput;
    if (
      usb &&
      ["steering", "throttle", "brake"].every(
        (k) => typeof usb[k] === "number" && Number.isFinite(usb[k]),
      )
    )
      out.usbInput = {
        steering: clamp(usb.steering, -100, 100),
        throttle: clamp(usb.throttle, 0, 100),
        brake: clamp(usb.brake, 0, 100),
      };
    const p = data.position;
    if (
      p &&
      [p.x, p.y, p.heading].every(
        (v) => typeof v === "number" && Number.isFinite(v),
      )
    )
      out.position = {
        x: clamp(p.x, 0, 100),
        y: clamp(p.y, 0, 100),
        heading: p.heading % 360,
      };
    else if (p === null) out.position = null;
    return Object.keys(out).length ? out : null;
  } catch {
    return null;
  }
}
