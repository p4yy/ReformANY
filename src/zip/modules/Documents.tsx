import { useState } from "react";
import { FileImage, FileOutput, FileText, FileType, Presentation, Scissors, SlidersHorizontal } from "lucide-react";
import { DropZone, inputsOf, type QueueItem } from "../components/DropZone";
import { Card, Check, Chips, DestinationField, Field, JobBar, Note, PageHeader, SaveList, Segmented, useDestination, useJob } from "../components/ui";
import { isTauri } from "../lib/bridge";
import { textToHtml, textToMarkdown, type NamedBlob } from "../lib/converters";
import { EnginePill, useEngines } from "../lib/engines";
import { pdfToText } from "../lib/pdf";
import { stem } from "../lib/util";
import { MB, listNames, plural } from "./formats";

type Tab = "img2pdf" | "pdf2txt" | "txt2x" | "office" | "split";

function ImagesToPdf() {
  const job = useJob("Documents");
  const dest = useDestination();
  const [items, setItems] = useState<QueueItem[]>([]);
  const [size, setSize] = useState("a4");
  const [orient, setOrient] = useState("auto");
  const [margin, setMargin] = useState("small");
  return (
    <>
      <div className="bento stagger">
        <DropZone items={items} setItems={setItems} accept={["png", "jpg", "jpeg", "webp", "bmp", "gif", "tif", "tiff"]} maxBytes={150 * MB}
          title="Drop images — one page each" formats="PNG · JPEG · WebP · BMP · GIF · TIFF" />
        <Card title="Pages" icon={SlidersHorizontal}>
          <div className="grid gap-4">
            <Field label="Page size">
              <Segmented ariaLabel="Page size" size="sm" full value={size} onChange={setSize} options={[{ value: "a4", label: "A4" }, { value: "letter", label: "Letter" }, { value: "fit", label: "Fit image" }]} />
            </Field>
            <Field label="Orientation">
              <Segmented ariaLabel="Orientation" size="sm" full value={orient} onChange={setOrient} options={[{ value: "auto", label: "Auto" }, { value: "portrait", label: "Portrait" }, { value: "landscape", label: "Landscape" }]} />
            </Field>
            <Field label="Margin">
              <Segmented ariaLabel="Margin" size="sm" full value={margin} onChange={setMargin} options={[{ value: "none", label: "None" }, { value: "small", label: "Small" }, { value: "large", label: "Large" }]} />
            </Field>
            <DestinationField dest={dest} id="i2p-dest" />
            <Note>Pages follow the queue order. Drag rows to rearrange before building.</Note>
          </div>
        </Card>
      </div>
      <JobBar job={job} label="Build PDF" icon={FileImage} disabled={!items.length}
        hint={items.length ? `${plural(items.length, "page")} in one PDF` : "Add images to build a PDF."}
        onRun={() => void job.run({
          title: `${plural(items.length, "image")} → PDF`, detail: listNames(items.map((i) => i.name)),
          request: { kind: "doc.images_to_pdf", inputs: inputsOf(items), options: { size, orient, margin, destination: { mode: dest.mode, path: dest.path } } },
        })} />
    </>
  );
}

function PdfToText() {
  const job = useJob("Documents");
  const [items, setItems] = useState<QueueItem[]>([]);
  const [breaks, setBreaks] = useState(true);
  const [out, setOut] = useState<NamedBlob[]>([]);
  return (
    <>
      <div className="bento stagger">
        <div className="stack">
          <DropZone items={items} setItems={(v) => { setItems(v); setOut([]); }} accept={["pdf"]} maxBytes={150 * MB} title="Drop PDFs to extract their text" formats="PDF" />
          <SaveList items={out} title="Extracted text" />
        </div>
        <Card title="Text" icon={FileText}>
          <div className="grid gap-3">
            <Check checked={breaks} onChange={setBreaks}>Keep a marker between pages</Check>
            <Note>Reads the text layer of the PDF. Scanned pages without a text layer produce empty output — there is no OCR step.</Note>
          </div>
        </Card>
      </div>
      <JobBar job={job} label="Extract text" icon={FileText} disabled={!items.length}
        hint={items.length ? listNames(items.map((i) => i.name)) : "Add a PDF to start."}
        onRun={() => void job.run({
          title: `${plural(items.length, "PDF")} → text`, detail: listNames(items.map((i) => i.name)),
          request: { kind: "doc.pdf_to_text", inputs: inputsOf(items), options: { pageBreaks: breaks } },
          real: async (onProgress) => {
            const results: NamedBlob[] = [];
            let pages = 0;
            for (let i = 0; i < items.length; i++) {
              const f = items[i].file;
              if (!f) continue;
              const res = await pdfToText(f, (p, note) => onProgress((i + p) / items.length, `${items[i].name} · ${note ?? ""}`));
              pages += res.pages;
              const text = breaks ? res.text.replace(/\f/g, "──────── page break ────────") : res.text.replace(/\n\n\f\n\n/g, "\n\n");
              results.push({ name: `${stem(items[i].name)}.txt`, blob: new Blob([text], { type: "text/plain" }) });
            }
            setOut(results);
            return `${plural(pages, "page")} read from ${plural(results.length, "PDF")}`;
          },
        })} />
    </>
  );
}

