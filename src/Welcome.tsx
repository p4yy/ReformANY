import { useRef, useState, type KeyboardEvent } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { ArrowRight, CheckCircle2, LockKeyhole, MousePointer2, ShieldCheck } from "lucide-react";
import { appIcon } from "./brand";
import { orbitPoint, roundedOrbitSlice, orbitSectorAngles } from "./orbitGeometry";
import "./welcome.css";

const WELCOME_KEY = "reformany.welcome.completed.v1";

export function shouldShowWelcome(): boolean {
  try { return localStorage.getItem(WELCOME_KEY) !== "true"; }
  catch { return true; }
}
export function markWelcomeComplete(): void {
  try { localStorage.setItem(WELCOME_KEY, "true"); }
  catch { /* Storage denial must not block onboarding. */ }
}

type OrbitTab = "convert" | "tools" | "actions";
const orbitTabs: { id: OrbitTab; label: string }[] = [
  { id: "convert", label: "Convert" },
  { id: "tools", label: "Tools" },
  { id: "actions", label: "Actions" },
];
type DemoSegments = { inner: string[]; outer: string[] };
const demoRings: Record<OrbitTab, DemoSegments> = {
  convert: { inner: ["JPEG", "WebP", "BMP", "GIF"], outer: ["TIFF", "ICO", "QOI", "AVIF"] },
  tools: { inner: ["ZIP", "7z"], outer: ["Split file", "Password ZIP", "More tools"] },
  actions: {
    inner: ["Rename", "Copy path", "Terminal", "HoveR"],
    outer: ["Show file", "Copy file", "Bluetooth"],
  },
};
const descriptions: Record<string,string> = {
  JPEG: "Choose JPEG output for a photograph.", WebP: "Create an efficient WebP image.",
  BMP: "Choose an uncompressed BMP image.", GIF: "Create a GIF image.",
  TIFF: "Save a TIFF image.", ICO: "Create a Windows icon.", QOI: "Convert to QOI.",
  AVIF: "Choose AVIF when the image engine supports it.",
  ZIP: "Package a file in a ZIP archive.", "7z": "Create a 7z archive when 7-Zip is available.",
  "Split file": "Split a large file into manageable parts.",
  "Password ZIP": "Create an AES-256 password-protected ZIP.",
  "More tools": "Discover additional tools for the selected file.",
  Rename: "Rename the file without changing its contents.",
  "Copy path": "Copy the file location to the clipboard.",
  Terminal: "Open a terminal in the file's folder.",
  HoveR: "Open a lightweight floating file preview.",
  "Show file": "Reveal the file in Windows Explorer.",
  "Copy file": "Copy the file to another destination.",
  Bluetooth: "Send the file using a supported Bluetooth adapter.",
};

// The welcome wheel uses the real Orbit's polar geometry. Every sector is a
// keyboard-accessible control; no file operations happen in demo mode.
function DemoRing({ labels, inner, outer, selected, onChoose, onHover }: {
  labels: string[]; inner: number; outer: number; selected: string | null;
  onChoose: (label: string) => void; onHover: (label: string | null) => void;
}) {
  return <g>
    {labels.map((label, index) => {
      const { start, end } = orbitSectorAngles(labels.length, index);
      const position = orbitPoint((inner + outer) / 2, (start + end) / 2);
      const words = label.split(" ");
      const lines = label.length > 10 && words.length > 1
        ? [words.slice(0, Math.ceil(words.length / 2)).join(" "),
          words.slice(Math.ceil(words.length / 2)).join(" ")] : [label];
      const chooseOnKeyboard = (event: KeyboardEvent<SVGGElement>) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onChoose(label);
        }
      };
      return <g key={label}
        className={"welcome-radial-sector is-interactive" + (selected === label ? " is-selected" : "")}
        role="button" tabIndex={0}
        aria-label={label + ". " + (descriptions[label] || "See how this Orbit action works.")}
        onClick={() => onChoose(label)}
        onKeyDown={chooseOnKeyboard}
        onMouseEnter={() => onHover(label)}
        onMouseLeave={() => onHover(null)}
        onFocus={() => onHover(label)}
        onBlur={() => onHover(null)}>
        <title>{label}</title>
        <path d={roundedOrbitSlice(inner, outer, start, end)} />
        <text x={position.x} y={position.y} textAnchor="middle" dominantBaseline="middle">
          {lines.map((line, lineIndex) => (
            <tspan key={line} x={position.x}
              dy={lineIndex === 0 ? (lines.length === 2 ? -6 : 0) : 15}>{line}</tspan>
          ))}
        </text>
      </g>;
    })}
  </g>;
}

