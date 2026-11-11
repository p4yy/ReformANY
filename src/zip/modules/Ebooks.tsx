import { useState } from "react";
import { BookOpen, Copy, Cpu } from "lucide-react";
import { DropZone, inputsOf, type QueueItem } from "../components/DropZone";
import { toast } from "../components/Toasts";
import { Card, DestinationField, JobBar, Note, PageHeader, useDestination, useJob } from "../components/ui";
import { isTauri } from "../lib/bridge";
import { ENGINES, EnginePill, useEngines } from "../lib/engines";
import { copyText } from "../lib/util";
import { useShell } from "../shell/nav";
import { MB, listNames, plural } from "./formats";

const ACCEPT = ["mobi", "azw", "azw3", "fb2", "lit", "pdb", "lrf", "docx", "odt", "rtf", "txt", "html", "htmlz", "pdf", "cbz", "cbr"];

export default function Ebooks() {
  const job = useJob("E-books");
  const dest = useDestination();
  const engines = useEngines();
  const { navigate } = useShell();
  const [items, setItems] = useState<QueueItem[]>([]);
  const calibre = engines.get("calibre");
  const install = ENGINES.find((e) => e.id === "calibre")?.install ?? "";

  return (
    <>
      <PageHeader page="ebooks" lead="Turn the e-book formats Calibre reads into EPUB, the format most readers and apps accept." />

      <div className="bento stagger">
        <DropZone items={items} setItems={setItems} accept={ACCEPT} maxBytes={150 * MB} title="Drop e-books to convert to EPUB"
          formats="MOBI · AZW3 · FB2 · LIT · PDB · DOCX · RTF · HTML · PDF · CBZ" />

        <div className="stack">
          <Card title="Output" icon={BookOpen}>
            <div className="grid gap-4">
              <div className="flex items-center gap-3 rounded-[0.625rem] border border-line bg-app px-3 py-2.5">
                <span className="tag" data-family="image">EPUB</span>
                <span className="text-soft">One EPUB per source file, same file name.</span>
              </div>
              <DestinationField dest={dest} id="eb-dest" />
              <Note>Books protected with DRM cannot be converted. PDF sources convert, but fixed layouts rarely reflow cleanly.</Note>
            </div>
          </Card>

          <Card title="Calibre" icon={Cpu} aside={<EnginePill state={calibre} name="Calibre" />}>
            <p className="text-soft">
              Conversion is done by Calibre’s <span className="mono text-ink">ebook-convert</span>, installed separately.
            </p>
            {calibre?.state !== "ready" && (
              <div className="mt-3 flex items-center gap-2 rounded-[0.5rem] border border-line bg-app py-1 pl-3 pr-1">
                <code className="mono min-w-0 flex-1 truncate text-[0.71875rem] text-soft" title={install}>{install}</code>
                <button type="button" className="btn btn-quiet btn-sm"
                  onClick={async () => toast((await copyText(install)) ? { tone: "success", title: "Install command copied", body: "Paste it into Windows Terminal." } : { tone: "warn", title: "Clipboard is blocked", body: install })}>
                  <Copy size={14} />
                  Copy
                </button>
              </div>
            )}
            <button type="button" className="btn btn-ghost btn-sm mt-3" onClick={() => navigate("engines")}>
              Open Engines
            </button>
          </Card>
        </div>
      </div>

      <JobBar
        job={job}
        label={items.length ? `Convert ${plural(items.length, "book")} to EPUB` : "Convert to EPUB"}
        icon={BookOpen}
        disabled={!items.length}
        hint={items.length ? listNames(items.map((i) => i.name)) : "Add an e-book to start."}
        warning={items.length && !isTauri ? "Calibre cannot run inside a browser tab. Here the run is a dry run; the desktop app does the conversion." : undefined}
        onRun={() =>
          void job.run({
            title: `${plural(items.length, "book")} → EPUB`,
            detail: listNames(items.map((i) => i.name)),
            request: { kind: "ebook.to_epub", inputs: inputsOf(items), options: { destination: { mode: dest.mode, path: dest.path } } },
          })
        }
      />
    </>
  );
}
