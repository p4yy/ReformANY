import React from "react";
import ReactDOM from "react-dom/client";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { isTauri } from "@tauri-apps/api/core";
import App from "./App";
import Orbit from "./Orbit";
import "./styles.css";
import "./orbit.css";

const orbit = isTauri() && getCurrentWindow().label === "orbit";
document.documentElement.dataset.mode = orbit ? "orbit" : "main";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>{orbit ? <Orbit /> : <App />}</React.StrictMode>
);
