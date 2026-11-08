import React from "react";
import ReactDOM from "react-dom/client";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { isTauri } from "@tauri-apps/api/core";
import App from "./App";
import Orbit from "./Orbit";
import FloatView from "./FloatView";
import "./styles.css";
import "./orbit.css";
import "./extras.css";
import "./float.css";
import "./product-ui.css";
import "./desktop-polish.css";
import "./orbit-finish.css";

const label = isTauri() ? getCurrentWindow().label : "main";
const orbit = label === "orbit";
const floating = label === "float";
document.documentElement.dataset.mode = floating ? "float" : orbit ? "orbit" : "main";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>{floating ? <FloatView /> : orbit ? <Orbit /> : <App />}</React.StrictMode>
);
