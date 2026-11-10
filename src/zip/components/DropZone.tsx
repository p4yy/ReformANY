import { useCallback, useEffect, useRef, useState, type CSSProperties, type Dispatch, type DragEvent, type SetStateAction } from "react";
import { ArrowDown, Download, FilePlus2, FolderInput, GripVertical, LoaderCircle, X } from "lucide-react";
import { EVT, isTauri, listen, pickPaths } from "../lib/bridge";
import { downloadBlob, extOf, familyOf, formatBytes, uid } from "../lib/util";
import { toast } from "./Toasts";

export interface QueueItem {
  id: string;
  name: string;
  size: number | null;
  /** Browser File (preview) */
  file?: File;
  /** Absolute path (desktop) */
  path?: string;
  status?: "queued" | "working" | "done" | "dry" | "failed";
  note?: string;
  output?: { blob: Blob; name: string };
}

export const fromFiles = (files: File[]): QueueItem[] =>
  files.map((file) => ({ id: uid(), name: file.name, size: file.size, file, status: "queued" }));

const fromPaths = (paths: string[]): QueueItem[] =>
  paths.map((path) => ({ id: uid(), name: path.split(/[\\/]/).pop() || path, size: null, path, status: "queued" }));

export const inputsOf = (items: QueueItem[]) => items.map((i) => i.path ?? i.name);

