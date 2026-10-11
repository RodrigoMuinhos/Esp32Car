import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
// The panel (frontend/): builds to frontend/dist, served by the backend (or any static host).
export default defineConfig({
  plugins: [react()],
  server: { port: 5173, strictPort: true },
  build: { outDir: "dist", emptyOutDir: true },
});
