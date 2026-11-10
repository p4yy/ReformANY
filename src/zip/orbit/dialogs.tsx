import { useEffect, useRef, useState } from "react";
import { CircleCheck, LoaderCircle, PencilLine, Scissors, Trash2 } from "lucide-react";
import { toast } from "../components/Toasts";
import { Field, Note, Segmented } from "../components/ui";
import { isTauri } from "../lib/bridge";
import { extOf, formatBytes, stem } from "../lib/util";
import { commit } from "./data";
import { PanelShell, type DialogProps } from "./PanelShell";

/* ───────────── 1 · Shred permanently? ───────────── */
export function ShredDialog({ context, onClose }: DialogProps) {
  const [ready, setReady] = useState(false);
  const [typed, setTyped] = useState("");
  const folder = context.kind === "folder";

  useEffect(() => {
    const t = window.setTimeout(() => setReady(true), 650);
    return () => window.clearTimeout(t);
  }, []);

  const armed = ready && typed === "SHRED";
  const what = folder ? `1 folder · ${context.items ?? 0} items` : `1 file · ${formatBytes(context.size)}`;

  const submit = async () => {
    if (!armed) return;
    const ok = await commit("shred", context, { confirmed: true }, {
      title: "Nothing was shredded",
      previewBody: `“${context.name}” is a sample selection in this browser preview, so there is nothing on disk to destroy.`,
    });
    if (ok) onClose();
  };

  return (
    <PanelShell
      icon={Trash2}
      title="Shred permanently?"
      subtitle="This cannot be undone"
      context={context}
      danger
      width={28}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn btn-danger" disabled={!armed} onClick={submit}>
            <Trash2 size={16} />
            Shred permanently
          </button>
        </>
      }
    >
      <form
        className="grid gap-3.5"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <p className="text-pretty">
          Shredding overwrites the contents and then deletes {folder ? "the folder and everything inside it" : "the file"}. It does not go to the
          Recycle Bin, and neither ReformANY nor Windows can bring it back.
        </p>
        <div className="flex items-center gap-2.5 rounded-[0.625rem] border border-line bg-app px-3 py-2" role="status">
          {ready ? <CircleCheck size={16} className="flex-none text-bright" /> : <LoaderCircle size={16} className="spin flex-none text-muted" />}
          <span className={ready ? "" : "text-soft"}>{ready ? `Inspected · ${what}` : "Inspecting selection…"}</span>
        </div>
        <Note warn>
          Limit: overwriting cannot reach copies kept by SSD wear-levelling, cloud sync history, backups or File History.
        </Note>
        <Field label="Type SHRED to confirm" htmlFor="shred-confirm">
          <input
            id="shred-confirm"
            data-autofocus
            className="field mono tracking-[0.24em]"
            autoComplete="off"
            spellCheck={false}
            placeholder="SHRED"
            value={typed}
            onChange={(e) => setTyped(e.target.value.toUpperCase().slice(0, 12))}
          />
        </Field>
      </form>
    </PanelShell>
  );
}

/* ───────────── 2 · Rename ───────────── */
export function RenameDialog({ context, onClose, onRenamed }: DialogProps & { onRenamed: (name: string) => void }) {
  const [name, setName] = useState(context.name);
  const input = useRef<HTMLInputElement>(null);
  const folder = context.kind === "folder";

  useEffect(() => {
    const el = input.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(0, folder ? context.name.length : stem(context.name).length);
  }, [context.name, folder]);

  const trimmed = name.trim();
  const error = !trimmed
    ? "Enter a name."
    : /[\\/:*?"<>|]/.test(trimmed)
      ? 'A name cannot contain \\ / : * ? " < > |'
      : /[. ]$/.test(name)
        ? "A name cannot end with a dot or a space."
        : null;
  const unchanged = trimmed === context.name;
  const extChanged = !folder && !error && extOf(trimmed) !== context.ext;

  const submit = async () => {
    if (error || unchanged) return;
    if (isTauri) {
      const ok = await commit("rename", context, { name: trimmed }, { title: "Renamed", previewBody: "" });
      if (ok) onClose();
      return;
    }
    onRenamed(trimmed);
    toast({ tone: "success", title: "Sample renamed", body: `Now “${trimmed}”. In the desktop app this renames the file on disk.` });
    onClose();
  };

  return (
    <PanelShell
      icon={PencilLine}
      title="Rename"
      subtitle={folder ? "Folder" : "File"}
      context={context}
      width={27}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary" disabled={!!error || unchanged} onClick={submit}>
            Save
          </button>
        </>
      }
    >
      <form
        className="grid gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <Field label="New name" htmlFor="rename-input">
          <input
            ref={input}
            id="rename-input"
            className="field"
            autoComplete="off"
            spellCheck={false}
            value={name}
            aria-invalid={!!error || undefined}
            aria-describedby="rename-help"
            onChange={(e) => setName(e.target.value)}
          />
        </Field>
        <div id="rename-help" aria-live="polite">
          {error ? (
            <Note warn>{error}</Note>
          ) : extChanged ? (
            <Note warn>
              The extension changes from .{context.ext} to .{extOf(trimmed) || "(none)"}. Renaming does not convert the file — use Convert for that.
            </Note>
          ) : (
            <Note>The file stays in the same folder. Press Enter to save.</Note>
          )}
        </div>
      </form>
    </PanelShell>
  );
}

