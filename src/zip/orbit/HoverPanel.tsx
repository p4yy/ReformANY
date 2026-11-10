import { useEffect, useMemo, useState } from "react";
import qrcode from "qrcode-generator";
import { Copy, Download, FileText, FolderOpen, Pin, PinOff, QrCode, ScanEye, WifiOff } from "lucide-react";
import { toast } from "../components/Toasts";
import { Field, Note, Segmented } from "../components/ui";
import { CMD, invoke, isTauri, win } from "../lib/bridge";
import { copyText, downloadBlob, formatBytes, stem } from "../lib/util";
import { PanelShell, type DialogProps } from "./PanelShell";

const KIND_LABEL = { image: "Image", video: "Video", audio: "Audio", pdf: "PDF document", folder: "Folder" } as const;

/** Offline QR: computed here, never requested from a service. */
function buildQr(text: string): { svg: string; modules: number } | { error: string } {
  if (!text.trim()) return { error: "Enter some text to encode." };
  try {
    const q = qrcode as unknown as { stringToBytes: unknown; stringToBytesFuncs: Record<string, unknown> };
    if (q.stringToBytesFuncs?.["UTF-8"]) q.stringToBytes = q.stringToBytesFuncs["UTF-8"];
    const qr = qrcode(0, "M");
    qr.addData(text);
    qr.make();
    const n = qr.getModuleCount();
    let d = "";
    for (let r = 0; r < n; r++) {
      let run = 0;
      for (let c = 0; c <= n; c++) {
        const dark = c < n && qr.isDark(r, c);
        if (dark) run++;
        else if (run) {
          d += `M${c - run} ${r}h${run}v1h-${run}z`;
          run = 0;
        }
      }
    }
    const size = n + 8;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-4 -4 ${size} ${size}" shape-rendering="crispEdges"><rect x="-4" y="-4" width="${size}" height="${size}" fill="#E1E6D9"/><path d="${d}" fill="#11140E"/></svg>`;
    return { svg, modules: n };
  } catch {
    return { error: "That is too much text for one QR code. Shorten it." };
  }
}

