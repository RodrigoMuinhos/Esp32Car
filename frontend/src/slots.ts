// One color per car (values in theme.css). The server has slots 1-4 today
// (backend/fleet.py SLOTS); 5-16 are ready for bigger events and the simulation.
export const SLOT_INFO = [
  { number: 1, name: "AZUL ELÉTRICO", color: "var(--car-1)", accent: "#7ab0ff", hue: 195 },
  { number: 2, name: "LARANJA", color: "var(--car-2)", accent: "#ffb27a", hue: 0 },
  { number: 3, name: "VERMELHO", color: "var(--car-3)", accent: "#ff8a95", hue: -28 },
  { number: 4, name: "ROXO", color: "var(--car-4)", accent: "#7dff6a", hue: 245 },
  { number: 5, name: "VERDE", color: "var(--car-5)", accent: "var(--car-5)", hue: 0 },
  { number: 6, name: "AMARELO OURO", color: "var(--car-6)", accent: "var(--car-6)", hue: 0 },
  { number: 7, name: "CIANO", color: "var(--car-7)", accent: "var(--car-7)", hue: 0 },
  { number: 8, name: "ROSA", color: "var(--car-8)", accent: "var(--car-8)", hue: 0 },
  { number: 9, name: "AZUL MARINHO", color: "var(--car-9)", accent: "var(--car-9)", hue: 0 },
  { number: 10, name: "LIMA", color: "var(--car-10)", accent: "var(--car-10)", hue: 0 },
  { number: 11, name: "CORAL", color: "var(--car-11)", accent: "var(--car-11)", hue: 0 },
  { number: 12, name: "VIOLETA", color: "var(--car-12)", accent: "var(--car-12)", hue: 0 },
  { number: 13, name: "TURQUESA", color: "var(--car-13)", accent: "var(--car-13)", hue: 0 },
  { number: 14, name: "ÂMBAR", color: "var(--car-14)", accent: "var(--car-14)", hue: 0 },
  { number: 15, name: "MAGENTA", color: "var(--car-15)", accent: "var(--car-15)", hue: 0 },
  { number: 16, name: "ÍNDIGO", color: "var(--car-16)", accent: "var(--car-16)", hue: 0 },
] as const;

export type SlotInfo = (typeof SLOT_INFO)[number];

export const slotInfo = (number: number | null | undefined): SlotInfo =>
  SLOT_INFO[Math.min(SLOT_INFO.length, Math.max(1, number ?? 1)) - 1];

/** Color of any car number (beyond 16 the colors repeat). */
export const carInfo = (number: number): SlotInfo => SLOT_INFO[(Math.max(1, number) - 1) % SLOT_INFO.length];

/** How a car is named everywhere (drivers are not identified by name): slot number
    and the name of its color, e.g. "02 VERDE". Without a color, the slot's default. */
export const carLabel = (number: number | null | undefined, color?: number | null): string =>
  number && number >= 1 ? `${String(number).padStart(2, "0")} ${carInfo(color || number).name}` : "—";

/** The slot this screen belongs to: ?vaga=N (cockpit tablets). */
export function pageSlot(): number {
  const value = Number(new URLSearchParams(window.location.search).get("vaga"));
  return Number.isInteger(value) && value >= 1 && value <= SLOT_INFO.length ? value : 1;
}

/** The car photo recolored to the slot (the artwork is orange). */
export const carFilter = (slot: SlotInfo) =>
  slot.hue ? `hue-rotate(${slot.hue}deg) saturate(1.2)` : "none";
