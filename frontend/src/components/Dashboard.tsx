import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowUpRight, CircleHelp, Flag, FlaskConical, Maximize, Radio, Trophy, Volume2, VolumeX, X } from "lucide-react";
import { useControls } from "../hooks/useControls";
import { useTelemetry } from "../hooks/useTelemetry";
import { useEstimatedSpeed } from "../hooks/useEstimatedSpeed";
import { useRaceAudio } from "../audio/useRaceAudio";
import { simulationArena } from "../arena";
import { RankingModal } from "./Ranking";
import { SoundPanel } from "./SoundPanel";
import { RaceOverlay } from "./RaceOverlay";
import { PilotView } from "./PilotView";
import { TelaoView } from "./TelaoView";
import { RecordAlert } from "./EventRecord";
import { TechnicalCentral } from "./TechnicalCentral";
import { LiveMechanicGrid, MECH_LAYOUTS, MechanicRail, type MechLayout } from "./MechanicGrid";
import { carInfo, pageSlot } from "../slots";
import { NO_BUTTONS, processInput, ZERO_INPUT, type Fleet, type RaceState } from "../types/telemetry";
import { HeaderStatus } from "./Widgets";

type View = "mecanico" | "piloto" | "corrida";
const VIEWS: View[] = ["mecanico", "piloto", "corrida"];

/**
 * The panel. Same screens for the real cars and for SIMULAÇÃO (virtual cars and
 * drivers on the server, own database): only the arena changes, and it is always
 * shown. The server decides every state; the panel shows it and sends commands.
 */
