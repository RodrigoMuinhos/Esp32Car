import { useEffect, useRef } from "react";
import { Volume2, VolumeX } from "lucide-react";
import type { Volumes } from "../audio/raceAudio";

const CHANNELS: { key: keyof Volumes; label: string; hint: string }[] = [
  { key: "engine", label: "Motor e pneus", hint: "ronco, corte de giro, freio" },
  { key: "voice", label: "Voz", hint: "Three, Two, One, Go" },
  { key: "effects", label: "Efeitos", hint: "bipes, arranque, fanfarra, alarme" },
];

/** Drop-down under the speaker button: master on/off and one slider per channel. */
export function SoundPanel({
  muted,
  onToggleMuted,
  volumes,
  onVolume,
  onPreview,
  onClose,
}: {
  muted: boolean;
  onToggleMuted: () => void;
  volumes: Volumes;
  onVolume: (key: keyof Volumes, value: number) => void;
  onPreview: (key: keyof Volumes) => void;
  onClose: () => void;
}) {
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const outside = (e: PointerEvent) => {
      const target = e.target as Node;
      if (!panel.current?.contains(target) && !(target as Element).closest?.(".sound-toggle")) onClose();
    };
    const escape = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("pointerdown", outside);
    window.addEventListener("keydown", escape);
    return () => {
      window.removeEventListener("pointerdown", outside);
      window.removeEventListener("keydown", escape);
    };
  }, [onClose]);
  return (
    <div className="sound-popover" ref={panel} role="dialog" aria-label="Som">
      <button className={`sound-master ${muted ? "" : "on"}`} onClick={onToggleMuted}
        aria-label={muted ? "Ligar som" : "Desligar som"}>
        {muted ? <VolumeX size={16} /> : <Volume2 size={16} />}
        {muted ? "SOM DESLIGADO" : "SOM LIGADO"}
      </button>
      {CHANNELS.map(({ key, label, hint }) => (
        <label key={key} className={muted ? "dimmed" : ""}>
          <span>
            {label} <b>{Math.round(volumes[key] * 100)}%</b>
          </span>
          <input
            type="range"
            min="0"
            max="100"
            aria-label={`Volume ${label.toLowerCase()}`}
            value={Math.round(volumes[key] * 100)}
            onChange={(e) => onVolume(key, Number(e.target.value) / 100)}
            onPointerUp={() => onPreview(key)}
            onKeyUp={() => onPreview(key)}
          />
          <small>{hint}</small>
        </label>
      ))}
    </div>
  );
}
