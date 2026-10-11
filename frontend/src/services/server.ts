/**
 * Where the RC Racing server (backend, on the PC Central) is.
 *
 * - Served by the app itself (http://<PC Central>:8080, or a private-network address):
 *   the same origin.
 * - Vite dev server (port 5173): the backend on port 8080 of the same host.
 * - A static host (e.g. Vercel): the panel has no server of its own; it needs
 *   `?servidor=https://…` (remembered on this browser) or VITE_SERVER_URL at build time.
 *   An HTTPS page can only reach an HTTPS/WSS server.
 */
const KEY = "rc-racing-servidor";

/**
 * Public demonstration build (VITE_DEMO=1, e.g. on Vercel): the server is a simulation-only
 * demo, so the panel opens in SIMULAÇÃO, has no CARRINHO REAL and runs the virtual race.
 */
export const DEMO = import.meta.env.VITE_DEMO === "1";

const privateHost = (host: string) =>
  host === "localhost" ||
  /^127\./.test(host) ||
  /^10\./.test(host) ||
  /^192\.168\./.test(host) ||
  /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
  host.endsWith(".local");

function configured(): string | null {
  const asked = new URLSearchParams(window.location?.search ?? "").get("servidor");
  try {
    if (asked) localStorage.setItem(KEY, asked);
    const saved = localStorage.getItem(KEY);
    if (saved) return saved;
  } catch {
    if (asked) return asked;
  }
  const built = import.meta.env.VITE_SERVER_URL as string | undefined;
  return built || null;
}

/** HTTP base of the server, or null when there is none to talk to. */
export function serverBase(): string | null {
  if (!window.location) return "http://localhost:8080"; // no page address (tests): the local server
  const { hostname, port, origin } = window.location;
  const chosen = configured();
  if (chosen) return chosen.replace(/\/+$/, "");
  if (port === "5173") return `http://${hostname}:8080`;
  if (port || privateHost(hostname)) return origin;
  return null;
}

/** WebSocket base (ws:// or wss://, matching http:// or https://), or null. */
export function socketBase(): string | null {
  const base = serverBase();
  return base === null ? null : base.replace(/^http/, "ws");
}
