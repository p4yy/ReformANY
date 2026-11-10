import { useEffect, useState } from "react";
import { Copy, Menu, Minus, Moon, Orbit, Search, Square, Sun, X } from "lucide-react";
import { toast } from "../components/Toasts";
import { LogoMark } from "../components/ui";
import { isTauri, win } from "../lib/bridge";
import { useSettings } from "../lib/settings";

export function TitleBar({
  onPalette,
  onOrbit,
  onMenu,
  onClose,
}: {
  onPalette: () => void;
  onOrbit: () => void;
  onMenu: () => void;
  onClose: () => void;
}) {
  const [max, setMax] = useState(false);
  const { settings, update } = useSettings();
  useEffect(() => {
    const sync = () => setMax(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", sync);
    return () => document.removeEventListener("fullscreenchange", sync);
  }, []);

  const minimize = () => {
    if (isTauri) void win.minimize();
    else toast({ title: "Minimize belongs to the desktop window", body: "In this browser preview, Maximize toggles fullscreen and Close shows the close-to-tray behaviour." });
  };

  return (
    <header className="titlebar" data-tauri-drag-region>
      <button type="button" className="btn btn-icon min-[720px]:hidden" aria-label="Open navigation" onClick={onMenu}>
        <Menu size={16} />
      </button>
      <LogoMark size={20} />
      <span className="brand" aria-label="ReformANY">
        Reform<b>ANY</b>
      </span>
      <div className="flex min-w-0 flex-1 justify-center px-2" data-tauri-drag-region>
        <button type="button" className="palette-trigger" onClick={onPalette} aria-label="Open command palette" aria-keyshortcuts="Control+K">
          <Search size={14} />
          <span className="min-w-0 flex-1 truncate text-left">Search modules and actions</span>
          <span className="kbd max-[520px]:hidden">Ctrl K</span>
        </button>
      </div>
      <button type="button" className="btn btn-quiet btn-sm" onClick={onOrbit} title="Summon Orbit (Ctrl+Shift+Space)" aria-keyshortcuts="Control+Shift+Space">
        <Orbit size={16} />
        <span className="max-[520px]:hidden">Orbit</span>
      </button>
      <div className="ml-1 flex">
        <button type="button" className="win-btn" aria-label={settings.theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
          title={settings.theme === 'dark' ? 'Light mode' : 'Dark mode'}
          onClick={() => update({ theme: settings.theme === 'dark' ? 'light' : 'dark' })}>
          {settings.theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
        </button>
        <button type="button" className="win-btn max-[520px]:hidden" aria-label="Minimize" title="Minimize" onClick={minimize}>
          <Minus size={16} />
        </button>
        <button
          type="button"
          className="win-btn max-[520px]:hidden"
          aria-label={max ? "Restore" : "Maximize"}
          title={max ? "Restore" : "Maximize"}
          onClick={() => void win.toggleMaximize()}
        >
          {max ? <Copy size={14} /> : <Square size={14} />}
        </button>
        <button type="button" className="win-btn is-close" aria-label="Close" title="Close" onClick={onClose}>
          <X size={16} />
        </button>
      </div>
    </header>
  );
}
