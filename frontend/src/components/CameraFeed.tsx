import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { FlaskConical, Maximize, Power, RefreshCw, Usb, Video, VideoOff } from "lucide-react";
import { simulationArena } from "../arena";

const CAMERA_KEY = "rc-racing-camera";
const ON_KEY = "rc-racing-camera-on";
/** External USB webcams (the overhead track camera). */
const EXTERNAL = /logi|c9\d\d|c6\d\d|c5\d\d|c3\d\d|c2\d\d|brio|streamcam|razer|elgato|microsoft lifecam|usb camera|usb video|webcam/i;
/** Cameras that are not the track camera: built into the notebook, or virtual. */
const NOT_TRACK = /user facing|world facing|integrated|integrada|built-?in|front|rear|\bir\b|infrared|virtual|ivcam|obs|droidcam|snap camera|epoccam|nvidia broadcast/i;

const read = (key: string) => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};
const write = (key: string, value: string | null) => {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    /* per-PC preference only */
  }
};
/** "HD Pro Webcam C920 (046d:082d)" -> "HD Pro Webcam C920". */
export const cameraName = (label: string) => label.replace(/\s*\([0-9a-f]{4}:[0-9a-f]{4}\)\s*$/i, "").trim();
/** Is it the external USB camera (not the notebook's own or a virtual one)? */
export const isUsbCamera = (label: string) =>
  !NOT_TRACK.test(label) && (EXTERNAL.test(label) || /\([0-9a-f]{4}:[0-9a-f]{4}\)/i.test(label));
/** Best track camera first: external USB webcams, then anything not built-in, then the rest. */
export function rankCameras(cameras: MediaDeviceInfo[]) {
  const score = (c: MediaDeviceInfo) =>
    EXTERNAL.test(c.label) && !NOT_TRACK.test(c.label) ? 2 : isUsbCamera(c.label) ? 1 : NOT_TRACK.test(c.label) ? -1 : 0;
  return [...cameras].sort((a, b) => score(b) - score(a));
}

/**
 * Live video of the track from the USB camera (getUserMedia works on 127.0.0.1).
 * Off until the viewer turns it on; finds the USB camera by itself (not the
 * notebook's own), follows plugging/unplugging, and remembers a manual choice.
 * `children` are drawn over the video and go full screen together with it.
 * `controlsSlot`: where the camera controls go (e.g. a side panel), so the
 * picture only shows what matters to the driver.
 */
type FeedProps = {
  label?: string;
  children?: ReactNode;
  controlsSlot?: HTMLElement | null;
};

/** SIMULAÇÃO: a race video plays where the track camera would be (YouTube player, needs internet). */
export const DEMO_VIDEO = "MnxgyUUX43U";

/**
 * The track camera. In the SIMULAÇÃO arena it is replaced by a demonstration race
 * video, so every screen looks like the real event; the real cars always use the
 * USB camera.
 */
export function CameraFeed(props: FeedProps) {
  return simulationArena() ? <DemoFeed {...props} /> : <LiveCameraFeed {...props} />;
}

function DemoFeed({ children, controlsSlot }: FeedProps) {
  const src =
    `https://www.youtube-nocookie.com/embed/${DEMO_VIDEO}?autoplay=1&mute=1&loop=1&playlist=${DEMO_VIDEO}` +
    "&controls=0&modestbranding=1&playsinline=1&rel=0&disablekb=1&iv_load_policy=3";
  const controls = (
    <div className="camera-bar">
      <span className="camera-rec on demo">
        <FlaskConical size={13} /> VÍDEO DE DEMONSTRAÇÃO · SIMULAÇÃO
      </span>
    </div>
  );
  return (
    <div className="camera-frame demo-feed">
      <iframe
        className="camera-video demo-video"
        src={src}
        title="Vídeo de demonstração da corrida (simulação)"
        allow="autoplay; encrypted-media; picture-in-picture"
        referrerPolicy="strict-origin-when-cross-origin"
        tabIndex={-1}
      />
      {children}
      {controlsSlot ? createPortal(controls, controlsSlot) : controls}
    </div>
  );
}

