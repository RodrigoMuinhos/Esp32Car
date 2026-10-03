import { useCallback, useEffect, useRef, useState } from "react";
import {
  EMPTY_TELEMETRY,
  type Input,
  type Telemetry,
  ZERO_INPUT,
} from "../types/telemetry";
import { TelemetrySocket } from "../services/telemetrySocket";
import { holdOf, newRace, speedStep, stepRace, stopRace } from "../raceRules";
export function useTelemetry(simulation: boolean) {
  const [data, setData] = useState<Telemetry>(EMPTY_TELEMETRY);
  const [online, setOnline] = useState(false);
  const client = useRef<TelemetrySocket | null>(null);
  // send: the browser is the input source (no wheel seen by Windows).
  const current = useRef({ input: ZERO_INPUT, send: false });
  const race = useRef(newRace());
  const updateControls = useCallback((input: Input, send: boolean) => {
    current.current = { input, send };
  }, []);
  useEffect(() => {
    setData(EMPTY_TELEMETRY);
    setOnline(false);
    if (simulation) return;
    const heartbeat = () => {
      if (current.current.send) connection.control(current.current.input);
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
      stepRace(race.current, controls, now, speed);
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
          hold: holdOf(race.current, now),
          raceId: race.current.raceId,
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
    claimControl: () => client.current?.claimControl(),
    testRelay: (relay: number) => client.current?.testRelay(relay),
  };
}
