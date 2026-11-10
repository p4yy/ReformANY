import { useState } from "react";
import { Compass, Download, Replace, SlidersHorizontal, X, Zap } from "lucide-react";
import { DropZone, inputsOf, type QueueItem } from "../components/DropZone";
import { Card, Chips, DestinationField, Field, JobBar, PageHeader, Segmented, Slider, Switch, useDestination, useJob } from "../components/ui";
import { isTauri } from "../lib/bridge";
import { BROWSER_DECODABLE, BROWSER_IMAGE_FORMATS, convertImage } from "../lib/converters";
import { useSettings } from "../lib/settings";
import { downloadBlob, extOf, formatBytes, sleep, stem } from "../lib/util";
import { useShell } from "../shell/nav";
import { IMAGE_EXT, MB, listNames, plural } from "./formats";

const TARGETS = ["png", "jpeg", "webp", "bmp", "ico", "gif", "tiff", "tga", "qoi", "avif"];
const BACKGROUNDS = [
  { value: "keep", label: "Keep transparency" },
  { value: "#ffffff", label: "White" },
  { value: "#e1e6d9", label: "Paper" },
  { value: "#8b9d77", label: "Sage" },
  { value: "#11140e", label: "Ink" },
];

export default function Images() {
  const { settings, update } = useSettings();
  const { navigate } = useShell();
  const job = useJob("Images");
  const dest = useDestination();
  const [items, setItems] = useState<QueueItem[]>([]);
  const [target, setTarget] = useState("webp");
  const [quality, setQuality] = useState(86);
  const [bg, setBg] = useState("keep");
  const [maxEdge, setMaxEdge] = useState("");
  const [rotate, setRotate] = useState("0");
  const [grayscale, setGrayscale] = useState(false);

  const patch = (id: string, p: Partial<QueueItem>) => setItems((prev) => prev.map((it) => (it.id === id ? { ...it, ...p } : it)));
  const inWebview = BROWSER_IMAGE_FORMATS.includes(target);
  const outputs = items.filter((i) => i.output);
  const label = target.toUpperCase();

  const warning =
    !isTauri && !inWebview
      ? `${label} encoding runs in the desktop engine. In this browser preview, Convert performs a dry run and writes nothing.`
      : (target === "jpeg" || target === "bmp") && bg === "keep"
        ? `${label} has no alpha channel. Transparent areas will be flattened onto white — pick a background to change that.`
        : undefined;

  const convert = () => {
    const opts = {
      format: target,
      quality,
      background: bg === "keep" ? null : bg,
      maxEdge: maxEdge ? Number(maxEdge) : null,
      rotate: Number(rotate),
      grayscale,
    };
    const queue = items;
    void job.run({
      title: `${plural(queue.length, "image")} → ${label}`,
      detail: listNames(queue.map((i) => i.name)),
      request: { kind: "image.convert", inputs: inputsOf(queue), options: { ...opts, destination: { mode: dest.mode, path: dest.path } } },
      real: inWebview
        ? async (onProgress) => {
            let done = 0;
            let engine = 0;
            let failed = 0;
            for (let i = 0; i < queue.length; i++) {
              const it = queue[i];
              patch(it.id, { status: "working", note: undefined, output: undefined });
              await sleep(16);
              if (!it.file || !BROWSER_DECODABLE.includes(extOf(it.name))) {
                patch(it.id, { status: "dry", note: "Needs desktop engine" });
                engine++;
              } else {
                try {
                  const blob = await convertImage(it.file, opts);
                  patch(it.id, {
                    status: "done",
                    note: formatBytes(blob.size),
                    output: { blob, name: `${stem(it.name)}.${target === "jpeg" ? "jpg" : target}` },
                  });
                  done++;
                } catch (e) {
                  patch(it.id, { status: "failed", note: e instanceof Error ? e.message : "Failed" });
                  failed++;
                }
              }
              onProgress((i + 1) / queue.length, `${i + 1} of ${queue.length} · ${it.name}`);
            }
            if (!done) throw new Error(engine ? "These source formats decode only in the desktop app." : "No image could be converted.");
            return [`${done} converted`, engine && `${engine} need the desktop engine`, failed && `${failed} failed`].filter(Boolean).join(" · ");
          }
        : undefined,
    });
  };

  const saveAll = async () => {
    for (const it of outputs) {
      if (it.output) downloadBlob(it.output.blob, it.output.name);
      await sleep(260);
    }
  };

  return (
    <>
      <PageHeader page="images" lead="Convert, resize and flatten pictures in batches. Files stay on this device from drop to save.">
        {outputs.length > 1 && (
          <button type="button" className="btn btn-ghost btn-sm" onClick={saveAll}>
            <Download size={14} />
            Save all ({outputs.length})
          </button>
        )}
      </PageHeader>

      {settings.showIntro && (
        <div className="card flex flex-wrap items-center gap-3 !py-2.5">
          <Compass size={16} className="flex-none text-bright" />
          <p className="min-w-[14rem] flex-1 text-soft">
            <span className="font-semibold text-ink">New here?</span> The Guide covers converting and the Orbit HUD in eight short steps.
          </p>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => navigate("guide")}>
            Open guide
          </button>
          <button type="button" className="btn btn-icon" aria-label="Dismiss introduction" onClick={() => update({ showIntro: false })}>
            <X size={14} />
          </button>
        </div>
      )}

      <div className="bento stagger">
        <div className="stack">
          <DropZone
            items={items}
            setItems={setItems}
            accept={IMAGE_EXT}
            maxBytes={150 * MB}
            title="Drop images to convert"
            formats="PNG · JPEG · WebP · BMP · GIF · TIFF · ICO · TGA · QOI · SVG"
          />
          <Card title="Convert to" icon={Replace}>
            <Chips
              ariaLabel="Target image format"
              value={target}
              onChange={setTarget}
              options={TARGETS.map((t) => ({
                value: t,
                label: t.toUpperCase(),
                dot: !isTauri && !BROWSER_IMAGE_FORMATS.includes(t),
                hint: !isTauri && !BROWSER_IMAGE_FORMATS.includes(t) ? "Desktop engine — dry run in this preview" : undefined,
              }))}
            />
            {!isTauri && (
              <p className="mt-2.5 flex items-center gap-1.5 text-[0.71875rem] text-soft">
                <i className="chip-dot" aria-hidden="true" /> Dotted formats encode in the desktop engine only.
              </p>
            )}
          </Card>
        </div>

        <div className="stack">

          <Card title="Fine-tune" icon={SlidersHorizontal}>
            <div className="grid gap-4">
              <DestinationField dest={dest} id="img-dest" />
              <Field label="JPEG quality" htmlFor="img-quality" hint="Also applies to WebP. Lossless formats ignore it.">
                <Slider id="img-quality" label="JPEG quality" value={quality} onChange={setQuality} min={30} max={100} format={(v) => `${v}%`} />
              </Field>
              <Field label="Background" hint={BACKGROUNDS.find((b) => b.value === bg)?.label ?? `Custom ${bg}`}>
                <div role="radiogroup" aria-label="Background colour" className="flex flex-wrap items-center gap-2.5">
                  {BACKGROUNDS.map((b) => (
                    <button
                      key={b.value}
                      type="button"
                      role="radio"
                      aria-checked={bg === b.value}
                      aria-label={b.label}
                      title={b.label}
                      className={`swatch ${b.value === "keep" ? "is-alpha" : ""}`}
                      style={b.value === "keep" ? undefined : { background: b.value }}
                      onClick={() => setBg(b.value)}
                    />
                  ))}
                  <label className="btn btn-ghost btn-sm relative cursor-pointer">
                    Custom
                    <input
                      type="color"
                      className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
                      aria-label="Custom background colour"
                      value={bg.startsWith("#") ? bg : "#ffffff"}
                      onChange={(e) => setBg(e.target.value)}
                    />
                  </label>
                </div>
              </Field>
              <Field label="Max edge" htmlFor="img-edge" hint="Longest side in pixels. Smaller images are never enlarged.">
                <div className="flex flex-wrap gap-1.5">
                  <input
                    id="img-edge"
                    className="field mono !w-28"
                    inputMode="numeric"
                    placeholder="No limit"
                    value={maxEdge}
                    onChange={(e) => setMaxEdge(e.target.value.replace(/\D/g, "").slice(0, 5))}
                  />
                  {["1024", "2048", "4096"].map((v) => (
                    <button key={v} type="button" className="chip !h-9" aria-pressed={maxEdge === v} onClick={() => setMaxEdge(maxEdge === v ? "" : v)}>
                      {v}
                    </button>
                  ))}
                </div>
              </Field>
              <Field label="Rotate">
                <Segmented
                  ariaLabel="Rotate"
                  size="sm"
                  full
                  value={rotate}
                  onChange={setRotate}
                  options={[
                    { value: "0", label: "0°" },
                    { value: "90", label: "90°" },
                    { value: "180", label: "180°" },
                    { value: "270", label: "270°" },
                  ]}
                />
              </Field>
              <div className="flex items-center justify-between gap-3">
                <span>
                  <span className="label">Grayscale</span>
                  <span className="mt-1 block text-[0.75rem] text-soft">Drop colour, keep luminance.</span>
                </span>
                <Switch checked={grayscale} onChange={setGrayscale} label="Grayscale" />
              </div>
            </div>
          </Card>
        </div>
      </div>

      <JobBar
        job={job}
        label={items.length ? `Convert ${plural(items.length, "image")} to ${label}` : "Convert"}
        icon={Zap}
        disabled={!items.length}
        onRun={convert}
        hint={items.length ? "Originals are never modified." : "Add at least one image to start."}
        warning={items.length ? warning : undefined}
      />
    </>
  );
}
