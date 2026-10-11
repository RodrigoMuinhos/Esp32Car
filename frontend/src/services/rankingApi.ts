import type { Ranking } from "../types/telemetry";
import { arenaQuery } from "../arena";
import { serverBase } from "./server";
export async function fetchRanking(): Promise<Ranking> {
  // The ranking of the arena on screen (real cars or SIMULAÇÃO, never mixed).
  const query = arenaQuery();
  const base = serverBase();
  if (base === null) throw new Error("Servidor não configurado");
  const response = await fetch(`${base}/api/ranking${query ? `?${query.slice(1)}` : ""}`, { cache: "no-store" });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}
