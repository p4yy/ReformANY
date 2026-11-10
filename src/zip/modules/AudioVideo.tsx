import { useEffect, useState } from "react";
import { AudioLines, Film, Play, Replace, Scissors, SlidersHorizontal } from "lucide-react";
import { DropZone, inputsOf, type QueueItem } from "../components/DropZone";
import { Card, Chips, DestinationField, Field, JobBar, Note, PageHeader, Segmented, useDestination, useJob } from "../components/ui";
import { isTauri } from "../lib/bridge";
import { EnginePill, useEngines } from "../lib/engines";
import { extOf, familyOf, formatTimecode, parseTimecode } from "../lib/util";
import { AUDIO_EXT, VIDEO_EXT } from "./formats";

const VIDEO = [
  { value: "mp4", label: "MP4" },
  { value: "h265", label: "H.265" },
  { value: "mkv", label: "MKV" },
  { value: "webm", label: "WebM" },
  { value: "mov", label: "MOV" },
  { value: "avi", label: "AVI" },
  { value: "wmv", label: "WMV" },
  { value: "gif", label: "GIF" },
];
const AUDIO = ["mp3", "wav", "flac", "ogg", "opus", "m4a", "aiff", "wma", "ac3"].map((v) => ({ value: v, label: v === "opus" ? "Opus" : v.toUpperCase() }));
const QUALITY = [
  { value: "compact", label: "Compact", note: "Smallest file. Fine for previews and chat." },
  { value: "balanced", label: "Balanced", note: "A sensible default for sharing." },
  { value: "high", label: "High", note: "Close to the source, noticeably larger." },
  { value: "source", label: "Source", note: "Copies streams without re-encoding when the container allows it." },
];

