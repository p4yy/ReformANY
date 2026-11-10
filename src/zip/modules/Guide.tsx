import { useState } from "react";
import { ArrowLeft, ArrowRight, Cpu, FolderInput, History, LayoutGrid, Mouse, Orbit, SlidersHorizontal, Zap, type LucideIcon } from "lucide-react";
import { PageHeader, Progress, ShakeIcon } from "../components/ui";
import { MOD_LABEL, useSettings } from "../lib/settings";
import { useShell, type PageId } from "../shell/nav";

interface Step {
  icon: LucideIcon;
  title: string;
  body: string;
  action?: { label: string; page?: PageId; orbit?: boolean };
}

export default function Guide() {
  const { settings, update } = useSettings();
  const { navigate, openOrbit } = useShell();
  const [i, setI] = useState(0);
  const k = settings.orbitKeys;

  const steps: Step[] = [
    { icon: LayoutGrid, title: "Pick a workspace", body: "Each workspace handles one family of files: images, audio and video, archives, documents, subtitles, spreadsheets and e-books. Choose one in the sidebar, or press Ctrl K and type its name.", action: { label: "Open Images", page: "images" } },
    { icon: FolderInput, title: "Drop files or folders", body: "Drop onto the dashed area, or use Add files and Add folder. Types a workspace cannot read are turned away with a shake and listed in a notice. Drag rows to set the order they run in." },
    { icon: SlidersHorizontal, title: "Fine-tune the output", body: "Set the destination and the few options that matter for that format — JPEG quality, background, longest edge. Every default is safe to leave alone." },
    { icon: Zap, title: "Convert on this device", body: "Press Convert. The bar tracks real progress, originals are never modified, and nothing is uploaded anywhere.", action: { label: "Open Activity", page: "activity" } },
    { icon: Mouse, title: "Summon Orbit", body: "In Explorer or on the desktop, hold the mouse button over a file and shake. Orbit opens under the pointer with actions for exactly that file. If it opens too easily or not at all, adjust the sensitivity in Appearance.", action: { label: "Try Orbit here", orbit: true } },
    { icon: Orbit, title: "Move between Orbit sections", body: `Orbit has three sections in one disc. Scroll the wheel, click the pills, or tap ${MOD_LABEL[k.convert]} for Convert, ${MOD_LABEL[k.tools]} for Tools and ${MOD_LABEL[k.actions]} for Actions. Esc closes it.`, action: { label: "Change the keys", page: "appearance" } },
    { icon: Cpu, title: "Connect the engines", body: "FFmpeg, 7-Zip, WinRAR, Calibre and LibreOffice do the heavy work for media, archives, e-books and Office files. Engines shows what is installed and gives the command for anything missing.", action: { label: "Open Engines", page: "engines" } },
    { icon: History, title: "Keep it running quietly", body: "With Close to tray on, closing the window keeps ReformANY in the tray so Orbit stays one shake away. Files & Jobs sets the output folder, the queue style and watched folders.", action: { label: "Open Files & Jobs", page: "files" } },
  ];
  const step = steps[i];

  return (
    <>
      <PageHeader page="guide" lead="Eight short steps from first drop to Orbit. Jump to any step; nothing here is required." />

      <div className="bento stagger">
        <section className="card flex min-h-[21rem] flex-col !p-5" aria-live="polite">
          <div className="flex items-start gap-4">
            <span className="font-serif text-[4.5rem] leading-[0.85] text-bright" aria-hidden="true">
              {String(i + 1).padStart(2, "0")}
            </span>
            <span className="tile-icon mt-1 !text-bright">{i === 4 ? <ShakeIcon size={16} /> : <step.icon size={16} />}</span>
          </div>
          <h2 className="mt-4 font-serif text-[1.75rem] leading-tight text-balance">{step.title}</h2>
          <p className="mt-2 max-w-[58ch] text-[0.9375rem] leading-relaxed text-soft text-pretty">{step.body}</p>
          {step.action && (
            <button
              type="button"
              className="btn btn-ghost mt-4 self-start"
              onClick={() => (step.action?.orbit ? openOrbit() : step.action?.page && navigate(step.action.page))}
            >
              {step.action.label}
              <ArrowRight size={16} />
            </button>
          )}
          <div className="mt-auto flex items-center gap-3 pt-6">
            <button type="button" className="btn btn-ghost btn-sm" disabled={i === 0} onClick={() => setI(i - 1)}>
              <ArrowLeft size={14} />
              Back
            </button>
            <div className="flex-1">
              <Progress value={(i + 1) / steps.length} label={`Step ${i + 1} of ${steps.length}`} />
            </div>
            {i < steps.length - 1 ? (
              <button type="button" className="btn btn-primary btn-sm" onClick={() => setI(i + 1)}>
                Next
                <ArrowRight size={14} />
              </button>
            ) : (
              <button
                type="button"
                className="btn btn-primary btn-sm"
                onClick={() => {
                  update({ showIntro: false });
                  navigate("images");
                }}
              >
                Start converting
              </button>
            )}
          </div>
        </section>

        <ol className="card grid gap-0.5 !p-1.5" aria-label="Guide steps">
          {steps.map((s, n) => (
            <li key={s.title}>
              <button
                type="button"
                aria-current={n === i ? "step" : undefined}
                className={`flex h-9 w-full items-center gap-3 rounded-[0.5rem] px-2.5 text-left transition-colors ${n === i ? "bg-bright/15 text-ink" : "text-soft hover:bg-accent/10 hover:text-ink"}`}
                onClick={() => setI(n)}
              >
                <span className={`mono text-[0.6875rem] ${n === i ? "text-bright" : "text-muted"}`}>{String(n + 1).padStart(2, "0")}</span>
                <span className="min-w-0 flex-1 truncate">{s.title}</span>
                {n < i && <span className="h-1.5 w-1.5 rounded-full bg-accent" aria-label="Viewed" />}
              </button>
            </li>
          ))}
        </ol>
      </div>
    </>
  );
}
