import { useEffect } from "react";
import { ToastViewport } from "./components/Toasts";
import { CMD, invoke, isTauri } from "./lib/bridge";
import { SettingsProvider } from "./lib/settings";
import { OrbitStage } from "./orbit/OrbitStage";
import AppShell from "./shell/AppShell";

/**
 * Two windows share this bundle:
 *   index.html            → main app shell
 *   index.html#/orbit     → Orbit overlay (transparent, always-on-top Tauri window)
 */
export default function App() {
  const isOrbitWindow = window.location.hash.startsWith("#/orbit");

  useEffect(() => {
    if (isOrbitWindow) document.documentElement.classList.add("orbit-window");
  }, [isOrbitWindow]);

  return (
    <SettingsProvider>
      {isOrbitWindow ? (
        <>
          <OrbitStage
            standalone
            onClose={() => {
              if (isTauri) void invoke(CMD.hideOrbit).catch(() => {});
              else {
                window.location.hash = "#/images";
                window.location.reload();
              }
            }}
          />
          <ToastViewport />
        </>
      ) : (
        <AppShell />
      )}
    </SettingsProvider>
  );
}
