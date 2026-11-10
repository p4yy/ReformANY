import { useState } from "react";
import { AudioLines, Combine, Eraser, Film, FlipHorizontal2, FlipVertical2, Gauge, Play, RotateCw, Shrink, type LucideIcon } from "lucide-react";
import { DropZone, inputsOf, type QueueItem } from "../components/DropZone";
import { Card, Chips, Field, JobBar, Note, PageHeader, Segmented, useJob } from "../components/ui";
import { EnginePill, useEngines } from "../lib/engines";
import { AUDIO_EXT, VIDEO_EXT, listNames, plural } from "./formats";

interface Tool {
  id: string;
  icon: LucideIcon;
  title: string;
  desc: string;
  accept: string[];
  multi?: boolean;
  options?: { label: string; values: Array<{ value: string; label: string }>; initial: string; note?: Record<string, string> };
  note?: string;
}

const BOTH = [...VIDEO_EXT, ...AUDIO_EXT];
const TOOLS: Tool[] = [
  {
    id: "compress-video", icon: Shrink, title: "Compress video", desc: "Shrink a video and keep it watchable.", accept: VIDEO_EXT,
    options: { label: "Strength", initial: "balanced", values: [{ value: "light", label: "Light" }, { value: "balanced", label: "Balanced" }, { value: "strong", label: "Strong" }],
      note: { light: "Gentle savings, hard to tell from the source.", balanced: "The usual choice for sharing.", strong: "Smallest file, visible softening on detail." } },
  },
  {
    id: "compress-audio", icon: AudioLines, title: "Compress audio", desc: "Lower the bitrate for speech or music.", accept: AUDIO_EXT,
    options: { label: "Bitrate", initial: "128", values: ["64", "96", "128", "192"].map((v) => ({ value: v, label: `${v} kbps` })),
      note: { "64": "Speech only.", "96": "Podcasts and voice notes.", "128": "Everyday music.", "192": "Music with little audible loss." } },
  },
  {
    id: "normalize", icon: Gauge, title: "Normalize loudness", desc: "Bring a file to a standard loudness.", accept: BOTH,
    options: { label: "Target", initial: "-14", values: [{ value: "-14", label: "−14 LUFS" }, { value: "-16", label: "−16 LUFS" }, { value: "-23", label: "−23 LUFS" }],
      note: { "-14": "Common streaming target.", "-16": "Common podcast target.", "-23": "EBU R 128 broadcast target." } },
  },
  { id: "merge-audio", icon: Combine, title: "Merge audio", desc: "Join tracks end to end.", accept: AUDIO_EXT, multi: true, note: "Tracks are joined in the order shown. Drag rows to change it." },
  { id: "merge-video", icon: Film, title: "Merge video", desc: "Join clips into one file.", accept: VIDEO_EXT, multi: true, note: "Clips are joined in the order shown. Mixed resolutions are re-encoded to match the first clip." },
  {
    id: "rotate", icon: RotateCw, title: "Rotate", desc: "Turn a video by quarter turns.", accept: VIDEO_EXT,
    options: { label: "Turn", initial: "90", values: [{ value: "90", label: "90° right" }, { value: "180", label: "180°" }, { value: "270", label: "90° left" }] },
  },
  { id: "flip-h", icon: FlipHorizontal2, title: "Flip horizontal", desc: "Mirror left to right.", accept: VIDEO_EXT, note: "Mirrors the picture left to right. Audio is copied untouched." },
  { id: "flip-v", icon: FlipVertical2, title: "Flip vertical", desc: "Mirror top to bottom.", accept: VIDEO_EXT, note: "Mirrors the picture top to bottom. Audio is copied untouched." },
  { id: "strip-meta", icon: Eraser, title: "Remove metadata", desc: "Strip tags, GPS and device info.", accept: BOTH, note: "Removes title, author, location, device and software tags. Streams are copied without re-encoding." },
];

export default function MediaTools() {
  const job = useJob("Media Tools");
  const engines = useEngines();
  const [toolId, setToolId] = useState(TOOLS[0].id);
  const [items, setItems] = useState<QueueItem[]>([]);
  const [values, setValues] = useState<Record<string, string>>({});
  const tool = TOOLS.find((t) => t.id === toolId) ?? TOOLS[0];
  const value = values[tool.id] ?? tool.options?.initial ?? "";
  const ready = tool.multi ? items.length >= 2 : items.length === 1;

  const pick = (id: string) => {
    if (id === toolId) return;
    setToolId(id);
    setItems([]);
    job.reset();
  };

  const run = () =>
    void job.run({
      title: `${tool.title} · ${tool.multi ? plural(items.length, "file") : items[0].name}`,
      detail: listNames(items.map((i) => i.name)),
      request: { kind: `media.${tool.id}`, inputs: inputsOf(items), options: tool.options ? { [tool.options.label.toLowerCase()]: value } : {} },
    });

  return (
    <>
      <PageHeader page="media" lead="Nine single-purpose tools for the fixes that do not need an editor." />

      <div className="grid-3 stagger" role="group" aria-label="Media tools">
        {TOOLS.map((t) => (
          <button key={t.id} type="button" className="tile" aria-pressed={t.id === toolId} onClick={() => pick(t.id)}>
            <span className="flex items-center gap-2.5">
              <span className="tile-icon">
                <t.icon size={16} />
              </span>
              <span className="font-semibold">{t.title}</span>
            </span>
            <span className="text-[0.78125rem] text-soft">{t.desc}</span>
          </button>
        ))}
      </div>

      <Card title={tool.title} icon={tool.icon} aside={<EnginePill state={engines.get("ffmpeg")} name="FFmpeg" />}>
        <div className="bento">
          <DropZone
            key={tool.id}
            compact
            items={items}
            setItems={setItems}
            accept={tool.accept}
            multiple={!!tool.multi}
            folder={false}
            title={tool.multi ? "Drop two or more files" : "Drop one file"}
            formats={tool.accept.slice(0, 7).join(" · ").toUpperCase()}
          />
          <div className="grid content-start gap-3">
            {tool.options && (
              <Field label={tool.options.label} hint={tool.options.note?.[value]}>
                {tool.options.values.length <= 3 ? (
                  <Segmented
                    ariaLabel={tool.options.label}
                    size="sm"
                    full
                    value={value}
                    onChange={(v) => setValues((p) => ({ ...p, [tool.id]: v }))}
                    options={tool.options.values}
                  />
                ) : (
                  <Chips ariaLabel={tool.options.label} value={value} onChange={(v) => setValues((p) => ({ ...p, [tool.id]: v }))} options={tool.options.values} />
                )}
              </Field>
            )}
            {tool.note && <Note>{tool.note}</Note>}
            <Note>The result is written as a new file. The source is left as it is.</Note>
          </div>
        </div>
      </Card>

      <JobBar
        job={job}
        label={tool.title}
        icon={Play}
        disabled={!ready}
        onRun={run}
        hint={ready ? `${plural(items.length, "file")} ready.` : tool.multi ? "Add at least two files to merge." : "Add a file to start."}
      />
    </>
  );
}
