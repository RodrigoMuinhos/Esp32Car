import { useEffect, useState } from "react";
// Must match the portrait block in offroad.css.
export const PORTRAIT_QUERY = "(orientation: portrait) and (min-width: 700px)";
export function usePortrait() {
  const [portrait, setPortrait] = useState(
    () => window.matchMedia?.(PORTRAIT_QUERY).matches ?? false,
  );
  useEffect(() => {
    const query = window.matchMedia?.(PORTRAIT_QUERY);
    if (!query) return;
    const update = () => setPortrait(query.matches);
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return portrait;
}