export function DropZone({
  items,
  setItems,
  accept,
  maxBytes,
  multiple = true,
  folder = true,
  title,
  formats,
  compact,
}: {
  items: QueueItem[];
  setItems: Dispatch<SetStateAction<QueueItem[]>>;
  accept: string[];
  maxBytes?: number;
  multiple?: boolean;
  folder?: boolean;
  title: string;
  formats: string;
  compact?: boolean;
}) {
  const [state, setState] = useState<"idle" | "over" | "reject">("idle");
  const [overRow, setOverRow] = useState<string | null>(null);
  const zone = useRef<HTMLDivElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const dirInput = useRef<HTMLInputElement>(null);
  const depth = useRef(0);
  const dragRow = useRef<string | null>(null);
  const raf = useRef(0);

  const any = accept.includes("*");
  const add = useCallback(
    (incoming: QueueItem[]) => {
      const ok: QueueItem[] = [];
      let badType = 0;
      let tooBig = 0;
      for (const it of incoming) {
        if (!any && !accept.includes(extOf(it.name))) badType++;
        else if (maxBytes && it.size != null && it.size > maxBytes) tooBig++;
        else ok.push(it);
      }
      if (badType || tooBig) {
        setState("reject");
        setTimeout(() => setState("idle"), 460);
        const n = badType + tooBig;
        toast({
          tone: "warn",
          title: `${n} file${n === 1 ? "" : "s"} skipped`,
          body: [badType && `${badType} unsupported type`, tooBig && `${tooBig} over ${formatBytes(maxBytes)}`].filter(Boolean).join(" · "),
        });
      }
      if (ok.length) setItems((prev) => (multiple ? [...prev, ...ok] : [ok[0]]));
    },
    [accept, any, maxBytes, multiple, setItems],
  );

  // Desktop: the webview reports dropped paths through a Tauri event.
  useEffect(() => {
    let off = () => {};
    let dead = false;
    listen<{ paths: string[] }>(EVT.fileDrop, (p) => {
      if (zone.current?.offsetParent && p?.paths?.length) add(fromPaths(p.paths));
    }).then((u) => (dead ? u() : (off = u)));
    return () => {
      dead = true;
      off();
    };
  }, [add]);

  const isFiles = (e: DragEvent) => Array.from(e.dataTransfer.types).includes("Files");
  const onEnter = (e: DragEvent) => {
    if (!isFiles(e)) return;
    e.preventDefault();
    depth.current++;
    setState("over");
  };
  const onOver = (e: DragEvent) => {
    if (!isFiles(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
    const { clientX, clientY } = e;
    cancelAnimationFrame(raf.current);
    raf.current = requestAnimationFrame(() => {
      const el = zone.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      el.style.setProperty("--mx", `${clientX - r.left}px`);
      el.style.setProperty("--my", `${clientY - r.top}px`);
    });
  };
  const onLeave = (e: DragEvent) => {
    if (!isFiles(e)) return;
    depth.current = Math.max(0, depth.current - 1);
    if (!depth.current) setState("idle");
  };
  const onDrop = (e: DragEvent) => {
    if (!isFiles(e)) return;
    e.preventDefault();
    if (isTauri) { depth.current = 0; setState('idle'); return; }
    depth.current = 0;
    setState("idle");
    add(fromFiles(Array.from(e.dataTransfer.files)));
  };

  const browse = async (directory: boolean) => {
    if (isTauri) {
      const picked = await pickPaths({ multiple, directory, extensions: any ? undefined : accept });
      if (picked) add(fromPaths(picked));
      return;
    }
    (directory ? dirInput : fileInput).current?.click();
  };

  const move = (id: string, toId: string | null, delta = 0) =>
    setItems((prev) => {
      const from = prev.findIndex((p) => p.id === id);
      const to = toId ? prev.findIndex((p) => p.id === toId) : from + delta;
      if (from < 0 || to < 0 || to >= prev.length || from === to) return prev;
      const next = [...prev];
      next.splice(to, 0, ...next.splice(from, 1));
      return next;
    });

  const total = items.reduce((sum, i) => sum + (i.size ?? 0), 0);
  const filled = items.length > 0;

  return (
    <div
      ref={zone}
      className="dropzone"
      data-state={state}
      data-filled={filled}
      data-compact={compact || undefined}
      onDragEnter={onEnter}
      onDragOver={onOver}
      onDragLeave={onLeave}
      onDrop={onDrop}
    >
      <div className="dz-ripple" aria-hidden="true">
        <i />
        <i />
        <i />
      </div>
      <div className="dz-target">
        <div className="dz-rings" aria-hidden="true">
          <i />
          <i />
          <i />
          <ArrowDown size={filled || compact ? 16 : 20} />
        </div>
        <div className="dz-text">
          <p className="dz-title">{state === "over" ? "Release to add" : title}</p>
          <p className="dz-formats mono" title={`${formats}${maxBytes ? ` · up to ${formatBytes(maxBytes)} each` : ""}`}>
            {formats}
          </p>
          {maxBytes && !filled && !compact ? <p className="mt-1 text-[0.75rem] text-soft">Up to {formatBytes(maxBytes)} each</p> : null}
        </div>
        <div className="flex flex-wrap items-center justify-center gap-2">
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => browse(false)}>
            <FilePlus2 size={14} />
            {multiple ? "Add files" : filled ? "Replace file" : "Choose file"}
          </button>
          {folder && multiple && (
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => browse(true)}>
              <FolderInput size={14} />
              Add folder
            </button>
          )}
        </div>
      </div>

      {filled && (
        <>
          <div className="flex items-center gap-3 border-t border-line px-3 py-1.5 text-[0.75rem]">
            <span className="mono font-semibold text-bright" aria-live="polite">
              {items.length} file{items.length === 1 ? "" : "s"}
            </span>
            {total > 0 && <span className="mono text-muted">{formatBytes(total)}</span>}
            {multiple && items.length > 1 && <span className="ml-auto hidden text-muted sm:inline">Drag rows to set the order</span>}
            <button type="button" className={`btn btn-quiet btn-sm ${multiple && items.length > 1 ? "" : "ml-auto"}`} onClick={() => setItems([])}>
              Clear
            </button>
          </div>
          <ul className="file-list" aria-label="Queued files">
            {items.map((it, i) => {
              const ext = extOf(it.name);
              return (
                <li
                  key={it.id}
                  className="file-row"
                  style={{ "--i": i } as CSSProperties}
                  data-drop={overRow === it.id || undefined}
                  draggable={multiple && items.length > 1}
                  onDragStart={(e) => {
                    dragRow.current = it.id;
                    e.dataTransfer.effectAllowed = "move";
                    e.dataTransfer.setData("text/x-reformany-row", it.id);
                  }}
                  onDragOver={(e) => {
                    if (dragRow.current && dragRow.current !== it.id) {
                      e.preventDefault();
                      setOverRow(it.id);
                    }
                  }}
                  onDrop={(e) => {
                    if (!dragRow.current) return;
                    e.preventDefault();
                    e.stopPropagation();
                    move(dragRow.current, it.id);
                    dragRow.current = null;
                    setOverRow(null);
                  }}
                  onDragEnd={() => {
                    dragRow.current = null;
                    setOverRow(null);
                  }}
                >
                  {multiple && items.length > 1 ? (
                    <button
                      type="button"
                      className="grip"
                      aria-label={`Reorder ${it.name}. Use arrow up and down.`}
                      onKeyDown={(e) => {
                        if (e.key === "ArrowUp" || e.key === "ArrowDown") {
                          e.preventDefault();
                          move(it.id, null, e.key === "ArrowUp" ? -1 : 1);
                        }
                      }}
                    >
                      <GripVertical size={14} />
                    </button>
                  ) : (
                    <span className="w-1" />
                  )}
                  <span className="tag" data-family={familyOf(ext)}>
                    {ext || "file"}
                  </span>
                  <span className="min-w-0 flex-1 truncate" title={it.path ?? it.name}>
                    {it.name}
                  </span>
                  {it.status === "working" && <LoaderCircle size={14} className="spin text-bright" aria-label="Working" />}
                  {it.status === "done" && (
                    <span className="pill" data-tone="ok">
                      Done{it.note ? ` · ${it.note}` : ""}
                    </span>
                  )}
                  {it.status === "dry" && (
                    <span className="pill" data-tone="info" title={it.note}>
                      {it.note ?? "Dry run"}
                    </span>
                  )}
                  {it.status === "failed" && (
                    <span className="pill max-w-[11rem] truncate" data-tone="warn" title={it.note}>
                      {it.note ?? "Failed"}
                    </span>
                  )}
                  {it.output ? (
                    <button
                      type="button"
                      className="btn btn-quiet btn-sm"
                      aria-label={`Save ${it.output.name}`}
                      onClick={() => it.output && downloadBlob(it.output.blob, it.output.name)}
                    >
                      <Download size={14} />
                      Save
                    </button>
                  ) : (
                    <span className="mono hidden text-[0.6875rem] text-muted sm:inline">{formatBytes(it.size)}</span>
                  )}
                  <button
                    type="button"
                    className="btn btn-icon is-danger"
                    aria-label={`Remove ${it.name}`}
                    onClick={() => setItems((prev) => prev.filter((p) => p.id !== it.id))}
                  >
                    <X size={14} />
                  </button>
                </li>
              );
            })}
          </ul>
        </>
      )}

      <input
        ref={fileInput}
        type="file"
        hidden
        multiple={multiple}
        accept={any ? undefined : accept.map((e) => `.${e}`).join(",")}
        onChange={(e) => {
          add(fromFiles(Array.from(e.target.files ?? [])));
          e.target.value = "";
        }}
      />
      <input
        ref={(el) => {
          dirInput.current = el;
          el?.setAttribute("webkitdirectory", "");
        }}
        type="file"
        hidden
        multiple
        onChange={(e) => {
          const all = Array.from(e.target.files ?? []);
          const usable = any ? all : all.filter((f) => accept.includes(extOf(f.name)));
          if (!usable.length && all.length) toast({ tone: "warn", title: "Nothing to add", body: "That folder has no supported files." });
          else add(fromFiles(usable));
          e.target.value = "";
        }}
      />
    </div>
  );
}