const TXT_TARGETS = ["html", "md", "pdf", "docx", "odt", "rtf"];
const TXT_LOCAL = ["html", "md"];

function TextToFormats() {
  const job = useJob("Documents");
  const engines = useEngines();
  const [items, setItems] = useState<QueueItem[]>([]);
  const [target, setTarget] = useState("html");
  const [out, setOut] = useState<NamedBlob[]>([]);
  const local = TXT_LOCAL.includes(target);
  return (
    <>
      <div className="bento stagger">
        <div className="stack">
          <DropZone items={items} setItems={(v) => { setItems(v); setOut([]); }} accept={["txt", "text", "log"]} maxBytes={24 * MB} title="Drop plain-text files" formats="TXT · LOG" />
          <SaveList items={out} />
        </div>
        <Card title="Convert to" icon={FileType} aside={local ? undefined : <EnginePill state={engines.get("libreoffice")} name="LibreOffice" />}>
          <Chips ariaLabel="Target format" value={target} onChange={(v) => { setTarget(v); setOut([]); }}
            options={TXT_TARGETS.map((t) => ({ value: t, label: t.toUpperCase(), dot: !isTauri && !TXT_LOCAL.includes(t) }))} />
          <p className="mt-2.5 text-[0.75rem] text-soft">
            {target === "html" ? "A clean, self-contained page. Blank lines become paragraphs."
              : target === "md" ? "Markdown with special characters escaped so the text reads exactly as written."
              : "Laid out by LibreOffice with default page settings."}
          </p>
        </Card>
      </div>
      <JobBar job={job} label={`Convert to ${target.toUpperCase()}`} icon={FileType} disabled={!items.length}
        hint={items.length ? listNames(items.map((i) => i.name)) : "Add a text file to start."}
        warning={items.length && !isTauri && !local ? `${target.toUpperCase()} output needs LibreOffice. In this browser preview, the run is a dry run.` : undefined}
        onRun={() => void job.run({
          title: `${plural(items.length, "text file")} → ${target.toUpperCase()}`, detail: listNames(items.map((i) => i.name)),
          request: { kind: "doc.text_to", inputs: inputsOf(items), options: { target } },
          real: local ? async (onProgress) => {
            const results: NamedBlob[] = [];
            for (let i = 0; i < items.length; i++) {
              const f = items[i].file;
              if (!f) continue;
              const text = await f.text();
              const body = target === "html" ? textToHtml(text, stem(f.name)) : textToMarkdown(text);
              results.push({ name: `${stem(f.name)}.${target}`, blob: new Blob([body], { type: target === "html" ? "text/html" : "text/markdown" }) });
              onProgress((i + 1) / items.length, f.name);
            }
            setOut(results);
            return `${plural(results.length, "file")} ready to save`;
          } : undefined,
        })} />
    </>
  );
}

function OfficeToPdf() {
  const job = useJob("Documents");
  const dest = useDestination();
  const engines = useEngines();
  const [items, setItems] = useState<QueueItem[]>([]);
  return (
    <>
      <div className="bento stagger">
        <DropZone items={items} setItems={setItems} accept={["doc", "docx", "odt", "rtf", "xls", "xlsx", "ods", "ppt", "pptx", "odp"]} maxBytes={150 * MB}
          title="Drop Office documents" formats="DOCX · DOC · ODT · RTF · XLSX · XLS · ODS · PPTX · PPT · ODP" />
        <Card title="PDF output" icon={Presentation} aside={<EnginePill state={engines.get("libreoffice")} name="LibreOffice" />}>
          <div className="grid gap-4">
            <DestinationField dest={dest} id="off-dest" />
            <Note>Each document is rendered by LibreOffice in the background, one PDF per file. Fonts missing on this computer are substituted.</Note>
          </div>
        </Card>
      </div>
      <JobBar job={job} label="Convert to PDF" icon={FileOutput} disabled={!items.length}
        hint={items.length ? listNames(items.map((i) => i.name)) : "Add a document to start."}
        onRun={() => void job.run({
          title: `${plural(items.length, "document")} → PDF`, detail: listNames(items.map((i) => i.name)),
          request: { kind: "doc.office_to_pdf", inputs: inputsOf(items), options: { destination: { mode: dest.mode, path: dest.path } } },
        })} />
    </>
  );
}