export default function AudioVideo() {
  const job = useJob("Audio & Video");
  const dest = useDestination();
  const engines = useEngines();
  const [items, setItems] = useState<QueueItem[]>([]);
  const [mode, setMode] = useState<"video" | "audio">("video");
  const [format, setFormat] = useState("mp4");
  const [quality, setQuality] = useState("balanced");
  const [start, setStart] = useState("00:00:00");
  const [length, setLength] = useState("");
  const [duration, setDuration] = useState<number | null>(null);

  const source = items[0];
  const sourceIsAudio = source ? familyOf(extOf(source.name)) === "audio" : false;

  // Read the real duration from the file's own metadata.
  useEffect(() => {
    setDuration(null);
    const f = source?.file;
    if (!f) return;
    const url = URL.createObjectURL(f);
    const el = document.createElement(sourceIsAudio ? "audio" : "video");
    el.preload = "metadata";
    el.onloadedmetadata = () => Number.isFinite(el.duration) && setDuration(el.duration);
    el.src = url;
    return () => {
      el.removeAttribute("src");
      URL.revokeObjectURL(url);
    };
  }, [source, sourceIsAudio]);

  useEffect(() => {
    if (sourceIsAudio && mode === "video") {
      setMode("audio");
      setFormat("mp3");
    }
  }, [sourceIsAudio, mode]);

  const s = parseTimecode(start);
  const d = parseTimecode(length);
  const startBad = start.trim() !== "" && s == null;
  const lengthBad = length.trim() !== "" && d == null;
  const pastEnd = duration != null && s != null && s >= duration;
  const from = s ?? 0;

  const trim = !source
    ? "Add a source to see what will be kept."
    : from === 0 && d == null
      ? `Whole file${duration ? ` · ${formatTimecode(duration)}` : ""}`
      : `Keeps ${formatTimecode(from)} → ${d != null ? formatTimecode(from + d) : "end"}${d != null ? ` (${formatTimecode(d)})` : ""}${duration ? ` of ${formatTimecode(duration)}` : ""}`;

  const label = (mode === "video" ? VIDEO : AUDIO).find((f) => f.value === format)?.label ?? format;
  const invalid = startBad || lengthBad || pastEnd;

  const run = () =>
    void job.run({
      title: `${source.name} → ${label}`,
      detail: `${QUALITY.find((q) => q.value === quality)?.label} quality · ${trim}`,
      request: {
        kind: "media.convert",
        inputs: inputsOf(items),
        options: { format, mode, quality, start: from, duration: d, destination: { mode: dest.mode, path: dest.path } },
      },
    });

  return (
    <>
      <PageHeader page="av" lead="Change container or codec, pull the audio out of a video, or keep only the part you need." />

      <div className="bento stagger">
        <div className="stack">
          <DropZone
            items={items}
            setItems={setItems}
            accept={[...VIDEO_EXT, ...AUDIO_EXT]}
            multiple={false}
            title="Drop one video or audio file"
            formats="MP4 · MKV · MOV · WebM · AVI · WMV · MP3 · WAV · FLAC · OGG · M4A"
          />
          <Card
            title="Convert to"
            icon={Replace}
            aside={
              <Segmented
                ariaLabel="Output type"
                size="sm"
                value={mode}
                onChange={(m) => {
                  setMode(m);
                  setFormat(m === "video" ? "mp4" : "mp3");
                }}
                options={[
                  { value: "video", label: "Video", icon: Film, disabled: sourceIsAudio },
                  { value: "audio", label: "Audio", icon: AudioLines },
                ]}
              />
            }
          >
            <Chips ariaLabel={`${mode} format`} value={format} onChange={setFormat} options={mode === "video" ? VIDEO : AUDIO} />
            <p className="mt-2.5 text-[0.75rem] text-soft">
              {mode === "audio" && !sourceIsAudio && source
                ? "Audio output from a video keeps the first audio track and drops the picture."
                : format === "gif"
                  ? "GIF has no sound and grows quickly — trim to a few seconds."
                  : format === "h265"
                    ? "H.265 in an MP4 container: smaller than H.264 at the same quality, slower to encode."
                    : "Pick the container your player or editor expects."}
            </p>
          </Card>
        </div>

        <div className="stack">
          <Card title="Output" icon={SlidersHorizontal} aside={<EnginePill state={engines.get("ffmpeg")} name="FFmpeg" />}>
            <div className="grid gap-4">
              <Field label="Quality" hint={QUALITY.find((q) => q.value === quality)?.note}>
                <Segmented ariaLabel="Quality" size="sm" full value={quality} onChange={setQuality} options={QUALITY} />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Start" htmlFor="av-start">
                  <input
                    id="av-start"
                    className="field mono"
                    placeholder="00:00:00"
                    value={start}
                    aria-invalid={startBad || pastEnd || undefined}
                    aria-describedby="av-trim"
                    onChange={(e) => setStart(e.target.value)}
                  />
                </Field>
                <Field label="Duration" htmlFor="av-length">
                  <input
                    id="av-length"
                    className="field mono"
                    placeholder="To the end"
                    value={length}
                    aria-invalid={lengthBad || undefined}
                    aria-describedby="av-trim"
                    onChange={(e) => setLength(e.target.value)}
                  />
                </Field>
              </div>
              <p id="av-trim" className={`note ${invalid ? "is-warn" : ""}`}>
                <Scissors size={14} />
                <span>
                  {startBad || lengthBad
                    ? "Use hh:mm:ss, mm:ss or plain seconds."
                    : pastEnd
                      ? `Start is past the end of the source (${formatTimecode(duration ?? 0)}).`
                      : trim}
                </span>
              </p>
              <DestinationField dest={dest} id="av-dest" />
            </div>
          </Card>
          {!isTauri && <Note>FFmpeg cannot run inside a browser tab. Here, Convert media performs a labelled dry run; the desktop app does the encode.</Note>}
        </div>
      </div>

      <JobBar
        job={job}
        label="Convert media"
        icon={Play}
        disabled={!source || invalid}
        onRun={run}
        hint={source ? trim : "Add a source file to start."}
      />
    </>
  );
}
