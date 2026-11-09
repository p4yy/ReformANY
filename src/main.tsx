import React from "react";
import ReactDOM from "react-dom/client";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { isTauri } from "@tauri-apps/api/core";
import App from "./App";
import Orbit from "./Orbit";
import HoveRView from "./HoveRView";
import "./styles.css";
import "./orbit.css";
import "./extras.css";
import "./hover.css";
import "./product-ui.css";
import "./desktop-polish.css";
import "./orbit-finish.css";
import "./orbit-reference.css";
import "./desktop-sidebar.css";
import "./orbit-editor.css";

const label = isTauri() ? getCurrentWindow().label : "main";
const orbit = label === "orbit";
const hovering = label === "hover";
document.documentElement.dataset.mode = hovering ? "hover" : orbit ? "orbit" : "main";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>{hovering ? <HoveRView /> : orbit ? <Orbit /> : <App />}</React.StrictMode>
);