function SplitPdf() {
  const job = useJob("Documents");
  const dest = useDestination();
  const [items, setItems] = useState<QueueItem[]>([]);
  const [method, setMethod] = useState("each");
  const [n, setN] = useState("10");
  const [mb, setMb] = useState("10");
  const file = items[0];
  const valid = method === "each" || (method === "pages" ? Number(n) >= 1 : Number(mb) > 0);
  return (
    <>
      <div className="bento stagger">
        <DropZone items={items} setItems={setItems} accept={["pdf"]} multiple={false} maxBytes={150 * MB} title="Drop one PDF to split" formats="PDF" />
        <Card title="Split method" icon={Scissors}>
          <div className="grid gap-4">
            <Segmented ariaLabel="Split method" size="sm" full value={method} onChange={setMethod}
              options={[{ value: "each", label: "Every page" }, { value: "pages", label: "Every N pages" }, { value: "size", label: "By size" }]} />
            {method === "pages" && (
              <Field label="Pages per file" htmlFor="sp-n">
                <input id="sp-n" className="field mono !w-28" inputMode="numeric" value={n} onChange={(e) => setN(e.target.value.replace(/\D/g, "").slice(0, 4))} />
              </Field>
            )}
            {method === "size" && (
              <Field label="Target size" htmlFor="sp-mb" hint="Each file stays at or under this size where page boundaries allow.">
                <div className="flex flex-wrap items-center gap-1.5">
                  <input id="sp-mb" className="field mono !w-24" inputMode="decimal" value={mb} onChange={(e) => setMb(e.target.value.replace(/[^\d.]/g, "").slice(0, 6))} />
                  <span className="mono mr-1 text-soft">MB</span>
                  {["1", "5", "10", "25", "100"].map((v) => (
                    <button key={v} type="button" className="chip !h-9" aria-pressed={mb === v} onClick={() => setMb(v)}>{v}</button>
                  ))}
                </div>
              </Field>
            )}
            <DestinationField dest={dest} id="sp-dest" />
          </div>
        </Card>
      </div>
      <JobBar job={job} label="Split PDF" icon={Scissors} disabled={!file || !valid}
        hint={file ? `${file.name} · ${method === "each" ? "one file per page" : method === "pages" ? `${n || "?"} pages per file` : `up to ${mb || "?"} MB per file`}` : "Add a PDF to split."}
        onRun={() => void job.run({
          title: `Split ${file.name}`, detail: method === "each" ? "One file per page" : method === "pages" ? `${n} pages per file` : `Up to ${mb} MB per file`,
          request: { kind: "doc.split_pdf", inputs: inputsOf(items), options: { method, pages: Number(n), megabytes: Number(mb), destination: { mode: dest.mode, path: dest.path } } },
        })} />
    </>
  );
}

export default function Documents() {
  const [tab, setTab] = useState<Tab>("img2pdf");
  return (
    <>
      <PageHeader page="documents" lead="Build PDFs from images, pull text out of them, and move documents between formats." />
      <Segmented
        ariaLabel="Document task"
        value={tab}
        onChange={setTab}
        className="self-start"
        options={[
          { value: "img2pdf", label: "Images → PDF", icon: FileImage },
          { value: "pdf2txt", label: "PDF → Text", icon: FileText },
          { value: "txt2x", label: "TXT → Formats", icon: FileType },
          { value: "office", label: "Office → PDF", icon: Presentation },
          { value: "split", label: "Split PDF", icon: Scissors },
        ]}
      />
      <div className="contents" hidden={tab !== "img2pdf"}><ImagesToPdf /></div>
      <div className="contents" hidden={tab !== "pdf2txt"}><PdfToText /></div>
      <div className="contents" hidden={tab !== "txt2x"}><TextToFormats /></div>
      <div className="contents" hidden={tab !== "office"}><OfficeToPdf /></div>
      <div className="contents" hidden={tab !== "split"}><SplitPdf /></div>
    </>
  );
}
