export type Input = { steering: number; throttle: number; brake: number };
export type RaceState =
  | "idle"
  | "starting"
  | "countdown"
  | "running"
  | "finished";
/** Wheel buttons: A (start), B (finish), X (emergency stop), Y (lap). */
export type Buttons = { start: boolean; finish: boolean; panic: boolean; lap: boolean };
export const NO_BUTTONS: Buttons = { start: false, finish: false, panic: false, lap: false };
/** 0 = free race; 3 or 5 = time trial that ends by itself on the last lap. */
export const RACE_MODES = [0, 3, 5] as const;
/** Result of the race that just ended (saved in the history database). */
export interface RaceResult {
  raceId: number;
  driver: string;
  durationMs: number;
  laps: number;
  bestLapMs: number | null;
  position: number | null;
  reason: string;
  targetLaps: number;
  completed: boolean;
  /** Position among completed time trials of the same length. */
  trialPosition: number | null;
  /** Car (slot number) that ran it; 0 or missing = unknown. */
  slot?: number;
  /** Its color (1..16), which names it. */
  color?: number;
}
/** One session (one participation, anonymous) in the event ranking. */
export interface EventRow {
  position: number;
  raceId: number;
  code: string | null;
  slot: number;
  color: number;
  bestLapMs: number;
  date: string;
  inTop: boolean;
}
export interface EventRanking {
  topN: number;
  total: number;
  /** Best lap of the Nth session: to enter the TOP N, beat it. Null until N sessions. */
  cutMs: number | null;
  rows: EventRow[];
}
export interface EventInfo {
  id: number;
  name: string;
  openedAt: string;
}
export interface Ranking {
  driver: string;
  totalRaces: number;
  totalMs: number;
  bestLaps: { driver: string; lapMs: number; date: string; raceId: number; slot?: number; color?: number }[];
  mostLaps: { driver: string; laps: number; durationMs: number; date: string; raceId: number; slot?: number; color?: number }[];
  timeTrials: Record<
    string,
    { driver: string; durationMs: number; bestLapMs: number | null; date: string; raceId: number; slot?: number; color?: number }[]
  >;
  recent: {
    id: number;
    driver: string;
    date: string;
    durationMs: number;
    laps: number;
    bestLapMs: number | null;
    reason: string;
    targetLaps: number;
    completed: boolean;
    slot?: number;
    color?: number;
  }[];
  /** The open event and its whole ranking (every session, the cut after the TOP N). */
  event?: (EventInfo & EventRanking) | null;
}
/** Live timing of a running race (ms). */
export interface RaceTimes {
  elapsedMs: number | null;
  laps: number;
  bestLapMs: number | null;
  lastLapMs: number | null;
  lastMarkMs: number | null;
}
/** One color slot as the operator panel sees it. */
export interface FleetSlot {
  number: number;
  name: string;
  driver: string;
  boardId: string | null;
  port: string | null;
  firmware: number | null;
  connected: boolean;
  wheel: number;
  wheelConnected: boolean;
  phase: string;
  countdown: number | null;
  enabled: boolean;
  mask: number;
  relayMask: number | null;
  input: Input;
  lapCount: number;
  raceMode: number;
  selfTest: { running: boolean; results: (boolean | null)[]; interrupted: boolean } | null;
  status: string;
  lastResult: RaceResult | null;
  times: RaceTimes;
  /** The car must not start now (see blockReason): shown as NÃO PODE RODAR. */
  blocked?: boolean;
  /** Color chosen for this slot (1..16): it names the car. */
  color?: number;
  /** This car's current session in the event ranking (anonymous: a code). */
  session?: { code: string | null; position: number; bestLapMs: number; inTop: boolean; total: number } | null;
  /** Last lap closed, saved at once: personal best / event record flags, age on the server clock. */
  lastLap?: { number: number; lapMs: number; personalBest: boolean; record: boolean; ageMs: number } | null;
  /** Time in use of the current battery charge (server clock; the operator marks on/off). */
  battery?: {
    on: boolean;
    usedMs: number;
    capacityMs: number;
    /** Charge left and its alert, decided by the server: 20% low, 10% critical, 5% stop. */
    percent?: number;
    alert?: "ok" | "low" | "critical" | "stop";
  } | null;
  /** One state per car, decided by the server (Central Técnica). */
  state?: UnitState;
  /** Why it cannot start, most important first (the screens point at that check). */
  blockReason?: "unconfigured" | "emergency" | "acceptance_running" | "battery" | "acceptance" | null;
  /** PARADA DE EMERGÊNCIA latched: nothing starts until RESET. */
  emergency?: boolean;
  /** Technical id (RC-03); the screens show "03 VERMELHO". */
  unitId?: string;
  acceptance?: AcceptanceSummary;
  link?: LinkInfo;
  /** Raw wheel axes (XInput: steering -32768..32767, pedals 0..255); null when not available. */
  raw?: { steering: number; throttle: number; brake: number } | null;
  /** Relay thresholds (%): below them the car does not react (dead zone). */
  deadzone?: { steering: number; pedals: number };
  log?: LogEntry[];
}
export type UnitState = "OFFLINE" | "CONNECTING" | "READY" | "TESTING" | "WARNING" | "FAULT" | "EMERGENCY_STOP";
export type TestStatus = "idle" | "testing" | "passed" | "failed";
export type AcceptanceItemId = "communication" | "steering" | "pedals" | "actuators" | "emergency" | "camera" | "audio";
export interface AcceptanceItem {
  id: AcceptanceItemId;
  label: string;
  critical: boolean;
  status: TestStatus;
  message: string;
  startedAt: string | null;
  finishedAt: string | null;
}
export interface AcceptanceSummary {
  items: AcceptanceItem[];
  running: boolean;
  current: AcceptanceItemId | null;
  /** What the running check needs from this panel. */
  waiting: "area" | "camera" | "audio" | null;
  /** All critical checks passed: the car may be released. */
  released: boolean;
  /** An event is open: the acceptance is required to start. */
  required: boolean;
  trigger: string | null;
  triggerText: string | null;
  lastRun: { result: "passed" | "failed"; at: string } | null;
  passed: number;
  total: number;
  failed: AcceptanceItemId[];
  criticalFailed: AcceptanceItemId[];
}
/** Link with the board over USB serial (no IP or RSSI: it is not Wi-Fi). */
export interface LinkInfo {
  port: string | null;
  firmware: number | null;
  boardId: string | null;
  /** Command sent -> ESTADO with the same mask (ms). */
  confirmMs: number | null;
  rateHz: number;
  late: number;
  restarts: number;
  reconnects: number;
  lastAckMs: number | null;
  uptimeMs?: number | null;
}
export interface LogEntry {
  at: string;
  severity: "info" | "success" | "warning" | "error";
  source: string;
  message: string;
}
export interface FleetAlert {
  id: number;
  kind: "record" | "top" | "out" | "cut";
  slot: number;
  color: number;
  at: string;
  lapMs?: number;
  position?: number;
  code?: string | null;
  topN?: number;
  slotOut?: number;
  colorOut?: number;
}
export interface FleetSetup {
  slot: number;
  color: number;
  step: "sync" | "confirm" | "comms";
  seen: { left: boolean; right: boolean; throttle: boolean; brake: boolean };
  input: { steering: number; throttle: number; brake: number } | null;
  board: boolean;
  pairing: boolean;
}
export interface Fleet {
  slots: FleetSlot[];
  spareBoards: {
    port: string;
    boardId: string | null;
    firmware: number | null;
    connected: boolean;
    selfTest: { running: boolean; results: (boolean | null)[]; interrupted: boolean };
  }[];
  classification: (RaceTimes & { slot: number; name: string; driver: string; position: number })[];
  pairing: number | null;
  autoTest: boolean;
  /** How many slots are configured; the next one shows + ADICIONAR CONTROLE. */
  available: number;
  /** How many slots can be configured: the cockpits, limited by the wheel channels (XInput: 4). */
  capacity: number;
  /** The setup wizard of the next slot, while it runs. */
  setup: FleetSetup | null;
  /** The open event (null: practice, laps do not count for records or ranking). */
  event: EventInfo | null;
  /** Event record: fastest lap of the open event. */
  record: { lapMs: number; at: string; slot: number; color: number; raceId: number; code?: string | null } | null;
  /** TOP N of the event (the first rows; the full list is in the ranking window). */
  ranking: EventRanking;
  /** Latest alerts for the operator, newest first; each id is shown once. */
  alerts: FleetAlert[];
  events: string[];
}
export interface SelfTest {
  running: boolean;
  results: (boolean | null)[];
  interrupted: boolean;
  auto: boolean;
}
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
  /** Seconds left in the 3-2-1 countdown, or null. */
  countdown: number | null;
  driver: string;
  lastResult: RaceResult | null;
  /** Laps marked in the running race. */
  lapCount: number;
  raceMode: number;
  /** Relay self-test: true = confirmed by the ESP32, false = no answer, null = not tested. */
  selfTest: SelfTest;
  /** Color slot of this screen (null = single-car backend). */
  slot: { number: number; name: string; color?: number } | null;
  times: RaceTimes | null;
  fleet: Fleet | null;
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
  countdown: null,
  driver: "Piloto",
  lastResult: null,
  lapCount: 0,
  raceMode: 0,
  selfTest: { running: false, results: [null, null, null, null], interrupted: false, auto: true },
  slot: null,
  times: null,
  fleet: null,
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
    if (typeof data.driver === "string") out.driver = data.driver.slice(0, 24);
    const result = data.lastResult;
    if (result === null) out.lastResult = null;
    else if (
      result &&
      Number.isInteger(result.raceId) &&
      typeof result.durationMs === "number" &&
      typeof result.driver === "string"
    )
      out.lastResult = {
        raceId: result.raceId,
        driver: result.driver.slice(0, 24),
        durationMs: result.durationMs,
        laps: Number.isInteger(result.laps) ? result.laps : 0,
        bestLapMs: typeof result.bestLapMs === "number" ? result.bestLapMs : null,
        position: Number.isInteger(result.position) ? result.position : null,
        reason: typeof result.reason === "string" ? result.reason.slice(0, 120) : "",
        targetLaps: Number.isInteger(result.targetLaps) ? result.targetLaps : 0,
        completed: result.completed === true,
        trialPosition: Number.isInteger(result.trialPosition) ? result.trialPosition : null,
        slot: Number.isInteger(result.slot) ? result.slot : 0,
        color: Number.isInteger(result.color) ? result.color : 0,
      };
    if (Number.isInteger(data.lapCount) && data.lapCount >= 0) out.lapCount = data.lapCount;
    if (RACE_MODES.includes(data.raceMode)) out.raceMode = data.raceMode;
    const test = data.selfTest;
    if (test && Array.isArray(test.results) && test.results.length === 4)
      out.selfTest = {
        running: test.running === true,
        interrupted: test.interrupted === true,
        auto: test.auto !== false,
        results: test.results.map((r: unknown) => (typeof r === "boolean" ? r : null)),
      };
    if (data.countdown === null) out.countdown = null;
    else if (typeof data.countdown === "number" && Number.isFinite(data.countdown))
      out.countdown = clamp(data.countdown, 0, 10);
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
    const slot = data.slot;
    if (slot && Number.isInteger(slot.number) && typeof slot.name === "string")
      out.slot = {
        number: slot.number,
        name: slot.name.slice(0, 20),
        color: Number.isInteger(slot.color) ? slot.color : slot.number,
      };
    if (data.times && typeof data.times === "object") out.times = data.times as RaceTimes;
    const fleet = data.fleet;
    // Any number of cockpits (a parameter of the installation, 1..16), never a fixed 4.
    if (fleet && Array.isArray(fleet.slots) && fleet.slots.length >= 1 && fleet.slots.length <= 16 && Array.isArray(fleet.spareBoards))
      out.fleet = {
        slots: fleet.slots,
        spareBoards: fleet.spareBoards,
        classification: Array.isArray(fleet.classification) ? fleet.classification : [],
        pairing: Number.isInteger(fleet.pairing) ? fleet.pairing : null,
        autoTest: fleet.autoTest !== false,
        available: Number.isInteger(fleet.available) ? clamp(fleet.available, 1, fleet.slots.length) : fleet.slots.length,
        capacity: Number.isInteger(fleet.capacity) ? fleet.capacity : fleet.slots.length,
        setup: fleet.setup && typeof fleet.setup === "object" && Number.isInteger(fleet.setup.slot) ? fleet.setup : null,
        record: fleet.record && typeof fleet.record.lapMs === "number" ? fleet.record : null,
        alerts: Array.isArray(fleet.alerts) ? fleet.alerts.filter((a: { id?: unknown }) => Number.isInteger(a?.id)) : [],
        event: fleet.event && typeof fleet.event.name === "string" ? fleet.event : null,
        ranking:
          fleet.ranking && Array.isArray(fleet.ranking.rows)
            ? fleet.ranking
            : { topN: 8, total: 0, cutMs: null, rows: [] },
        events: Array.isArray(fleet.events) ? fleet.events.filter((e: unknown) => typeof e === "string") : [],
      } as Fleet;
    return Object.keys(out).length ? out : null;
  } catch {
    return null;
  }
}
