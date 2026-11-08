import React from "react";
import ReactDOM from "react-dom/client";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { isTauri } from "@tauri-apps/api/core";
import App from "./App";
import Orbit from "./Orbit";
import FloatView from "./FloatView";
import Welcome, { shouldShowWelcome } from "./Welcome";
import { useEffect, useState } from "react";
import "./styles.css";
import "./orbit.css";
import "./extras.css";
import "./float.css";

const label = isTauri() ? getCurrentWindow().label : "main";
const orbit = label === "orbit";
const floating = label === "float";
document.documentElement.dataset.mode = floating ? "float" : orbit ? "orbit" : "main";

function DesktopExperience() {
  const [showWelcome, setShowWelcome] = useState(() => isTauri() && shouldShowWelcome());

  useEffect(() => {
    const replay = () => setShowWelcome(true);
    window.addEventListener("reformany:show-welcome", replay);
    return () => window.removeEventListener("reformany:show-welcome", replay);
  }, []);

  return showWelcome
    ? <Welcome onFinish={() => setShowWelcome(false)} />
    : <App />;
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>{floating ? <FloatView /> : orbit ? <Orbit /> : <DesktopExperience />}</React.StrictMode>
);
