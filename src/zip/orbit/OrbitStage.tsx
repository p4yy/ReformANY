import { useEffect, useState } from "react";
import { AudioLines, FileImage, FileText, Film, Folder, X } from "lucide-react";
import { toast } from "../components/Toasts";
import { Segmented } from "../components/ui";
import { activity } from "../lib/activity";
import { CMD, EVT, invoke, isTauri, listen } from "../lib/bridge";
import type { Section } from "../lib/settings";
import { play } from "../lib/sound";
import { copyText, extOf, middleEllipsis } from "../lib/util";
import type { PageId } from "../shell/nav";
import { ArrangeDialog } from "./ArrangeDialog";
import { SAMPLES, type DialogKind, type Kind, type OrbitContext, type OrbitItem } from "./data";
import { RenameDialog, ShredDialog, SplitPdfDialog } from "./dialogs";
import { HoverPanel } from "./HoverPanel";
import { OrbitHUD } from "./OrbitHUD";
import { WatermarkDialog } from "./WatermarkDialog";

/**
 * Hosts the Orbit HUD and its dialogs.
 *  · Desktop (`#/orbit` window): transparent, driven by the file under the pointer.
 *  · Browser preview: floats over the app with a sample-selection picker, because a
 *    browser has no Explorer selection to read.
 */
export function OrbitStage({ standalone, onClose, onNavigate }: { standalone?: boolean; onClose: () => void; onNavigate?: (id: PageId) => void }) {
  const [kind, setKind] = useState<Kind>("image");
  const [samples, setSamples] = useState(SAMPLES);
  const [live, setLive] = useState<OrbitContext | null>(null);
  const [dialog, setDialog] = useState<DialogKind | null>(null);
  const [closeSignal, setCloseSignal] = useState(0);
  const context = live ?? samples[kind];
  const preview = !isTauri;

  useEffect(() => {
    if (!isTauri) return;
    let off = () => {};
    let dead = false;
    invoke<OrbitContext>(CMD.orbitContext).then((c) => !dead && c && setLive(c)).catch(() => {});
    listen<OrbitContext>(EVT.orbitShow, (c) => {
      setDialog(null);
      setLive(c);
    }).then((u) => (dead ? u() : (off = u)));
    return () => {
      dead = true;
      off();
    };
  }, []);

  const pick = (item: OrbitItem, section: Section) => {
    play("confirm");
    if (item.dialog) {
      if (isTauri) {
        const panelKind = ({ split: 'split-pdf', arrange: 'arrange', hover: 'hover', watermark: 'watermark', rename: 'rename', shred: 'shred' } as Record<string, string>)[item.dialog] || item.dialog;
        const command = panelKind === 'hover' ? 'hover_file' : CMD.openPanel;
        void invoke(command, panelKind === 'hover' ? { path: context.path } : { kind: panelKind })
          .catch(e => toast({ tone: 'danger', title: 'Orbit tool could not open', body: String(e) }));
      } else setDialog(item.dialog);
      return;
    }
    if (item.id === "more-tools") {
      if (isTauri) void invoke(CMD.orbitAction, { action: item.id, path: context.path }).catch(() => {});
      onClose();
      onNavigate?.("media");
      return;
    }
    if (item.id === "copy-path") {
      void copyText(context.path).then((ok) =>
        toast(ok ? { tone: "success", title: "Path copied", body: middleEllipsis(context.path, 56) } : { tone: "warn", title: "Clipboard is blocked", body: context.path }),
      );
      return;
    }
    const verb = section === "convert" ? `Convert to ${item.label}${item.sub ? ` (${item.sub})` : ""}` : item.label;
    if (isTauri) {
      invoke(CMD.orbitAction, { section, action: item.id, path: context.path })
        .then(onClose)
        .catch((e) => toast({ tone: "danger", title: `${verb} failed`, body: e instanceof Error ? e.message : String(e) }));
      return;
    }
    activity.add({ module: "Orbit", title: `${verb} · ${context.name}`, detail: "Dry run on a sample selection · nothing written", status: "dry" });
    toast({ tone: "info", title: verb, body: `Dry run on the sample “${context.name}”. In the desktop app this acts on the file under the pointer.` });
  };

  const closeDialog = () => setDialog(null);
  const requestClose = () => (dialog ? onClose() : setCloseSignal((n) => n + 1));

  const renameSample = (name: string) =>
    setSamples((s) => ({
      ...s,
      [kind]: { ...s[kind], name, ext: s[kind].kind === "folder" ? "" : extOf(name), path: s[kind].path.replace(/[^\\]+$/, name) },
    }));

  return (
    <div className="orbit-stage" role="dialog" aria-modal="true" aria-label="Orbit">
      {!(standalone && isTauri) && <div className="orbit-scrim" onClick={requestClose} aria-hidden="true" />}

      {preview && (
        <div className="stage-top">
          <span className="label max-[640px]:hidden">Sample selection</span>
          <Segmented
            ariaLabel="Sample file under the pointer"
            size="sm"
            value={kind}
            onChange={(k) => {
              setDialog(null);
              setKind(k);
            }}
            options={[
              { value: "image", label: "Image", icon: FileImage },
              { value: "video", label: "Video", icon: Film },
              { value: "audio", label: "Audio", icon: AudioLines },
              { value: "pdf", label: "PDF", icon: FileText },
              { value: "folder", label: "Folder", icon: Folder },
            ]}
          />
          <button type="button" className="btn btn-icon" aria-label="Close Orbit" title="Close Orbit (Esc)" onClick={requestClose}>
            <X size={16} />
          </button>
        </div>
      )}

      {!dialog && <OrbitHUD key={`${context.kind}:${context.path}`} context={context} onPick={pick} onClose={onClose} closeSignal={closeSignal} />}

      {dialog === "shred" && <ShredDialog context={context} onClose={closeDialog} />}
      {dialog === "rename" && <RenameDialog context={context} onClose={closeDialog} onRenamed={renameSample} />}
      {dialog === "watermark" && <WatermarkDialog context={context} onClose={closeDialog} />}
      {dialog === "split" && <SplitPdfDialog context={context} onClose={closeDialog} />}
      {dialog === "hover" && <HoverPanel context={context} onClose={closeDialog} />}
      {dialog === "arrange" && <ArrangeDialog context={context} onClose={closeDialog} />}

      {preview && !dialog && (
        <p className="pointer-events-none absolute bottom-3 left-1/2 z-[1] w-max max-w-[calc(100vw-2rem)] -translate-x-1/2 text-center text-[0.71875rem] text-soft max-[640px]:hidden">
          Browser preview. On Windows, Orbit opens over Explorer when you hold the mouse button and shake.
        </p>
      )}
    </div>
  );
}