export function Dashboard() {
  const [simulation, setSimulation] = useState(simulationArena);
  const [help, setHelp] = useState(false);
  // Ranking: opened from the header, or automatically with the result of a race.
  const [ranking, setRanking] = useState<null | "header" | "result">(null);
  const [soundOpen, setSoundOpen] = useState(false);
  const [view, setView] = useState<View>(() => {
    const asked = new URLSearchParams(window.location.search).get("view");
    if (VIEWS.includes(asked as View)) return asked as View;
    try {
      const saved = localStorage.getItem("rc-racing-view") as View;
      return VIEWS.includes(saved) ? saved : "mecanico";
    } catch {
      return "mecanico";
    }
  });
  const chooseView = (next: View) => {
    setView(next);
    try {
      localStorage.setItem("rc-racing-view", next);
    } catch {
      /* per-viewer preference only */
    }
  };
  // Visão Mecânico: grid of 4 by default; 8 and 16 for bigger events; 1 = the
  // Central Técnica of one car (?grade=N keeps the choice on reload).
  const [mechLayout, setMechLayout] = useState<MechLayout>(() => {
    const asked = Number(new URLSearchParams(window.location.search).get("grade"));
    return MECH_LAYOUTS.includes(asked as MechLayout) ? (asked as MechLayout) : 4;
  });
  // Car picked in the grid: the one the INDIVIDUAL tab opens.
  const [selectedCar, setSelectedCar] = useState(pageSlot);
  // Central Técnica: wheel and pedals live (calibration on); can be frozen.
  const [calibrating, setCalibrating] = useState(true);
  const calibration = { on: calibrating, toggle: () => setCalibrating((on) => !on) };
  // The mechanic grid lives apart from this panel (which redraws on every message):
  // it reads the fleet through a ref and gets stable callbacks.
  const fleetRef = useRef<Fleet | null>(null);
  const gridActions = useRef({ open: (_: number) => {}, select: (_: number) => {}, command: (_: string, __?: Record<string, unknown>) => {} });
  const gridOpen = useCallback((number: number) => gridActions.current.open(number), []);
  const gridSelect = useCallback((number: number) => gridActions.current.select(number), []);
  const gridCommand = useCallback((type: string, data?: Record<string, unknown>) => gridActions.current.command(type, data), []);
  const closeSound = useCallback(() => setSoundOpen(false), []);
  const gamepad = useControls();
  const { data, online, stop, testRelay, updateControls, claimControl, command, selfTest, setAutoTest } = useTelemetry(simulation);
  const usbConnected = !!gamepad?.supported || (online && data.usbConnected);
  // Windows/XInput reading comes from the server and keeps working while the
  // panel is in the background; the browser gamepad is only a fallback.
  const raw = online && data.usbConnected ? data.usbInput : gamepad?.supported ? gamepad.input : ZERO_INPUT;
  const input = processInput(raw, "sport", 100, 100);
  const state: RaceState = (["starting", "countdown", "running", "finished"] as const).find((phase) => phase === data.phase) ?? "idle";
  const enabled = state === "running" && data.carEnabled;
  const busy = state === "starting" || state === "countdown" || state === "running";
  const buttons = gamepad?.supported ? gamepad.buttons : NO_BUTTONS;
  const linkReady = online && data.connected && data.controlAvailable;
  // Real cars only: the panel feeds the browser wheel when Windows sees none.
  const sendInput = !simulation && online && !data.usbConnected && !!gamepad?.supported;
  useEffect(
    () => updateControls(input, buttons, sendInput),
    [input.steering, input.throttle, input.brake, buttons.start, buttons.finish, sendInput, updateControls],
  );
  // No speed sensor on the car: an imaginary speed proportional to the throttle.
  const estimatedSpeed = useEstimatedSpeed(input, enabled);
  // Show the result when a newly saved race arrives (not the one from before the panel opened).
  const seenResult = useRef<number | null | undefined>(undefined);
  useEffect(() => {
    const id = data.lastResult?.raceId ?? null;
    if (seenResult.current !== undefined && id !== null && id !== seenResult.current) setRanking("result");
    if (online) seenResult.current = id;
  }, [data.lastResult?.raceId, online]);
  // A new start closes the ranking so the countdown is visible.
  useEffect(() => {
    if (state === "countdown" || state === "running") setRanking(null);
  }, [state]);
  const sound = useRaceAudio({
    state,
    countdown: data.countdown,
    status: data.status,
    throttle: input.throttle,
    brake: input.brake,
    steering: input.steering,
    speed: data.speed ?? estimatedSpeed,
    lapCount: data.lapCount,
  });
  const stopRef = useRef(stop);
  stopRef.current = stop;
  const halt = useCallback(() => stopRef.current(), []);
  useEffect(() => {
    const escape = (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement || e.target instanceof HTMLButtonElement;
      if (e.key === "Escape" || (e.code === "Space" && !typing)) {
        e.preventDefault();
        halt();
      }
    };
    window.addEventListener("keydown", escape);
    return () => window.removeEventListener("keydown", escape);
  }, [halt]);
  // Shortcuts between the views: F6 Mecânico, F7 Piloto, F8 Corrida (not on the audience screen).
  const chooseViewRef = useRef(chooseView);
  chooseViewRef.current = chooseView;
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("tela") === "telao") return;
    const keys: Record<string, View> = { F6: "mecanico", F7: "piloto", F8: "corrida" };
    const shortcut = (e: KeyboardEvent) => {
      const next = keys[e.key];
      if (!next) return;
      e.preventDefault();
      chooseViewRef.current(next);
    };
    window.addEventListener("keydown", shortcut);
    return () => window.removeEventListener("keydown", shortcut);
  }, []);
  const setParams = (changes: Record<string, string | null>) => {
    const params = new URLSearchParams(window.location.search);
    for (const [key, value] of Object.entries(changes)) {
      if (value === null) params.delete(key);
      else params.set(key, value);
    }
    return params;
  };
  // Real cars or SIMULAÇÃO: the arena goes in the URL first (the socket and the
  // ranking read it), then the panel reconnects.
  function changeArena(next: boolean) {
    if (next === simulation) return;
    halt();
    window.history.replaceState(null, "", `?${setParams({ mode: next ? "simulation" : null })}`);
    setSimulation(next);
  }
  // This screen's slot (cockpit tablet ?vaga=N, or the car opened in the Central Técnica).
  const mySlotNumber = data.slot?.number ?? pageSlot();
  const mySlot = { ...carInfo(data.slot?.color ?? mySlotNumber), number: mySlotNumber };
  const isCentralPc = ["localhost", "127.0.0.1"].includes(window.location.hostname);
  // Open one car in the Central Técnica (another car: reconnect as its slot).
  const openCar = (number: number) => {
    if (number !== mySlot.number && !isCentralPc) return; // a cockpit tablet stays on its own car
    if (number === mySlot.number) {
      setMechLayout(1);
      window.history.replaceState(null, "", `?${setParams({ grade: "1", vaga: String(number) })}`);
      return;
    }
    window.location.search = setParams({ vaga: String(number), view: "mecanico", grade: "1" }).toString();
  };
  const chooseMechLayout = (next: MechLayout) => {
    if (next === 1) return openCar(selectedCar);
    setMechLayout(next);
    window.history.replaceState(null, "", `?${setParams({ grade: String(next) })}`);
  };
  const selectCar = (number: number) => {
    if (!isCentralPc && number !== mySlot.number) return;
    setSelectedCar(number);
    window.history.replaceState(null, "", `?${setParams({ vaga: String(number) })}`);
  };
  const centralSlot = view === "mecanico" && mechLayout === 1 ? (data.fleet?.slots[mySlot.number - 1] ?? null) : null;
  fleetRef.current = data.fleet;
  gridActions.current = { open: openCar, select: selectCar, command };
  const arena = simulation ? "arena-sim" : "arena-real";
  // Big screen for the audience: camera + standings only.
  if (new URLSearchParams(window.location.search).get("tela") === "telao")
    return (
      <main className={`cockpit telao-mode ${arena}`}>
        <TelaoView fleet={data.fleet} />
      </main>
    );
  const mode =
    view === "piloto"
      ? "pilot-mode"
      : view === "corrida"
        ? "race-mode"
        : mechLayout === 1
          ? "mech-mode mech-grid-mode tc-mode"
          : "mech-mode mech-grid-mode";
  return (
    <main
      className={`cockpit ${mode} ${arena}`}
      style={{ "--slot-color": mySlot.color, "--slot-accent": mySlot.accent } as React.CSSProperties}
    >
      {view === "mecanico" && <MechanicRail layout={mechLayout} onLayout={chooseMechLayout} />}
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
        <nav className="view-tabs" aria-label="Visões">
          {(
            [
              ["mecanico", "VISÃO MECÂNICO"],
              ["piloto", "VISÃO PILOTO"],
              ["corrida", "VISÃO CORRIDA"],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              className={view === key ? "active" : ""}
              aria-pressed={view === key}
              title={`Atalho: ${{ mecanico: "F6", piloto: "F7", corrida: "F8" }[key]}`}
              onClick={() => chooseView(key)}
            >
              {label}
            </button>
          ))}
        </nav>
        <HeaderStatus connected={online && data.connected} signal={data.signal} battery={data.battery} simulation={simulation} />
        <button className="icon-button ranking-button" aria-label="Ranking" title="Ranking e histórico" onClick={() => setRanking("header")}>
          <Trophy size={17} />
        </button>
        <span className="sound-anchor">
          <button
            className="icon-button sound-toggle"
            aria-label="Som"
            title="Som e volume"
            aria-expanded={soundOpen}
            aria-pressed={!sound.muted}
            onClick={() => setSoundOpen((open) => !open)}
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
          {soundOpen && (
            <SoundPanel
              muted={sound.muted}
              onToggleMuted={sound.toggleMuted}
              volumes={sound.volumes}
              onVolume={sound.setVolume}
              onPreview={sound.preview}
              onClose={closeSound}
            />
          )}
        </span>
        <button
          className="icon-button fullscreen"
          aria-label="Tela cheia"
          onClick={() => {
            if (document.fullscreenElement) void document.exitFullscreen();
            else void document.documentElement.requestFullscreen().catch(() => undefined);
          }}
        >
          <Maximize size={17} />
        </button>
      </header>
      <div className="session-bar">
        {centralSlot ? (
          <div>
            <span className="eyebrow">CENTRAL TÉCNICA</span>
            <h1>
              {String(mySlot.number).padStart(2, "0")} {mySlot.name}. <span>Verificação, diagnóstico e operação.</span>
            </h1>
          </div>
        ) : (
          <div>
            <span className="eyebrow">CENTRAL DE OPERAÇÕES</span>
            <h1>
              Race Control. <span>Operação técnica em tempo real.</span>
            </h1>
          </div>
        )}
        <div className="session-actions">
          {simulation && (
            <span className="arena-badge" role="status">
              <FlaskConical size={13} /> SIMULAÇÃO · CARRINHOS VIRTUAIS · NADA MOVE CARRINHO REAL
            </span>
          )}
          <div className="environment-toggle" aria-label="Modo de conexão">
            <button className={simulation ? "active" : ""} onClick={() => changeArena(true)} disabled={busy}>
              SIMULAÇÃO
            </button>
            <button className={!simulation ? "active" : ""} onClick={() => changeArena(false)} disabled={busy}>
              <Radio size={13} /> CARRINHO REAL
            </button>
          </div>
          {centralSlot && (
            <span className={`env-port ${data.connected ? "online" : ""}`}>
              <i /> {data.port} · {data.connected ? "ONLINE" : "OFFLINE"}
            </span>
          )}
          <button className="icon-button" onClick={() => setHelp(true)} aria-label="Ajuda">
            <CircleHelp size={18} />
          </button>
        </div>
      </div>
      {!online ? (
        <p className="fleet-wait" role="status">
          {simulation ? "Conectando à simulação do servidor…" : "Conectando ao servidor da corrida no PC Central…"}
        </p>
      ) : view === "corrida" ? (
        // Visão Corrida = the big screen itself (the race operation is in the Visão Mecânico).
        <TelaoView fleet={data.fleet} onExit={() => chooseView("mecanico")} />
      ) : view === "piloto" ? (
        <PilotView
          slotNumber={mySlot.number}
          colorNumber={data.slot?.color}
          fleet={data.fleet}
          state={state}
          countdown={data.countdown}
          raceMode={data.raceMode}
          lapCount={data.lapCount}
          session={data.times?.elapsedMs ?? 0}
          times={data.times}
          best={data.times?.bestLapMs ?? null}
          speed={data.speed ?? estimatedSpeed}
          connected={data.connected}
          wheelConnected={usbConnected}
          onExit={() => chooseView("mecanico")}
        />
      ) : mechLayout !== 1 ? (
        <LiveMechanicGrid
          source={fleetRef}
          operator={isCentralPc}
          command={gridCommand}
          layout={mechLayout}
          onOpen={gridOpen}
          selected={selectedCar}
          onSelect={gridSelect}
        />
      ) : centralSlot && data.fleet ? (
        <TechnicalCentral
          slot={centralSlot}
          fleet={data.fleet}
          telemetry={{ ...data, connected: online && data.connected }}
          operator={isCentralPc}
          command={command}
          calibration={calibration}
          raw={raw}
          steering={input.steering}
          muted={sound.muted}
          onTestSound={sound.testSound}
          relays={{
            available: linkReady && !busy && data.phase !== "pulse",
            onTest: testRelay,
            onStop: halt,
            onClaim: claimControl,
            onSelfTest: selfTest,
            onAutoTest: setAutoTest,
          }}
        />
      ) : (
        <p className="fleet-wait" role="status">Aguardando a frota do servidor…</p>
      )}
      <footer>
        <span>
          <i className={`tiny-dot ${enabled ? "green-dot" : ""}`} />
          {online && !data.controlAvailable ? "Outra janela está controlando. Clique em Assumir controle para usar esta tela." : data.status}
        </span>
        <span>
          {simulation ? "SIMULAÇÃO · " : ""}
          {online ? `PLACA · ${data.port} · ${data.connected ? "CONECTADA" : "AGUARDANDO PLACA"}` : "SERVIDOR DESCONECTADO"}
          <ArrowUpRight size={12} />
        </span>
      </footer>
      {/* The big screen shows its own countdown, record and result. */}
      {view !== "corrida" && <RaceOverlay state={state} countdown={data.countdown} status={data.status} />}
      {/* New event record: the operator screens (PC Central) only, never the cockpit tablets. */}
      {isCentralPc && view === "mecanico" && data.fleet && <RecordAlert alerts={data.fleet.alerts} onSound={sound.recordFanfare} />}
      {ranking && view !== "corrida" && <RankingModal result={ranking === "result" ? data.lastResult : null} onClose={() => setRanking(null)} />}
      {help && (
        <div className="modal-backdrop" onClick={() => setHelp(false)}>
          <section className="help-modal" role="dialog" aria-modal="true" aria-labelledby="help-title" onClick={(e) => e.stopPropagation()}>
            <button autoFocus className="icon-button close-modal" aria-label="Fechar ajuda" onClick={() => setHelp(false)}>
              <X />
            </button>
            <span className="eyebrow">GUIA RÁPIDO</span>
            <h2 id="help-title">Race Control & Technical Operations.</h2>
            <p>
              O operador não dirige pelo painel: quem conduz é o volante de cada cockpit (A larga com 3-2-1, B finaliza, X é
              emergência, Y marca a volta). Aqui você monitora, valida e intervém.
            </p>
            <p>
              Visão Mecânico: a grade mostra, em cada carrinho, se ele está LIBERADO PARA CORRER ou por que NÃO PODE RODAR.
              ANALISAR (ou 1 INDIVIDUAL) abre a Central Técnica daquele carrinho: aceite técnico, comunicação com a placa,
              volante, pedais, relés, câmera, áudio e log.
            </p>
            <p>
              SIMULAÇÃO mostra exatamente as mesmas telas com carrinhos e pilotos virtuais do servidor, num banco separado:
              serve para treinar, testar e validar sem mover nenhum carrinho real. CARRINHO REAL mostra só o que está ligado
              neste PC Central.
            </p>
            <p>PARAR, ESC ou a perda da placa ou do volante desligam os relés. Trocar de janela não para a corrida.</p>
            <button className="start-button" onClick={() => setHelp(false)}>
              ENTENDI <ArrowUpRight size={16} />
            </button>
          </section>
        </div>
      )}
    </main>
  );
}
