import { useRef, useState, type KeyboardEvent, type MouseEvent } from "react";
import { LayoutGrid, MoveLeft, MoveRight, RotateCw, Trash2, Undo2 } from "lucide-react";
import { toast } from "../components/Toasts";
import { commit } from "./data";
import { FauxPage, PanelShell, type DialogProps } from "./PanelShell";

interface Page {
  id: number;
  rot: number;
}

/* ───────────── 6 · Arrange PDF pages ───────────── */
export function ArrangeDialog({ context, onClose }: DialogProps) {
  const total = context.pages ?? 8;
  const [pages, setPages] = useState<Page[]>(() => Array.from({ length: total }, (_, i) => ({ id: i + 1, rot: 0 })));
  const [selected, setSelected] = useState<Set<number>>(() => new Set([1]));
  const [history, setHistory] = useState<Page[][]>([]);
  const [dropId, setDropId] = useState<number | null>(null);
  const dragId = useRef<number | null>(null);
  const anchor = useRef(1);
  const grid = useRef<HTMLDivElement>(null);

  const apply = (next: Page[]) => {
    setHistory((h) => [...h.slice(-49), pages]);
    setPages(next);
  };
  const undo = () => {
    const prev = history[history.length - 1];
    if (!prev) return;
    setHistory((h) => h.slice(0, -1));
    setPages(prev);
    setSelected((s) => new Set([...s].filter((id) => prev.some((p) => p.id === id))));
  };

  const move = (dir: -1 | 1) => {
    const next = [...pages];
    const order = dir === -1 ? next.map((_, i) => i) : next.map((_, i) => next.length - 1 - i);
    let changed = false;
    for (const i of order) {
      const j = i + dir;
      if (!selected.has(next[i].id) || j < 0 || j >= next.length || selected.has(next[j].id)) continue;
      [next[i], next[j]] = [next[j], next[i]];
      changed = true;
    }
    if (changed) apply(next);
  };
  const rotate = () => selected.size && apply(pages.map((p) => (selected.has(p.id) ? { ...p, rot: (p.rot + 90) % 360 } : p)));
  const remove = () => {
    if (!selected.size) return;
    if (selected.size >= pages.length) {
      toast({ tone: "warn", title: "A PDF needs at least one page", body: "Deselect a page to keep it." });
      return;
    }
    const idx = pages.findIndex((p) => selected.has(p.id));
    const next = pages.filter((p) => !selected.has(p.id));
    apply(next);
    setSelected(new Set([next[Math.min(idx, next.length - 1)].id]));
  };

  const pick = (id: number, e: MouseEvent | KeyboardEvent) => {
    if (e.shiftKey) {
      const a = pages.findIndex((p) => p.id === anchor.current);
      const b = pages.findIndex((p) => p.id === id);
      const [lo, hi] = a < b ? [a, b] : [b, a];
      setSelected(new Set(pages.slice(Math.max(lo, 0), hi + 1).map((p) => p.id)));
      return;
    }
    anchor.current = id;
    if (e.ctrlKey || e.metaKey) {
      setSelected((s) => {
        const n = new Set(s);
        if (n.has(id)) n.delete(id);
        else n.add(id);
        return n;
      });
    } else setSelected(new Set([id]));
  };

  const dropOn = (targetId: number) => {
    const from = dragId.current;
    dragId.current = null;
    setDropId(null);
    if (from == null || from === targetId) return;
    const moving = selected.has(from) ? pages.filter((p) => selected.has(p.id)) : pages.filter((p) => p.id === from);
    if (moving.some((p) => p.id === targetId)) return;
    const rest = pages.filter((p) => !moving.includes(p));
    rest.splice(rest.findIndex((p) => p.id === targetId), 0, ...moving);
    apply(rest);
  };

  const onKey = (e: KeyboardEvent, id: number, index: number) => {
    const focusAt = (i: number) => grid.current?.querySelectorAll<HTMLElement>(".thumb")[i]?.focus();
    if (e.key === "ArrowRight") focusAt(Math.min(index + 1, pages.length - 1));
    else if (e.key === "ArrowLeft") focusAt(Math.max(index - 1, 0));
    else if (e.key === " " || e.key === "Enter") pick(id, e);
    else if (e.key === "Delete" || e.key === "Backspace") remove();
    else if (e.key.toLowerCase() === "r") rotate();
    else if (e.key.toLowerCase() === "z" && (e.ctrlKey || e.metaKey)) undo();
    else return;
    e.preventDefault();
  };

  const changed = history.length > 0;
  const none = selected.size === 0;

  const submit = async () => {
    const ok = await commit("arrange-pdf", context, { order: pages.map((p) => p.id), rotations: pages.map((p) => p.rot) }, {
      title: "Arrange PDF pages",
      previewBody: `Dry run on the sample PDF. The desktop app saves a new ${pages.length}-page copy next to the original.`,
    });
    if (ok) onClose();
  };

  return (
    <PanelShell
      icon={LayoutGrid}
      title="Arrange PDF pages"
      subtitle="Reorder, rotate and remove pages, then save a copy"
      context={context}
      width={54}
      flush
      onClose={onClose}
      footer={
        <>
          <span className="mono mr-auto text-[0.71875rem] text-soft" aria-live="polite">
            {pages.length} of {total} pages{changed ? " · edited" : ""}
          </span>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary" disabled={!changed} onClick={submit}>
            Save as new PDF
          </button>
        </>
      }
    >
      <div className="flex flex-wrap items-center gap-1 border-b border-line bg-surface px-2 py-1.5" role="toolbar" aria-label="Page tools">
        <button type="button" className="btn btn-quiet btn-sm" disabled={none} onClick={() => move(-1)}>
          <MoveLeft size={14} />
          Move left
        </button>
        <button type="button" className="btn btn-quiet btn-sm" disabled={none} onClick={() => move(1)}>
          <MoveRight size={14} />
          Move right
        </button>
        <button type="button" className="btn btn-quiet btn-sm" disabled={none} onClick={rotate}>
          <RotateCw size={14} />
          Rotate
        </button>
        <button type="button" className="btn btn-quiet btn-sm hover:!bg-danger/15 hover:!text-danger" disabled={none} onClick={remove}>
          <Trash2 size={14} />
          Delete
        </button>
        <span className="mx-1 h-4 w-px bg-line" aria-hidden="true" />
        <button type="button" className="btn btn-quiet btn-sm" disabled={!changed} onClick={undo}>
          <Undo2 size={14} />
          Undo
        </button>
        <span className="mono ml-auto px-1 text-[0.6875rem] text-soft" aria-live="polite">
          {selected.size} selected
        </span>
      </div>

      <div
        ref={grid}
        role="listbox"
        aria-label="Pages"
        aria-multiselectable="true"
        className="grid max-h-[26rem] grid-cols-[repeat(auto-fill,minmax(6.5rem,1fr))] gap-2.5 overflow-y-auto p-3.5"
      >
        {pages.map((p, i) => (
          <div
            key={p.id}
            role="option"
            tabIndex={0}
            aria-selected={selected.has(p.id)}
            aria-label={`Page ${p.id}, position ${i + 1}${p.rot ? `, rotated ${p.rot} degrees` : ""}`}
            className="thumb"
            data-drop={dropId === p.id || undefined}
            draggable
            onClick={(e) => pick(p.id, e)}
            onKeyDown={(e) => onKey(e, p.id, i)}
            onDragStart={(e) => {
              dragId.current = p.id;
              e.dataTransfer.effectAllowed = "move";
              e.dataTransfer.setData("text/plain", String(p.id));
            }}
            onDragOver={(e) => {
              if (dragId.current != null && dragId.current !== p.id) {
                e.preventDefault();
                setDropId(p.id);
              }
            }}
            onDrop={(e) => {
              e.preventDefault();
              dropOn(p.id);
            }}
            onDragEnd={() => {
              dragId.current = null;
              setDropId(null);
            }}
          >
            <div className="grid aspect-square place-items-center">
              <FauxPage n={p.id} style={{ width: "66%", rotate: `${p.rot}deg` }} />
            </div>
            <div className="mono mt-1.5 flex items-center justify-between text-[0.65625rem]">
              <span className={selected.has(p.id) ? "text-bright" : "text-soft"}>{i + 1}</span>
              {p.id !== i + 1 && <span className="text-muted">was {p.id}</span>}
              {p.rot !== 0 && <span className="text-muted">{p.rot}°</span>}
            </div>
          </div>
        ))}
      </div>
      <p className="border-t border-line px-3.5 py-2 text-[0.71875rem] text-soft">
        Drag to reorder. <span className="kbd">Ctrl</span>/<span className="kbd">Shift</span> click selects several. <span className="kbd">R</span> rotates,{" "}
        <span className="kbd">Del</span> removes, <span className="kbd">Ctrl Z</span> undoes.
      </p>
    </PanelShell>
  );
}