/* ───────────── 4 · Split PDF ───────────── */
export function SplitPdfDialog({ context, onClose }: DialogProps) {
  const [method, setMethod] = useState<"size" | "pages" | "each">("size");
  const [mb, setMb] = useState("10");
  const [n, setN] = useState("5");
  const pages = context.pages ?? null;
  const mbNum = Number(mb);
  const nNum = Number(n);
  const valid = method === "each" || (method === "size" ? mbNum > 0 : nNum >= 1);

  const estimate =
    method === "size"
      ? context.size && mbNum > 0
        ? Math.max(1, Math.ceil(context.size / (mbNum * 1024 * 1024)))
        : null
      : method === "pages"
        ? pages && nNum >= 1
          ? Math.ceil(pages / nNum)
          : null
        : pages;

  const submit = async () => {
    if (!valid) return;
    const ok = await commit("split-pdf", context, { method, megabytes: mbNum, pages: nNum }, {
      title: "Split PDF",
      previewBody: `Dry run on the sample PDF. The desktop app would write ${estimate ?? "several"} file${estimate === 1 ? "" : "s"} next to the original.`,
    });
    if (ok) onClose();
  };

  return (
    <PanelShell
      icon={Scissors}
      title="Split PDF"
      subtitle="Create smaller PDFs from one document"
      context={context}
      width={30}
      onClose={onClose}
      footer={
        <>
          <span className="mono mr-auto text-[0.71875rem] text-soft" aria-live="polite">
            {estimate ? `≈ ${estimate} PDF${estimate === 1 ? "" : "s"}` : "Enter a value"}
          </span>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary" disabled={!valid} onClick={submit}>
            <Scissors size={16} />
            Create PDFs
          </button>
        </>
      }
    >
      <div className="grid gap-4">
        <Field label="Split method">
          <Segmented
            ariaLabel="Split method"
            size="sm"
            full
            value={method}
            onChange={setMethod}
            options={[
              { value: "size", label: "By file size" },
              { value: "pages", label: "By page count" },
              { value: "each", label: "Every page" },
            ]}
          />
        </Field>

        {method === "size" && (
          <Field label="Target size" htmlFor="split-mb" hint="Each PDF stays at or under this size. A single page larger than the target becomes its own file.">
            <div className="flex items-center gap-2">
              <input id="split-mb" data-autofocus className="field mono !w-28" inputMode="decimal" value={mb} onChange={(e) => setMb(e.target.value.replace(/[^\d.]/g, "").slice(0, 6))} />
              <span className="mono text-soft">MB</span>
            </div>
            <div className="flex flex-wrap gap-1.5" role="group" aria-label="Quick sizes">
              {["1", "5", "10", "25", "100"].map((v) => (
                <button key={v} type="button" className="chip" aria-pressed={mb === v} onClick={() => setMb(v)}>
                  {v} MB
                </button>
              ))}
            </div>
          </Field>
        )}

        {method === "pages" && (
          <Field label="Pages per PDF" htmlFor="split-n" hint={pages ? `This document has ${pages} pages.` : undefined}>
            <input id="split-n" data-autofocus className="field mono !w-28" inputMode="numeric" value={n} onChange={(e) => setN(e.target.value.replace(/\D/g, "").slice(0, 4))} />
          </Field>
        )}

        {method === "each" && <Note>Every page becomes its own PDF{pages ? ` — ${pages} files` : ""}, numbered in page order.</Note>}

        <Note>New files are written next to the original, which is left untouched.</Note>
      </div>
    </PanelShell>
  );
}
