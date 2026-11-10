import { useEffect, useId, useState, type FormEvent } from "react";
import { FileText, RotateCw, Scissors, X } from "lucide-react";

export type PdfPageAction = "extract" | "rotate";
export type PdfPageRequest = { pages: string | null; degrees: number };

function validateRange(input: string, count: number, optional: boolean): { error: string | null; selected: number } {
  if (!input.trim()) return optional
    ? { error: null, selected: count }
    : { error: "Enter a page range such as 1, 3-5, 9.", selected: 0 };
  if (!Number.isInteger(count) || count < 1) return { error: "PDF page count is unavailable.", selected: 0 };
  const seen = new Set<number>();
  let last = 0;
  for (const raw of input.split(",")) {
    const chunk = raw.trim();
    if (!/^\d+(?:\s*-\s*\d+)?$/.test(chunk)) {
      return { error: "Invalid entry '" + chunk + "'. Use 1,3-5,9.", selected: 0 };
    }
    const values = chunk.split("-").map(Number);
    const first = values[0], end = values[1] ?? first;
    if (first < 1 || end > count) {
      return { error: "Page numbers must be between 1 and " + count + ".", selected: 0 };
    }
    if (end < first) return { error: "Reversed ranges are not allowed.", selected: 0 };
    for (let page = first; page <= end; page++) {
      if (seen.has(page)) return { error: "Page " + page + " appears more than once.", selected: 0 };
      if (page <= last) return { error: "Enter pages in ascending order.", selected: 0 };
      seen.add(page);
      last = page;
    }
  }
  return { error: null, selected: seen.size };
}

export default function PdfPageDialog({
  action, name, pageCount, working, error, onSubmit, onClose,
}: {
  action: PdfPageAction; name: string; pageCount: number | null; working: boolean;
  error?: string | null; onSubmit: (request: PdfPageRequest) => void; onClose: () => void;
}) {
  const id = useId();
  const [pages, setPages] = useState(action === "extract" ? "1" : "");
  const [degrees, setDegrees] = useState(90);
  const status = validateRange(pages, pageCount ?? 0, action === "rotate");
  const valid = pageCount !== null && !status.error && !working;
  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !working) { event.preventDefault(); event.stopPropagation(); onClose(); }
    };
    window.addEventListener("keydown", listener, true);
    return () => window.removeEventListener("keydown", listener, true);
  }, [onClose, working]);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (valid) onSubmit({ pages: pages.trim() || null, degrees });
  };
  return <div className="orbit-action-dialog" data-orbit-dialog role="presentation">
    <section className="orbit-action-panel" role="dialog" aria-modal="true" aria-labelledby={id} aria-busy={working}>
      <button type="button" className="orbit-dialog-close" disabled={working}
        onClick={onClose} aria-label="Close PDF tool"><X size={19}/></button>
      <div className="orbit-dialog-icon">{action === "extract" ? <Scissors size={22}/> : <RotateCw size={22}/>}</div>
      <h2 id={id}>{action === "extract" ? "Extract PDF pages" : "Rotate PDF pages"}</h2>
      <p>{action === "extract" ? "Save the chosen pages into a new, independently readable PDF." :
        "Change actual page rotation, without altering the source document."}</p>
      <div className="orbit-dialog-file"><FileText size={16}/><span title={name}>{name}</span>
        <small>{pageCount === null ? "Reading pages…" : pageCount + " pages"}</small>
      </div>
      <form onSubmit={submit}>
        <label htmlFor={id+"-range"}>{action === "extract" ? "Page range" : "Page range (leave blank for all pages)"}</label>
        <input id={id+"-range"} autoFocus value={pages} onChange={e=>setPages(e.target.value)}
          placeholder={action === "extract" ? "e.g. 1, 3-5, 9" : "All pages or 1, 3-5"}/>
        <div className="orbit-page-helper"><span>Separate pages with commas; use a hyphen for a range. Duplicates are not allowed.</span>
          <button type="button" disabled={working||!pageCount} onClick={()=>setPages(action==="rotate"?"":`1-${pageCount}`)}>All pages</button>
        </div>
        {action === "rotate" && <>
          <label htmlFor={id+"-rotate"}>Rotation</label>
          <select id={id+"-rotate"} value={degrees} onChange={e=>setDegrees(Number(e.target.value))}>
            <option value={90}>90° clockwise</option>
            <option value={-90}>90° counterclockwise</option>
            <option value={180}>180°</option>
          </select>
        </>}
        <p className={status.error ? "orbit-dialog-error" : "orbit-dialog-hint"} role="status">
          {status.error ?? (status.selected + " of " + pageCount + " pages selected · original unchanged")}
        </p>
        {error && <p className="orbit-dialog-error" role="alert">{error}</p>}
        <div className="orbit-dialog-footer">
          <button type="button" className="orbit-dialog-cancel" disabled={working} onClick={onClose}>Cancel</button>
          <button type="submit" className="orbit-dialog-submit" disabled={!valid}>
            {working ? "Processing…" : action==="extract" ? "Extract pages" : "Save rotated PDF"}
          </button>
        </div>
      </form>
    </section>
  </div>;
}
