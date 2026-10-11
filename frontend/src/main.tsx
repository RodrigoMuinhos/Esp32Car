import React from "react";
import ReactDOM from "react-dom/client";
import { Dashboard } from "./components/Dashboard";
import "./theme.css";
import "./styles.css";
import "./fonts.css";
import "./offroad.css";
import "./pilot.css";
import "./fleet.css";
import "./mechanic.css";
import "./technical.css";
import "./hud.css";
import "./telao.css";
ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <Dashboard />
  </React.StrictMode>,
);