function LiveCameraFeed({
  label = "CÂMERA 1 · VISÃO SUPERIOR",
  children,
  controlsSlot,
}: {
  label?: string;
  children?: ReactNode;
  controlsSlot?: HTMLElement | null;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const frame = useRef<HTMLDivElement>(null);
  const [on, setOn] = useState(() => read(ON_KEY) === "1");
  const [cameras, setCameras] = useState<MediaDeviceInfo[]>([]);
  /** Manual choice from the list; null = pick the USB camera automatically. */
  const [chosen, setChosen] = useState<string | null>(() => read(CAMERA_KEY));
  const [activeId, setActiveId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [live, setLive] = useState(false);
  const [scan, setScan] = useState(0);
  const current = useRef({ live: false });
  /** True while a camera is being opened (device-change signals are ignored then). */
  const opening = useRef(false);
  current.current = { live };

  const listCameras = useCallback(async () => {
    const found = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === "videoinput");
    setCameras(found);
    return found;
  }, []);

  // A camera was plugged in: look again if we have no picture. A working camera
  // is never restarted (the device list can blink); if it is unplugged, its
  // video track ends and that triggers the new search instead.
  useEffect(() => {
    const devices = navigator.mediaDevices;
    if (!devices?.addEventListener) return;
    const changed = async () => {
      if (opening.current) return;
      await listCameras();
      if (!current.current.live) setScan((n) => n + 1);
    };
    devices.addEventListener("devicechange", changed);
    return () => devices.removeEventListener("devicechange", changed);
  }, [listCameras]);

  useEffect(() => {
    setLive(false);
    if (!on) {
      setError(null);
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      setError("Este navegador não dá acesso à câmera.");
      return;
    }
    let stream: MediaStream | null = null;
    let cancelled = false;
    const element = video.current;
    (async () => {
      opening.current = true;
      try {
        const open = (id?: string) =>
          navigator.mediaDevices.getUserMedia({
            video: { ...(id ? { deviceId: { exact: id } } : {}), width: { ideal: 1920 }, height: { ideal: 1080 } },
            audio: false,
          });
        let found = await listCameras();
        if (!found.some((c) => c.label)) {
          // First time: device names only appear after permission. Open the
          // default camera (asks permission) and keep it if it is the right one.
          stream = await open();
          found = await listCameras();
        }
        if (!found.length && !stream) throw Object.assign(new Error("no camera"), { name: "NotFoundError" });
        const manual = chosen ? found.find((c) => c.deviceId === chosen) : undefined;
        const camera = manual ?? rankCameras(found)[0];
        const openedId = stream?.getVideoTracks()[0]?.getSettings().deviceId;
        if (camera && camera.deviceId !== openedId) {
          stream?.getTracks().forEach((t) => t.stop());
          stream = null;
          try {
            stream = await open(camera.deviceId);
          } catch (first) {
            // The list can change while the camera is opening: retry with any camera.
            if (cancelled || !["NotFoundError", "OverconstrainedError"].includes((first as DOMException)?.name)) throw first;
            stream = await open();
          }
        }
        if (!stream) throw Object.assign(new Error("no camera"), { name: "NotFoundError" });
        if (cancelled) return stream.getTracks().forEach((t) => t.stop());
        if (element) {
          element.srcObject = stream;
          await element.play().catch(() => {});
        }
        // Turned off (or switched) while the video was starting: stay off.
        if (cancelled) return;
        setActiveId(stream.getVideoTracks()[0]?.getSettings().deviceId ?? camera?.deviceId ?? null);
        setError(null);
        setLive(true);
        // Unplugged while in use: look again.
        stream.getVideoTracks()[0]?.addEventListener("ended", () => !cancelled && setScan((n) => n + 1));
      } catch (e) {
        if (cancelled) return;
        const name = (e as DOMException)?.name;
        if (name === "NotFoundError" || name === "OverconstrainedError")
          setError("Nenhuma câmera encontrada. Conecte a câmera USB da pista e clique em BUSCAR CÂMERA USB.");
        else if (name === "NotAllowedError")
          setError("Sem permissão para usar a câmera. Libere o acesso à câmera para este app.");
        else if (name === "NotReadableError")
          setError("A câmera está em uso por outro programa (feche Teams, Zoom, o app Câmera ou outra aba deste painel).");
        else setError("Não foi possível abrir a câmera.");
      } finally {
        opening.current = false;
      }
    })();
    return () => {
      cancelled = true;
      stream?.getTracks().forEach((t) => t.stop());
      if (element) element.srcObject = null;
    };
  }, [on, chosen, scan, listCameras]);

  const toggle = () => {
    write(ON_KEY, on ? "0" : "1");
    setOn(!on);
  };
  const choose = (id: string) => {
    write(CAMERA_KEY, id || null);
    setChosen(id || null);
  };
  /** Forget the manual choice and pick the USB camera again (e.g. after plugging it in). */
  const findUsb = () => {
    choose("");
    setScan((n) => n + 1);
    if (!on) toggle();
  };
  const active = cameras.find((c) => c.deviceId === activeId);
  const usb = active ? isUsbCamera(active.label) : false;

  const controls = (
    <div className="camera-bar">
      <span className={`camera-rec ${live ? "on" : ""}`}>
        <i /> {live ? label : on ? "SEM SINAL" : "CÂMERA DESLIGADA"}
      </span>
      {live && active && (
        <span className={`camera-id ${usb ? "usb" : "other"}`} title={active.label}>
          <Usb size={13} /> {cameraName(active.label)} · {usb ? "USB" : "NÃO É A USB"}
        </span>
      )}
      {on && cameras.length > 1 && (
        <select aria-label="Escolher câmera" value={chosen ?? ""} onChange={(e) => choose(e.target.value)}>
          <option value="">Automático (USB)</option>
          {cameras.map((c, i) => (
            <option key={c.deviceId || i} value={c.deviceId}>
              {cameraName(c.label) || `Câmera ${i + 1}`}
              {isUsbCamera(c.label) ? " · USB" : ""}
            </option>
          ))}
        </select>
      )}
      {on && (
        <button className="icon-button" aria-label="Buscar câmera USB" title="Buscar câmera USB" onClick={findUsb}>
          <RefreshCw size={15} />
        </button>
      )}
      <button
        className={`icon-button camera-toggle ${on ? "on" : ""}`}
        aria-label={on ? "Desligar câmera" : "Ligar câmera"}
        title={on ? "Desligar câmera" : "Ligar câmera"}
        onClick={toggle}
      >
        <Power size={15} />
      </button>
      <button
        className="icon-button"
        aria-label="Transmissão em tela cheia"
        onClick={() => {
          if (document.fullscreenElement) void document.exitFullscreen();
          else void frame.current?.requestFullscreen().catch(() => {});
        }}
      >
        <Maximize size={15} />
      </button>
    </div>
  );

  return (
    <div className="camera-frame" ref={frame}>
      <video ref={video} className="camera-video" muted playsInline aria-label="Vídeo ao vivo da pista" />
      {children}
      {!live && (
        <div className="camera-empty" role="status">
          {error ? <VideoOff size={34} /> : <Video size={34} />}
          <span>{!on ? "Câmera da pista desligada" : (error ?? "Abrindo a câmera da pista…")}</span>
          {!on && (
            <button className="camera-power big" onClick={toggle}>
              <Power size={18} /> LIGAR CÂMERA
            </button>
          )}
          {on && error && (
            <button className="camera-power big" onClick={findUsb}>
              <RefreshCw size={16} /> BUSCAR CÂMERA USB
            </button>
          )}
        </div>
      )}
      {controlsSlot ? createPortal(controls, controlsSlot) : controls}
    </div>
  );
}