/* ───────────── 5 · HoveR ───────────── */
export function HoverPanel({ context, onClose }: DialogProps) {
  const [tab, setTab] = useState<"file" | "qr">("file");
  const [pinned, setPinned] = useState(false);
  const [text, setText] = useState(context.path);
  const [thumb, setThumb] = useState<string | null>(null);
  const qr = useMemo(() => buildQr(text), [text]);

  useEffect(() => {
    void win.setAlwaysOnTop(pinned).catch(() => {});
  }, [pinned]);

  // Desktop: show the real picture through the asset protocol.
  useEffect(() => {
    if (!isTauri || context.kind !== "image") return;
    let dead = false;
    import("@tauri-apps/api/core").then((core) => !dead && setThumb(core.convertFileSrc(context.path)));
    return () => {
      dead = true;
    };
  }, [context]);

  const copy = async (value: string, what: string) =>
    toast((await copyText(value)) ? { tone: "success", title: `${what} copied` } : { tone: "warn", title: "Clipboard is blocked", body: value });

  const show = () => {
    if (isTauri) void invoke(CMD.orbitAction, { action: "show-file", path: context.path }).catch(() => {});
    else toast({ title: "Show in folder", body: "Opens Explorer with the file selected in the desktop app." });
  };

  const rows: Array<[string, string]> = [
    ["Name", context.name],
    ["Type", `${KIND_LABEL[context.kind]}${context.ext ? ` · .${context.ext}` : ""}`],
    ["Size", context.kind === "folder" ? `${context.items ?? 0} items` : formatBytes(context.size)],
    ...(context.pages ? ([["Pages", String(context.pages)]] as Array<[string, string]>) : []),
    ["Location", context.path],
  ];

  return (
    <PanelShell
      icon={ScanEye}
      title="HoveR"
      subtitle={pinned ? "Pinned — stays open until you close it" : "Quick look and share"}
      width={25}
      flush
      closeOnEsc={!pinned}
      onClose={onClose}
      headerExtra={
        <button type="button" className="btn btn-icon" aria-pressed={pinned} aria-label={pinned ? "Unpin panel" : "Pin panel"} title={pinned ? "Unpin" : "Pin on top"} onClick={() => setPinned((p) => !p)}>
          {pinned ? <PinOff size={14} /> : <Pin size={14} />}
        </button>
      }
    >
      <div className="border-b border-line p-2.5">
        <Segmented
          ariaLabel="HoveR view"
          size="sm"
          full
          value={tab}
          onChange={setTab}
          options={[
            { value: "file", label: "File", icon: FileText },
            { value: "qr", label: "QR", icon: QrCode },
          ]}
        />
      </div>

      {tab === "file" ? (
        <div className="grid gap-3 p-3.5">
          <div className="grid aspect-[16/9] place-items-center overflow-hidden rounded-[0.625rem] border border-line bg-app">
            {thumb ? (
              <img src={thumb} alt={`Preview of ${context.name}`} className="h-full w-full object-contain" />
            ) : (
              <div className="grid justify-items-center gap-2 text-center">
                <span className="tag !h-7 !min-w-[3.5rem] !text-[0.75rem]" data-family={context.kind === "pdf" ? "doc" : context.kind === "folder" ? "archive" : context.kind}>
                  {context.kind === "folder" ? "dir" : context.ext}
                </span>
                <span className="text-[0.71875rem] text-muted">{isTauri ? "No thumbnail for this type" : "Sample selection — no pixels to show"}</span>
              </div>
            )}
          </div>
          <dl className="grid gap-1.5">
            {rows.map(([k, v]) => (
              <div key={k} className="flex gap-3">
                <dt className="label w-16 flex-none pt-0.5">{k}</dt>
                <dd className={`min-w-0 flex-1 [overflow-wrap:anywhere] ${k === "Location" ? "mono text-[0.71875rem] text-soft" : ""}`}>{v}</dd>
              </div>
            ))}
          </dl>
          <div className="flex flex-wrap gap-1.5">
            <button type="button" className="btn btn-ghost btn-sm" data-autofocus onClick={() => copy(context.path, "Path")}>
              <Copy size={14} />
              Copy path
            </button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => copy(context.name, "Name")}>
              <Copy size={14} />
              Copy name
            </button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={show}>
              <FolderOpen size={14} />
              Show in folder
            </button>
          </div>
        </div>
      ) : (
        <div className="grid gap-3 p-3.5">
          <Field label="Text or link to encode" htmlFor="qr-text">
            <textarea id="qr-text" className="field mono !text-[0.75rem]" rows={2} spellCheck={false} value={text} onChange={(e) => setText(e.target.value)} />
          </Field>
          <div className="grid place-items-center rounded-[0.625rem] border border-line bg-app p-4" aria-live="polite">
            {"svg" in qr ? (
              <div className="w-44 overflow-hidden rounded-[0.375rem]" role="img" aria-label={`QR code for ${text}`} dangerouslySetInnerHTML={{ __html: qr.svg }} />
            ) : (
              <Note warn>{qr.error}</Note>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              className="btn btn-primary btn-sm"
              disabled={!("svg" in qr)}
              onClick={() => "svg" in qr && downloadBlob(new Blob([qr.svg], { type: "image/svg+xml" }), `${stem(context.name) || "qr"}-qr.svg`)}
            >
              <Download size={14} />
              Save SVG
            </button>
            <button type="button" className="btn btn-ghost btn-sm" disabled={!("svg" in qr)} onClick={() => "svg" in qr && copy(qr.svg, "SVG markup")}>
              <Copy size={14} />
              Copy SVG
            </button>
            {"svg" in qr && <span className="mono ml-auto text-[0.6875rem] text-muted">{qr.modules}×{qr.modules}</span>}
          </div>
          <p className="note">
            <WifiOff size={14} />
            <span>Generated offline on this device. The text is never sent anywhere.</span>
          </p>
        </div>
      )}
    </PanelShell>
  );
}
