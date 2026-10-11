/** Race times as MM:SS.mmm (the server keeps the clock; screens only format it). */
export function formatTime(ms: number) {
  return `${Math.floor(ms / 60000)
    .toString()
    .padStart(2, "0")}:${Math.floor((ms / 1000) % 60)
    .toString()
    .padStart(2, "0")}.${Math.floor(ms % 1000)
    .toString()
    .padStart(3, "0")}`;
}
