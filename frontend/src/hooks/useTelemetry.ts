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

/**
 * Live data from the server, for the real cars or the SIMULAÇÃO arena (virtual
 * cars on the server): the same protocol and the same rules in both, so the
 * simulation behaves exactly like the real event. `simulation` reconnects to the
 * chosen arena (the socket reads it from the URL).
 */
export function useTelemetry(simulation: boolean) {
  const [data, setData] = useState<Telemetry>(EMPTY_TELEMETRY);
  const [online, setOnline] = useState(false);
  const client = useRef<TelemetrySocket | null>(null);
  // send: the browser is the input source (no wheel seen by Windows).
  const current = useRef({ input: ZERO_INPUT, buttons: NO_BUTTONS, send: false });
  const updateControls = useCallback(
    (input: Input, buttons: Buttons, send: boolean) => {
      current.current = { input, buttons, send };
    },
    [],
  );
  useEffect(() => {
    setData(EMPTY_TELEMETRY);
    setOnline(false);
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
  return {
    data,
    online,
    updateControls,
    stop: () => client.current?.stopCar(),
    claimControl: () => client.current?.claimControl(),
    lap: () => client.current?.lap(),
    selfTest: () => client.current?.selfTest(),
    command: useCallback(
      (type: string, data: Record<string, unknown> = {}) => client.current?.command(type, data),
      [],
    ),
    setAutoTest: (enabled: boolean) => client.current?.setAutoTest(enabled),
    testRelay: (relay: number) => client.current?.testRelay(relay),
  };
}
