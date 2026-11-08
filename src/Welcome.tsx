import { useRef, useState } from "react";
import { ArrowRight, LockKeyhole, MousePointer2, ShieldCheck } from "lucide-react";
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
  catch { /* Storage can be restricted; the current session still proceeds. */ }
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
    inner: ["Rename", "Copy path", "Terminal", "Float"],
    outer: ["Show file", "Copy file", "Bluetooth"],
  },
};

// Geometry mirrors the real Orbit: annular wedges, a separated hub and two tiers.
// The illustration does not run file operations; it previews their layout.
function DemoRing({ labels, inner, outer }: { labels: string[]; inner: number; outer: number }) {
  return <g>
    {labels.map((label, index) => {
      const { start, end } = orbitSectorAngles(labels.length, index);
      const position = orbitPoint((inner + outer) / 2, (start + end) / 2);
      const words = label.split(" ");
      const lines = label.length > 10 && words.length > 1
        ? [words.slice(0, Math.ceil(words.length / 2)).join(" "),
          words.slice(Math.ceil(words.length / 2)).join(" ")] : [label];
      return <g key={label} className="welcome-radial-sector">
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
  const orbitRef = useRef<HTMLDivElement>(null);

  function finish() {
    markWelcomeComplete();
    onFinish();
  }

  function introduceOrbit() {
    setTab("actions");
    orbitRef.current?.focus();
  }

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
          <div className="welcome-eyebrow"><span/> REFORMANY · GET STARTED</div>
          <h1 id="welcome-title">Files, handled.<br/><em>Right here.</em></h1>
          <p className="welcome-description">Convert, compress and organize files in one place. Your work stays on this computer.</p>
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
          <p className="welcome-small-note">This introduction appears only once. You can replay it from Appearance.</p>
        </section>

        <section className="welcome-demo" aria-labelledby="welcome-demo-title">
          <div className="welcome-demo-heading">
            <span id="welcome-demo-title">MEET ORBIT</span>
            <span>THREE QUICK SECTIONS</span>
          </div>
          <div className="welcome-orbit-stage">
            <div className="welcome-orbit" ref={orbitRef} tabIndex={-1}
              id="welcome-orbit-panel" role="tabpanel" aria-labelledby={`welcome-orbit-tab-${tab}`}>
              <svg className="welcome-radial-rings" viewBox="0 0 560 560"
                role="img" aria-label="Illustration of the two-ring Orbit menu">
                <DemoRing labels={demoRings[tab].outer} inner={187} outer={264} />
                <DemoRing labels={demoRings[tab].inner} inner={106} outer={179} />
                <circle className="welcome-radial-hub-outline" cx={280} cy={280} r={99}/>
              </svg>
              <div className="welcome-radial-hub">
                <img src={appIcon} alt="" width={28} height={28}/>
                <strong>{tab === "convert" ? "Convert" : tab === "tools" ? "Tools" : "Actions"}</strong>
                <small>sample.png</small>
                <span>Esc · close</span>
              </div>
              <div className="welcome-orbit-tabs" role="tablist" aria-label="Orbit preview sections">
                <span className="welcome-orbit-tab-indicator" aria-hidden="true"
                  style={{transform:`translateX(${orbitTabs.findIndex(item => item.id === tab) * 100}%)`}}/>
                {orbitTabs.map((item, index) => (
                  <button type="button" key={item.id} id={`welcome-orbit-tab-${item.id}`}
                    role="tab" aria-selected={tab === item.id}
                    aria-controls="welcome-orbit-panel" className={tab === item.id ? "active" : ""}
                    onClick={() => setTab(item.id)}><span>{item.label}</span><small aria-hidden="true">{index + 1}</small></button>
                ))}
              </div>
            </div>
          </div>
          <p className="welcome-demo-caption"> Preview of Orbit. Available actions depend on the file and installed engines.</p>
        </section>
      </div>

      <footer className="welcome-footer">
        <span>ReformANY <span aria-hidden="true">/</span> PRIVATE BY DESIGN</span>
        <button onClick={finish}>Skip introduction <ArrowRight size={14}/></button>
      </footer>
    </main>
  );
}
