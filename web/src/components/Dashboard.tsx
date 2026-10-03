import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowUpRight,
  CircleHelp,
  Flag,
  Maximize,
  Play,
  Radio,
  RotateCcw,
  Square,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import { useControls } from "../hooks/useControls";
import { useTelemetry } from "../hooks/useTelemetry";
import { useRaceTimer } from "../hooks/useRaceTimer";
import { useEstimatedSpeed } from "../hooks/useEstimatedSpeed";
import { usePortrait } from "../hooks/usePortrait";
import { useRaceAudio } from "../audio/useRaceAudio";
import { MAX_SPEED } from "../raceRules";
import {
  NO_BUTTONS,
  processInput,
  SIMULATION_MODE,
  ZERO_INPUT,
  type DriveMode,
  type Input,
  type RaceState,
} from "../types/telemetry";
import {
  CarStatus,
  ControlSettings,
  HeaderStatus,
  InputSource,
  PedalsPanel,
  PowerGauge,
  Speedometer,
  StartSequence,
  SteeringPanel,
  TimingPanel,
  TrackMap,
  RelayPanel,
} from "./Widgets";

export function Dashboard() {
  const [simulation, setSimulation] = useState(
    () =>
      new URLSearchParams(window.location.search).get("mode") ===
        "simulation" || SIMULATION_MODE,
  );
  const [mode, setMode] = useState<DriveMode>("sport");
  const [steeringGain, setSteeringGain] = useState(100);
  const [throttleGain, setThrottleGain] = useState(100);
  const [manual, setManual] = useState<Input>(ZERO_INPUT);
  const [source, setSource] = useState<"manual" | "usb">(() =>
    simulation ? "manual" : "usb",
  );
  const [help, setHelp] = useState(false);
  const [notice, setNotice] = useState("Pronto para uma nova sessão.");
  const gamepad = useControls();
  const { data, online, stop, testRelay, updateControls, claimControl, tap } =
    useTelemetry(simulation);
  const usbConnected =
    !!gamepad?.supported || (!simulation && online && data.usbConnected);
  // Windows/XInput reading comes from the backend and keeps working while the
  // panel is in the background; the Gamepad API stops when the page loses focus.
  const usbInput =
    !simulation && online && data.usbConnected
      ? data.usbInput
      : gamepad?.supported
        ? gamepad.input
        : ZERO_INPUT;
  const raw = source === "usb" ? usbInput : manual;
  const input = processInput(raw, mode, steeringGain, throttleGain);
  // Race rules live in backend/control.py (A = 3-2-1 countdown, throttle 0.5 s,
  // B or 15 s idle to finish); the panel only shows the state. Simulation runs
  // the same rules locally.
  const state: RaceState = (
    ["starting", "countdown", "running", "finished"] as const
  ).find((phase) => phase === data.phase) ?? "idle";
  const enabled = state === "running" && data.carEnabled;
  const busy = state === "starting" || state === "countdown" || state === "running";
  const buttons =
    source === "usb" && gamepad?.supported ? gamepad.buttons : NO_BUTTONS;
  const linkReady =
    simulation || (online && data.connected && data.controlAvailable);
  // In real mode the panel only feeds input when Windows sees no wheel.
  const sendInput =
    !simulation && online && !data.usbConnected && !!gamepad?.supported;
  useEffect(
    () => updateControls(input, buttons, sendInput),
    [
      input.steering,
      input.throttle,
      input.brake,
      buttons.start,
      buttons.finish,
      sendInput,
      updateControls,
    ],
  );
  const timer = useRaceTimer(enabled);
  // No speed sensor on the car: show an imaginary speed proportional to the throttle.
  const estimatedSpeed = useEstimatedSpeed(input, enabled);
  const sound = useRaceAudio({
    state,
    countdown: data.countdown,
    status: data.status,
    throttle: input.throttle,
    brake: input.brake,
    speed: data.speed ?? estimatedSpeed,
  });
  const resetTimer = timer.reset;
  // The clock only shows the race in progress: it returns to zero whenever the
  // race stops (brake, inactivity, PARAR/ESC or connection loss).
  useEffect(() => {
    if (!enabled) resetTimer();
  }, [enabled, resetTimer]);
  const stopRef = useRef(stop);
  stopRef.current = stop;
  const halt = useCallback(
    (message = "Corrida encerrada. Relés desligados.") => {
      stopRef.current();
      setManual(ZERO_INPUT);
      setNotice(message);
    },
    [],
  );
  useEffect(() => {
    const escape = (e: KeyboardEvent) => {
      if (
        e.key === "Escape" ||
        (e.code === "Space" &&
          !(
            e.target instanceof HTMLInputElement ||
            e.target instanceof HTMLSelectElement ||
            e.target instanceof HTMLButtonElement
          ))
      ) {
        e.preventDefault();
        halt("Parada acionada pelo teclado.");
      }
    };
    window.addEventListener("keydown", escape);
    return () => window.removeEventListener("keydown", escape);
  }, [halt]);
  function changeMode(next: boolean) {
    halt();
    setSimulation(next);
    setSource(next ? "manual" : "usb");
    timer.reset();
    setNotice(
      next
        ? "Simulação local. Nenhum comando enviado ao carrinho."
        : "Aguardando backend local em localhost:8080.",
    );
  }
  const display = simulation
    ? data
    : { ...data, connected: online && data.connected };
  // The vertical frame has one extra slot: the track takes the large panel and
  // the relays the side card, in both modes. Landscape has a single slot.
  const portrait = usePortrait();
  const trackMap = (
    <TrackMap
      position={display.position}
      simulation={simulation}
      enabled={enabled}
    />
  );
  const relayPanel = (
    <RelayPanel
      // Simulation never talks to the board: no "take control" prompt there.
      telemetry={simulation ? { ...display, controlAvailable: true } : display}
      available={
        !simulation && linkReady && !busy && data.phase !== "pulse"
      }
      onTest={testRelay}
      onStop={() => halt()}
      onClaim={claimControl}
    />
  );
  return (
    <main className="cockpit">
      <header className="header">
        <a className="brand" href="/" aria-label="RC Racing System">
          <span className="brand-mark">
            <Flag size={23} />
          </span>
          <div>
            <strong>
              RC<span>RACING</span>
            </strong>
            <small>TELEMETRY & CONTROL SYSTEM</small>
          </div>
        </a>
        <div className="header-center">
          <span className="live-dot" /> LIVE COCKPIT{" "}
          <span className="header-divider">/</span>
          <span>SESSÃO LOCAL</span>
        </div>
        <HeaderStatus
          connected={display.connected}
          signal={display.signal}
          battery={display.battery}
          simulation={simulation}
        />
        <button
          className="icon-button sound-toggle"
          aria-label={sound.muted ? "Ligar som" : "Desligar som"}
          title={sound.muted ? "Ligar som" : "Desligar som"}
          aria-pressed={!sound.muted}
          onClick={sound.toggleMuted}
        >
          {sound.muted ? <VolumeX size={17} /> : <Volume2 size={17} />}
          <span
            className="sound-meter"
            ref={(el) => {
              sound.meter.current = el;
            }}
            aria-hidden="true"
          >
            <i />
            <i />
            <i />
            <i />
          </span>
        </button>
        <button
          className="icon-button fullscreen"
          aria-label="Tela cheia"
          onClick={() => {
            if (document.fullscreenElement) void document.exitFullscreen();
            else
              void document.documentElement
                .requestFullscreen()
                .catch(() =>
                  setNotice("Tela cheia indisponível neste navegador."),
                );
          }}
        >
          <Maximize size={17} />
        </button>
      </header>
      <div className="session-bar">
        <div>
          <span className="eyebrow">CENTRAL DE OPERAÇÕES</span>
          <h1>
            Seu carrinho. <span>Em tempo real.</span>
          </h1>
        </div>
        <div className="session-actions">
          <div className="environment-toggle" aria-label="Modo de conexão">
            <button
              className={simulation ? "active" : ""}
              onClick={() => changeMode(true)}
              disabled={busy}
            >
              SIMULAÇÃO
            </button>
            <button
              className={!simulation ? "active" : ""}
              onClick={() => changeMode(false)}
              disabled={busy}
            >
              <Radio size={13} /> CARRINHO REAL
            </button>
          </div>
          <button
            className="icon-button"
            onClick={() => setHelp(true)}
            aria-label="Ajuda"
          >
            <CircleHelp size={18} />
          </button>
        </div>
      </div>
      <div className="dashboard">
        <div className="left-column">
          <Speedometer
            speed={display.speed ?? (simulation ? null : estimatedSpeed)}
            maxSpeed={MAX_SPEED}
            simulation={simulation}
            estimated={!simulation && display.speed === null}
          />
          <SteeringPanel steering={input.steering} raw={raw.steering} />
        </div>
        <div className="center-column">
          <StartSequence state={state} status={data.status} countdown={data.countdown} />
          <div className="slot-hero">
            {simulation || portrait ? trackMap : relayPanel}
          </div>
        </div>
        {portrait && (
          <div className="slot-side">{relayPanel}</div>
        )}
        <div className="right-column">
          <PowerGauge power={input.throttle} enabled={enabled} />
          <PedalsPanel throttle={raw.throttle} brake={raw.brake} />
        </div>
        <div className="bottom-row">
          <CarStatus telemetry={display} simulation={simulation} />
          <TimingPanel timer={timer} running={enabled} />
          <ControlSettings
            mode={mode}
            setMode={setMode}
            steering={steeringGain}
            setSteering={setSteeringGain}
            throttle={throttleGain}
            setThrottle={setThrottleGain}
            locked={busy}
          />
        </div>
      </div>
      <div className="control-dock">
        <div className="input-controls">
          <div className="source-select">
            <span>ENTRADA</span>
            <select
              aria-label="Fonte dos comandos"
              value={source}
              disabled={busy}
              onChange={(e) => {
                setSource(e.target.value as "manual" | "usb");
                setManual(ZERO_INPUT);
              }}
            >
              <option value="manual" disabled={!simulation}>
                Controles de teste
              </option>
              <option value="usb">Volante USB</option>
            </select>
          </div>
          {source === "manual" ? (
            <div className="test-sliders">
              {(
                [
                  { key: "steering", label: "DIREÇÃO", min: -100 },
                  { key: "throttle", label: "ACELERADOR", min: 0 },
                  { key: "brake", label: "FREIO", min: 0 },
                ] as const
              ).map((c) => (
                <label key={c.key}>
                  {c.label}
                  <b>{Math.round(manual[c.key])}%</b>
                  <input
                    aria-label={`Teste ${c.label.toLowerCase()}`}
                    type="range"
                    min={c.min}
                    max="100"
                    value={manual[c.key]}
                    onChange={(e) =>
                      setManual((old) => ({ ...old, [c.key]: +e.target.value }))
                    }
                  />
                </label>
              ))}
            </div>
          ) : (
            <div className="usb-instructions">
              <InputSource
                name={
                  gamepad?.supported
                    ? gamepad.name
                    : data.usbConnected
                      ? "Volante USB · Windows"
                      : gamepad?.name
                }
                supported={usbConnected}
              />
              <span>RT / RB acelera · LT / LB aciona K2 · eixo X dirige</span>
            </div>
          )}
        </div>
        <div className="race-actions">
          <button
            className="reset-button icon-button"
            title="Zerar sessão"
            aria-label="Zerar sessão"
            disabled={busy}
            onClick={() => {
              timer.reset();
              setManual(ZERO_INPUT);
            }}
          >
            <RotateCcw size={17} />
          </button>
          {simulation ? (
            // Simulation has no wheel buttons by default: press A/B on screen.
            <button
              className="start-button"
              onClick={() =>
                tap(state === "countdown" || state === "running" ? "finish" : "start")
              }
            >
              <Play size={15} fill="currentColor" />
              {state === "running"
                ? "FINALIZAR (B)"
                : state === "countdown"
                  ? "CANCELAR (B)"
                  : "INICIAR (A)"}
            </button>
          ) : (
            <div className="start-button race-hint" aria-live="polite">
              <Play size={15} fill="currentColor" />
              {state === "running"
                ? "BOTÃO B FINALIZA"
                : state === "countdown"
                  ? "PREPARE-SE"
                  : "A OU ACELERADOR 0,5s"}
            </div>
          )}
          <button className="stop-button" onClick={() => halt()}>
            <Square size={14} fill="currentColor" /> PARAR <kbd>ESC</kbd>
          </button>
        </div>
      </div>
      <footer>
        <span>
          <i className={`tiny-dot ${enabled ? "green-dot" : ""}`} />
          {state === "running"
            ? "Corrida ativa · B finaliza · 15 s sem acelerar encerra."
            : busy
              ? data.status
              : !simulation
              ? online && !data.controlAvailable
                ? "Outra janela está controlando. Clique em Assumir controle para usar esta tela."
                : data.status
              : data.status || notice}
        </span>
        <span>
          {simulation
            ? "DADOS SIMULADOS · SEM ACIONAMENTO FÍSICO"
            : online
              ? `ESP32 · ${data.port} · ${data.connected ? "CONECTADO" : "AGUARDANDO PLACA"}`
              : "BACKEND DESCONECTADO"}
          <ArrowUpRight size={12} />
        </span>
      </footer>
      {help && (
        <div className="modal-backdrop" onClick={() => setHelp(false)}>
          <section
            className="help-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="help-title"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              autoFocus
              className="icon-button close-modal"
              aria-label="Fechar ajuda"
              onClick={() => setHelp(false)}
            >
              <X />
            </button>
            <span className="eyebrow">GUIA RÁPIDO</span>
            <h2 id="help-title">Tudo pronto para a largada.</h2>
            <p>
              Aperte A no volante para a contagem 3, 2, 1, GO, ou segure o
              acelerador por 0,5 segundo para largar na hora. B finaliza; 15
              segundos sem acelerar também encerram. Na simulação, use INICIAR
              (A) e FINALIZAR (B) ou o volante USB. O alto-falante no topo liga
              e desliga o som do motor.
            </p>
            <p>
              O volante visual e os pedais mostram a entrada física.
              Sensibilidade e modo ajustam a saída enviada. O botão com a
              bandeira registra uma volta manualmente.
            </p>
            <p>
              Velocidade, posição, bateria, sinal e temperatura são fictícios na
              simulação. O mapa usa a imagem da sua pista; o percurso virtual é
              ilustrativo.
            </p>
            <p>
              O modo real conecta automaticamente à placa. Os botões K1–K4
              testam cada relé por 0,5 segundo com a sessão parada. As luzes
              mostram a confirmação recebida do ESP32. Velocidade, bateria e
              localização ficam sem dados enquanto não houver sensores.
            </p>
            <p>
              O volante é detectado pelo Windows ou pelo navegador. Trocar de
              janela ou fechar o painel não para a corrida; ESC, PARAR ou
              desconexão desligam os relés.
            </p>
            <button className="start-button" onClick={() => setHelp(false)}>
              ENTENDI <ArrowUpRight size={16} />
            </button>
          </section>
        </div>
      )}
    </main>
  );
}
