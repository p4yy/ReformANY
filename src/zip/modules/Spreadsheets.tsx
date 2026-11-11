import { useEffect, useState } from "react";
import { Replace, Sheet, Table2 } from "lucide-react";
import { DropZone, inputsOf, type QueueItem } from "../components/DropZone";
import { Card, Chips, JobBar, Note, PageHeader, SaveList, useJob } from "../components/ui";
import { isTauri } from "../lib/bridge";
import { checkLimits, jsonToTable, parseDelimited, tableToJson, writeDelimited, type NamedBlob, type Table } from "../lib/converters";
import { extOf, stem } from "../lib/util";
import { MB, listNames, plural } from "./formats";

const TEXT_IN = ["csv", "tsv", "json"];
const TARGETS = ["xlsx", "csv", "tsv", "json"];

async function readTable(f: File): Promise<Table> {
  const ext = extOf(f.name);
  const text = await f.text();
  const table = ext === "json" ? jsonToTable(text) : parseDelimited(text, ext === "tsv" ? "\t" : ",");
  checkLimits(table);
  return table;
}

export default function Spreadsheets() {
  const job = useJob("Spreadsheets");
  const [items, setItems] = useState<QueueItem[]>([]);
  const [target, setTarget] = useState("csv");
  const [out, setOut] = useState<NamedBlob[]>([]);
  const [peek, setPeek] = useState<{ name: string; table: Table; error?: string } | null>(null);

  const first = items[0];
  useEffect(() => {
    setPeek(null);
    const f = first?.file;
    if (!f) return;
    if (!TEXT_IN.includes(extOf(f.name))) {
      setPeek({ name: f.name, table: [], error: "Workbook preview is read by the desktop engine." });
      return;
    }
    let dead = false;
    readTable(f)
      .then((table) => !dead && setPeek({ name: f.name, table }))
      .catch((e) => !dead && setPeek({ name: f.name, table: [], error: e instanceof Error ? e.message : "Could not read this file" }));
    return () => {
      dead = true;
    };
  }, [first]);

  const allText = items.every((i) => TEXT_IN.includes(extOf(i.name)));
  const local = target !== "xlsx" && allText;

  const run = () =>
    void job.run({
      title: `${plural(items.length, "sheet")} → ${target.toUpperCase()}`,
      detail: listNames(items.map((i) => i.name)),
      request: { kind: "sheet.convert", inputs: inputsOf(items), options: { target } },
      real: local
        ? async (onProgress) => {
            const results: NamedBlob[] = [];
            let rows = 0;
            for (let i = 0; i < items.length; i++) {
              const f = items[i].file;
              if (!f) continue;
              const table = await readTable(f);
              rows += Math.max(0, table.length - 1);
              const body = target === "json" ? tableToJson(table) : writeDelimited(table, target === "tsv" ? "\t" : ",");
              results.push({ name: `${stem(f.name)}.${target}`, blob: new Blob([body], { type: target === "json" ? "application/json" : "text/plain" }) });
              onProgress((i + 1) / items.length, f.name);
            }
            setOut(results);
            return `${rows.toLocaleString()} data rows written to ${plural(results.length, "file")}`;
          }
        : undefined,
    });

  const head = peek?.table[0] ?? [];
  const body = peek?.table.slice(1, 8) ?? [];

  return (
    <>
      <PageHeader page="sheets" lead="Move tables between workbook, delimited and JSON formats without opening a spreadsheet app." />

      <div className="bento stagger">
        <div className="stack">
          <DropZone
            items={items}
            setItems={(v) => {
              setItems(v);
              setOut([]);
            }}
            accept={["csv", "tsv", "json", "xlsx", "xls", "ods"]}
            maxBytes={24 * MB}
            title="Drop spreadsheets or data files"
            formats="CSV · TSV · JSON · XLSX · XLS · ODS"
          />
          <SaveList items={out} title="Converted files" />
          <Card title="First rows" icon={Table2} aside={peek ? <span className="mono max-w-[14rem] truncate text-[0.6875rem] text-soft" title={peek.name}>{peek.name}</span> : undefined}>
            {!peek ? (
              <p className="text-soft">Add a file to check that columns were detected the way you expect.</p>
            ) : peek.error ? (
              <Note>{peek.error}</Note>
            ) : (
              <>
                <div className="overflow-x-auto rounded-[0.5rem] border border-line">
                  <table className="data-table">
                    <thead>
                      <tr>{head.slice(0, 8).map((h, i) => <th key={i} scope="col" title={h}>{h || `column_${i + 1}`}</th>)}</tr>
                    </thead>
                    <tbody>
                      {body.map((r, ri) => (
                        <tr key={ri}>{head.slice(0, 8).map((_, ci) => <td key={ci} title={r[ci]}>{r[ci] ?? ""}</td>)}</tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="mono mt-2 text-[0.6875rem] text-soft">
                  {(peek.table.length - 1).toLocaleString()} rows · {head.length} columns{head.length > 8 ? " · showing the first 8" : ""}
                </p>
              </>
            )}
          </Card>
        </div>

        <div className="stack">
          <Card title="Convert to" icon={Replace}>
            <Chips
              ariaLabel="Target format"
              value={target}
              onChange={(v) => {
                setTarget(v);
                setOut([]);
              }}
              options={TARGETS.map((t) => ({ value: t, label: t.toUpperCase(), dot: !isTauri && t === "xlsx" }))}
            />
            <p className="mt-2.5 text-[0.75rem] text-soft">
              {target === "json"
                ? "An array of objects keyed by the header row. Numbers and true/false are typed; empty cells become null."
                : target === "xlsx"
                  ? "A single-sheet workbook with the header row kept as row 1."
                  : `${target === "csv" ? "Comma" : "Tab"}-separated, UTF-8, quoted only where needed.`}
            </p>
          </Card>
          <Card title="Limits" icon={Sheet}>
            <dl className="grid grid-cols-3 gap-2 text-center">
              {[
                ["50,000", "rows"],
                ["128", "columns"],
                ["24 MB", "per file"],
              ].map(([v, k]) => (
                <div key={k} className="rounded-[0.625rem] border border-line bg-app px-2 py-2.5">
                  <dd className="mono text-[0.9375rem] font-semibold text-bright">{v}</dd>
                  <dt className="label mt-1">{k}</dt>
                </div>
              ))}
            </dl>
            <Note className="mt-3">Files over a limit are stopped before anything is written, with the exact count in the message.</Note>
          </Card>
        </div>
      </div>

      <JobBar
        job={job}
        label={`Convert to ${target.toUpperCase()}`}
        icon={Replace}
        disabled={!items.length}
        onRun={run}
        hint={items.length ? listNames(items.map((i) => i.name)) : "Add a file to start."}
        warning={items.length && !isTauri && !local ? "Workbook formats (XLSX, XLS, ODS) are read and written by the desktop engine. In this browser preview, the run is a dry run." : undefined}
      />
    </>
  );
}
