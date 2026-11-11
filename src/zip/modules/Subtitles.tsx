import { useState } from "react";
import { ArrowLeftRight, Captions, Eye } from "lucide-react";
import { DropZone, inputsOf, type QueueItem } from "../components/DropZone";
import { Card, JobBar, Note, PageHeader, SaveList, useJob } from "../components/ui";
import { srtToVtt, vttToSrt, type NamedBlob } from "../lib/converters";
import { extOf, stem } from "../lib/util";
import { MB, listNames, plural } from "./formats";

export default function Subtitles() {
  const job = useJob("Subtitles");
  const [items, setItems] = useState<QueueItem[]>([]);
  const [out, setOut] = useState<NamedBlob[]>([]);
  const [sample, setSample] = useState<{ name: string; text: string } | null>(null);
  const srt = items.filter((i) => extOf(i.name) === "srt").length;
  const vtt = items.length - srt;

  const run = () =>
    void job.run({
      title: `${plural(items.length, "subtitle file")} converted`,
      detail: listNames(items.map((i) => i.name)),
      request: { kind: "subtitle.convert", inputs: inputsOf(items), options: {} },
      real: async (onProgress) => {
        const results: NamedBlob[] = [];
        let cues = 0;
        let first: { name: string; text: string } | null = null;
        for (let i = 0; i < items.length; i++) {
          const f = items[i].file;
          if (!f) continue;
          const toVtt = extOf(f.name) === "srt";
          const res = toVtt ? srtToVtt(await f.text()) : vttToSrt(await f.text());
          const name = `${stem(f.name)}.${toVtt ? "vtt" : "srt"}`;
          cues += res.cues;
          results.push({ name, blob: new Blob([res.text], { type: toVtt ? "text/vtt" : "application/x-subrip" }) });
          first ??= { name, text: res.text.split("\n").slice(0, 14).join("\n") };
          onProgress((i + 1) / items.length, f.name);
        }
        setOut(results);
        setSample(first);
        return `${plural(cues, "cue")} across ${plural(results.length, "file")}`;
      },
    });

  return (
    <>
      <PageHeader page="subtitles" lead="Switch subtitle files between SubRip and WebVTT. Timing and line breaks are kept as written." />

      <div className="bento stagger">
        <div className="stack">
          <DropZone
            items={items}
            setItems={(v) => {
              setItems(v);
              setOut([]);
              setSample(null);
            }}
            accept={["srt", "vtt"]}
            maxBytes={24 * MB}
            title="Drop SRT or VTT files"
            formats="SRT · VTT"
          />
          <SaveList items={out} title="Converted subtitles" />
        </div>

        <div className="stack">
          <Card title="Direction" icon={ArrowLeftRight}>
            <div className="grid gap-2">
              {[
                { from: "SRT", to: "VTT", n: srt },
                { from: "VTT", to: "SRT", n: vtt },
              ].map((r) => (
                <div key={r.from} className="flex items-center gap-3 rounded-[0.625rem] border border-line bg-app px-3 py-2">
                  <span className="tag" data-family="doc">{r.from}</span>
                  <ArrowLeftRight size={14} className="text-muted" />
                  <span className="tag" data-family="image">{r.to}</span>
                  <span className="mono ml-auto text-[0.75rem] text-soft">{plural(r.n, "file")}</span>
                </div>
              ))}
            </div>
            <Note className="mt-3">The direction is chosen per file from its extension, so a mixed batch converts in one run.</Note>
          </Card>
          <Card title="Output preview" icon={Eye}>
            {sample ? (
              <>
                <p className="mono mb-2 truncate text-[0.6875rem] text-bright" title={sample.name}>{sample.name}</p>
                <pre className="mono max-h-56 overflow-auto rounded-[0.5rem] bg-app p-3 text-[0.71875rem] leading-relaxed text-soft">{sample.text}</pre>
              </>
            ) : (
              <p className="text-soft">The first lines of the first converted file appear here after a run.</p>
            )}
          </Card>
        </div>
      </div>

      <JobBar
        job={job}
        label={items.length ? `Convert ${plural(items.length, "file")}` : "Convert"}
        icon={Captions}
        disabled={!items.length}
        onRun={run}
        hint={items.length ? `${srt} SRT → VTT · ${vtt} VTT → SRT` : "Add a subtitle file to start."}
      />
    </>
  );
}
