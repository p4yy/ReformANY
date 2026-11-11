import { Fragment, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { CornerDownLeft, Search, type LucideIcon } from "lucide-react";

export interface Command {
  id: string;
  label: string;
  group: string;
  icon: LucideIcon;
  hint?: string;
  run: () => void;
}

export function CommandPalette({ commands, onClose }: { commands: Command[]; onClose: () => void }) {
  const [q, setQ] = useState("");
  const [idx, setIdx] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const restore = useRef<HTMLElement | null>(null);

  useEffect(() => {
    restore.current = document.activeElement as HTMLElement | null;
    return () => restore.current?.focus?.();
  }, []);

  const list = useMemo(() => {
    const s = q.trim().toLowerCase();
    return s ? commands.filter((c) => `${c.label} ${c.group}`.toLowerCase().includes(s)) : commands;
  }, [q, commands]);

  useEffect(() => setIdx(0), [q]);
  useEffect(() => {
    listRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: "nearest" });
  }, [idx]);

  const fire = (c: Command | undefined) => {
    if (!c) return;
    onClose();
    c.run();
  };

  const onKey = (e: KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setIdx((i) => (list.length ? (i + 1) % list.length : 0));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setIdx((i) => (list.length ? (i - 1 + list.length) % list.length : 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      fire(list[idx]);
    } else if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    } else if (e.key === "Tab") {
      e.preventDefault();
    }
  };

  return (
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="palette" role="dialog" aria-modal="true" aria-label="Command palette">
        <div className="flex h-12 flex-none items-center gap-2.5 border-b border-line px-3.5 focus-within:border-accent">
          <Search size={16} className="flex-none text-muted" />
          <input
            autoFocus
            role="combobox"
            aria-expanded="true"
            aria-controls="palette-list"
            aria-activedescendant={list[idx] ? `cmd-${list[idx].id}` : undefined}
            aria-label="Search modules and actions"
            className="min-w-0 flex-1 bg-transparent text-[0.9375rem] text-ink outline-none placeholder:text-muted"
            placeholder="Go to a module or run an action…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={onKey}
          />
          <span className="kbd">Esc</span>
        </div>
        <div id="palette-list" ref={listRef} role="listbox" aria-label="Results" className="min-h-0 flex-1 overflow-y-auto p-1.5">
          {list.length === 0 && (
            <p className="px-3 py-6 text-center text-soft">
              Nothing matches “{q}”. Try a module name such as <span className="mono text-bright">Archives</span>.
            </p>
          )}
          {list.map((c, i) => (
            <Fragment key={c.id}>
              {(i === 0 || list[i - 1].group !== c.group) && <p className="label px-3 pb-1 pt-2.5">{c.group}</p>}
              <button
                type="button"
                id={`cmd-${c.id}`}
                role="option"
                aria-selected={i === idx}
                tabIndex={-1}
                className="palette-item"
                onMouseMove={() => i !== idx && setIdx(i)}
                onClick={() => fire(c)}
              >
                <c.icon size={16} />
                <span className="min-w-0 flex-1 truncate">{c.label}</span>
                {c.hint && <span className="kbd">{c.hint}</span>}
                {i === idx && <CornerDownLeft size={14} />}
              </button>
            </Fragment>
          ))}
        </div>
      </div>
    </div>
  );
}