export default function Welcome({ onFinish }: { onFinish: () => void }) {
  const [tab, setTab] = useState<OrbitTab>("convert");
  const [selected, setSelected] = useState<string | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  const [demoDone, setDemoDone] = useState(false);
  const [openingReal, setOpeningReal] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const orbitRef = useRef<HTMLDivElement>(null);

  function finish() {
    markWelcomeComplete();
    onFinish();
  }
  function changeTab(next: OrbitTab) {
    setTab(next);
    setSelected(null);
    setHovered(null);
    setDemoDone(false);
    setError(null);
  }
  function introduceOrbit() {
    changeTab("actions");
    orbitRef.current?.focus();
  }
  function choose(label: string) {
    setSelected(label);
    setDemoDone(false);
    setError(null);
  }
  function onTabKeys(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    let next = index;
    if (event.key === "ArrowRight") next = (index + 1) % orbitTabs.length;
    else if (event.key === "ArrowLeft") next = (index + orbitTabs.length - 1) % orbitTabs.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = orbitTabs.length - 1;
    else return;
    event.preventDefault();
    changeTab(orbitTabs[next].id);
    (event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next])?.focus();
  }
  async function tryRealOrbit() {
    if (!isTauri() || openingReal) {
      if (!isTauri()) setError("Open the installed ReformANY application to choose a real file.");
      return;
    }
    setOpeningReal(true);
    setError(null);
    try {
      const chosen = await open({ multiple: false, directory: false, title: "Try ReformANY Orbit with your own file" });
      if (typeof chosen === "string") {
        await invoke("orbit_launch_file", { path: chosen });
      }
    } catch (reason) {
      setError("Could not open Orbit: " + String(reason));
    } finally {
      setOpeningReal(false);
    }
  }

  const current = hovered || selected;
  return (
    <main className="welcome-screen" aria-labelledby="welcome-title">
      <header className="welcome-header">
        <div className="welcome-brand">
          <img src={appIcon} alt="" width="35" height="35"/>
          <span>Reform<span>ANY</span></span>
        </div>
        <div className="welcome-header-label">BY ACEV DEV CO <span aria-hidden="true">·</span> VERSION 0.3 PREVIEW</div>
      </header>

      <div className="welcome-main">
        <section className="welcome-copy">
          <div className="welcome-eyebrow"><span/> GET STARTED</div>
          <h1 id="welcome-title">Welcome to ReformANY</h1>
          <p className="welcome-description">Convert images, media and documents, or manage archives. Files stay on your computer.</p>
          <div className="welcome-points" aria-label="ReformANY essentials">
            <span><LockKeyhole size={15}/> No cloud uploads</span>
            <span><ShieldCheck size={15}/> Originals preserved</span>
            <span><MousePointer2 size={15}/> Orbit on right-click</span>
          </div>
          <div className="welcome-actions">
            <button className="welcome-primary" onClick={finish} autoFocus>
              Open workspace <ArrowRight size={18} strokeWidth={1.7}/>
            </button>
            <button className="welcome-secondary" onClick={introduceOrbit}>
              Explore Orbit <ArrowRight size={15}/>
            </button>
          </div>
          <p className="welcome-small-note">Try the Orbit preview on the right or open the real tool with your own file.</p>
        </section>

        <section className="welcome-demo" aria-labelledby="welcome-demo-title">
          <div className="welcome-demo-heading">
            <span id="welcome-demo-title">TRY ORBIT</span>
            <span>INTERACTIVE PREVIEW</span>
          </div>
          <div className="welcome-orbit-stage">
            <div className="welcome-orbit" ref={orbitRef} tabIndex={-1}
              id="welcome-orbit-panel" role="tabpanel" aria-labelledby={`welcome-orbit-tab-${tab}`}>
              <svg className="welcome-radial-rings" viewBox="0 0 560 560"
                role="group" aria-label="Interactive Orbit wheel. Choose a sector to preview its action.">
                <DemoRing labels={demoRings[tab].outer} inner={187} outer={264}
                  selected={selected} onChoose={choose} onHover={setHovered}/>
                <DemoRing labels={demoRings[tab].inner} inner={106} outer={179}
                  selected={selected} onChoose={choose} onHover={setHovered}/>
                <circle className="welcome-radial-hub-outline" cx={280} cy={280} r={99}/>
              </svg>
              <div className="welcome-radial-hub" aria-live="polite">
                <img src={appIcon} alt="" width={28} height={28}/>
                <strong>{current || (tab === "convert" ? "Convert" : tab === "tools" ? "Tools" : "Actions")}</strong>
                <small>sample.png</small>
                <span>Click a segment</span>
              </div>
            </div>
          </div>
          <div className="welcome-orbit-tabs" role="tablist" aria-label="Orbit preview sections">
            {orbitTabs.map((item, index) => (
              <button type="button" key={item.id} id={`welcome-orbit-tab-${item.id}`}
                role="tab" aria-selected={tab === item.id} tabIndex={tab === item.id ? 0 : -1}
                aria-controls="welcome-orbit-panel" className={tab === item.id ? "active" : ""}
                onKeyDown={event => onTabKeys(event, index)}
                onClick={() => changeTab(item.id)}>
                <span>{item.label}</span><small aria-hidden="true">{index + 1}</small>
              </button>
            ))}
          </div>
          <div className="welcome-orbit-action" role="status" aria-live="polite">
            <div className="welcome-orbit-action-copy">
              <strong>{selected ? selected : "Choose any segment"}</strong>
              <p>{selected ? descriptions[selected] : "Switch sections below the wheel, then click a wedge to explore its action."}</p>
              {demoDone && <span className="welcome-orbit-done"><CheckCircle2 size={14}/> Example completed — no files were changed.</span>}
            </div>
            <div className="welcome-orbit-demo-controls">
              <button type="button" disabled={!selected} onClick={() => setDemoDone(value => !value)}>
                {demoDone ? "Reset demo" : "Try sample"}
              </button>
              <button type="button" className="welcome-orbit-real" disabled={openingReal}
                onClick={() => void tryRealOrbit()}>
                {openingReal ? "Opening…" : "Use my file"} <ArrowRight size={14}/>
              </button>
            </div>
            {error && <p className="welcome-orbit-error" role="alert">{error}</p>}
          </div>
          <p className="welcome-demo-caption">Sample actions are demonstrations only. “Use my file” launches the real Orbit.</p>
        </section>
      </div>

      <footer className="welcome-footer">
        <span>ReformANY</span>
        <button onClick={finish}>Skip introduction <ArrowRight size={14}/></button>
      </footer>
    </main>
  );
}
