/**
 * Which arena the panel shows: the real cars, or SIMULAÇÃO (virtual cars and
 * drivers on the server, own database). The screens are the same in both; the
 * choice lives in the URL (?mode=simulation) so links and reloads keep it.
 */
export const simulationArena = () =>
  new URLSearchParams(window.location?.search ?? "").get("mode") === "simulation";

/** Query for the server: the SIMULAÇÃO arena is reached with simulacao=1. */
export const arenaQuery = () => (simulationArena() ? "&simulacao=1" : "");
