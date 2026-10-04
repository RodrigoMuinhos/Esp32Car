import { useCallback, useEffect, useRef, useState } from "react";
import {
  EMPTY_TELEMETRY,
  NO_BUTTONS,
  type Buttons,
  type Input,
  type Telemetry,
  ZERO_INPUT,
} from "../types/telemetry";
import { TelemetrySocket } from "../services/telemetrySocket";
import {
  countdownOf,
  newRace,
  speedStep,
  stepRace,
  stopRace,
} from "../raceRules";
export function useTelemetry(simulation: boolean) {
  const [data, setData] = useState<Telemetry>(EMPTY_TELEMETRY);
  const [online, setOnline] = useState(false);
  const client = useRef<TelemetrySocket | null>(null);
  // send: the browser is the input source (no wheel seen by Windows).
  const current = useRef({ input: ZERO_INPUT, buttons: NO_BUTTONS, send: false });
  const race = useRef(newRace());
  // On-screen A/B buttons of the simulation: held for a few frames, then released.
  const tapped = useRef({ ...NO_BUTTONS, until: 0 });
  const updateControls = useCallback(
    (input: Input, buttons: Buttons, send: boolean) => {
      current.current = { input, buttons, send };
    },
    [],
  );
  useEffect(() => {
    setData(EMPTY_TELEMETRY);
    setOnline(false);
    if (simulation) return;
    const heartbeat = () => {
      if (current.current.send)
        connection.control(current.current.input, current.current.buttons);
    };
    const connection = new TelemetrySocket(
      (update) => {
        setData((old) => ({ ...old, ...update }));
        // Background tabs throttle timers to ~1 s; incoming telemetry (20 Hz)
        // is not throttled, so it also drives the input heartbeat.
        heartbeat();
      },
      (connected) => {
        setOnline(connected);
        if (!connected) setData(EMPTY_TELEMETRY);
      },
    );
    client.current = connection;
    connection.connect();
    const timer = window.setInterval(heartbeat, 40);
    return () => {
      clearInterval(timer);
      connection.close();
      client.current = null;
    };
  }, [simulation]);
  useEffect(() => {
    if (!simulation) return;
    race.current = newRace();
    let frame = 0,
      last = performance.now(),
      travel = 0,
      speed = 0,
      publish = 0;
    const tick = (now: number) => {
      const dt = Math.min((now - last) / 1000, 0.1);
      last = now;
      const controls = current.current.input;
      const tap = now < tapped.current.until ? tapped.current : NO_BUTTONS;
      stepRace(
        race.current,
        controls,
        {
          start: current.current.buttons.start || tap.start,
          finish: current.current.buttons.finish || tap.finish,
        },
        now,
      );
      const active = race.current.phase === "running";
      speed = speedStep(speed, controls, active, dt);
      travel += (speed * dt) / 55;
      if (now - publish > 32) {
        publish = now;
        setData({
          ...EMPTY_TELEMETRY,
          ...controls,
          connected: true,
          speed,
          battery: 87,
          signal: 100,
          temperature: 28 + speed / 5,
          carEnabled: active,
          phase: race.current.phase,
          raceId: race.current.raceId,
          countdown: countdownOf(race.current, now),
          status: race.current.status,
          position: {
            x: 50 + 39 * Math.cos(travel),
            y: 50 + 24 * Math.sin(travel),
            heading: (travel * 180) / Math.PI + 90,
          },
        });
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [simulation]);
  return {
    data,
    online,
    updateControls,
    stop: () => {
      if (simulation)
        stopRace(
          race.current,
          race.current.phase === "running"
            ? "Corrida encerrada pelo painel."
            : "Relés desligados.",
        );
      else client.current?.stopCar();
    },
    /** Simulation only: press A (start) or B (finish) from the screen. */
    tap: (button: keyof Buttons) => {
      tapped.current = { ...NO_BUTTONS, [button]: true, until: performance.now() + 120 };
    },
    claimControl: () => client.current?.claimControl(),
    lap: () => client.current?.lap(),
    setDriver: (name: string) => client.current?.setDriver(name),
    testRelay: (relay: number) => client.current?.testRelay(relay),
  };
}
