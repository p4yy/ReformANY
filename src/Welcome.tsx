import { useRef, useState } from "react";
import {
  ArrowRight, Archive, Check, Copy, FileImage, FolderOpen, LockKeyhole,
  MousePointer2, Pencil, ShieldCheck, Terminal, WandSparkles,
} from "lucide-react";
import { appIcon } from "./brand";
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

const demoItems: Record<OrbitTab, { label: string; icon: typeof FileImage }[]> = {
  convert: [
    { label: "WebP", icon: FileImage },
    { label: "JPEG", icon: FileImage },
    { label: "PNG", icon: FileImage },
  ],
  tools: [
    { label: "Create ZIP", icon: Archive },
    { label: "Show file", icon: FolderOpen },
    { label: "More", icon: ArrowRight },
  ],
  actions: [
    { label: "Rename", icon: Pencil },
    { label: "Copy path", icon: Copy },
    { label: "Terminal", icon: Terminal },
  ],
};

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
          <div className="welcome-eyebrow"><span/> WELCOME TO REFORMANY</div>
          <h1 id="welcome-title">Your files.<br/><em>Your flow.</em></h1>
          <p className="welcome-description">A quieter way to convert, organize and work with files. Everything happens on your computer.</p>
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
            <span>RIGHT-CLICK. DONE.</span>
          </div>
          <div className="welcome-orbit-stage">
            <div className="welcome-orbit-halo" aria-hidden="true"/>
            <div className="welcome-orbit" ref={orbitRef} tabIndex={-1} aria-label="Orbit three-section interactive preview">
              <div className="welcome-orbit-brand"><img src={appIcon} alt="" width="24" height="24"/> ReformANY <span>Orbit</span></div>
              <div className="welcome-orbit-file">
                <div className="welcome-orbit-file-icon"><FileImage size={27} strokeWidth={1.35}/></div>
                <strong>sample.png</strong>
                <small>IMAGE · PREVIEW</small>
              </div>
              <div className="welcome-orbit-tabs" role="tablist" aria-label="Orbit preview sections">
                {orbitTabs.map(item => (
                  <button
                    type="button"
                    key={item.id}
                    role="tab"
                    aria-selected={tab === item.id}
                    aria-controls="welcome-orbit-panel"
                    className={tab === item.id ? "active" : ""}
                    onClick={() => setTab(item.id)}
                  >{item.label}</button>
                ))}
              </div>
              <div className="welcome-orbit-panel" id="welcome-orbit-panel" role="tabpanel">
                <div className="welcome-orbit-hint">{tab === "convert" ? "QUICK CONVERT" : tab === "tools" ? "FILE TOOLS" : "FILE ACTIONS"}</div>
                <div className="welcome-orbit-buttons">
                  {demoItems[tab].map(item => {
                    const Icon = item.icon;
                    return <span key={item.label}><Icon size={13}/>{item.label}</span>;
                  })}
                </div>
              </div>
              <div className="welcome-orbit-bottom"><span><Check size={12}/> LOCAL</span><span>Open ReformANY <ArrowRight size={11}/></span></div>
            </div>
          </div>
          <p className="welcome-demo-caption"><WandSparkles size={14}/> Preview only. In File Explorer, right-click a file to open the real Orbit.</p>
        </section>
      </div>

      <footer className="welcome-footer">
        <span>ReformANY <span aria-hidden="true">/</span> PRIVATE BY DESIGN</span>
        <button onClick={finish}>Skip introduction <ArrowRight size={14}/></button>
      </footer>
    </main>
  );
}
