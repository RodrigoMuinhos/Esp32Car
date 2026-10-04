import type { Ranking } from "../types/telemetry";
/** Same origin when served by the app; the backend on 8080 under the Vite dev server. */
function base() {
  const { port, hostname } = window.location;
  return port === "5173" ? `http://${hostname}:8080` : "";
}
export async function fetchRanking(): Promise<Ranking> {
  const response = await fetch(`${base()}/api/ranking`, { cache: "no-store" });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}
