import { useState } from "react";
import { Combine, FileArchive, PackageOpen, ShieldCheck, SquareSplitHorizontal, TriangleAlert } from "lucide-react";
import { DropZone, inputsOf, type QueueItem } from "../components/DropZone";
import { Card, Check, Chips, DestinationField, Field, JobBar, Note, PageHeader, SaveList, Segmented, useDestination, useJob } from "../components/ui";
import { isTauri } from "../lib/bridge";
import { joinParts, splitFile, type NamedBlob } from "../lib/converters";
import { EnginePill, useEngines } from "../lib/engines";
import { formatBytes, stem } from "../lib/util";
import { MB, listNames, plural } from "./formats";

type Tab = "create" | "extract" | "split" | "join";

function Create() {
  const job = useJob("Archives");
  const dest = useDestination();
  const engines = useEngines();
  const [items, setItems] = useState<QueueItem[]>([]);
  const [format, setFormat] = useState("zip");
  const [level, setLevel] = useState("normal");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const fallback = items[0] ? stem(items[0].name) : "archive";
  const canEncrypt = format !== "tar";
  return (
    <>
      <div className="bento stagger">
        <DropZone items={items} setItems={setItems} accept={["*"]} title="Drop files and folders to pack" formats="ANY FILE TYPE" />
        <Card title="Archive" icon={FileArchive} aside={<EnginePill state={engines.get(format === "rar" ? "winrar" : "sevenzip")} name={format === "rar" ? "WinRAR" : "7-Zip"} />}>
          <div className="grid gap-4">
            <Field label="Format" hint={format === "rar" ? "Creating RAR needs WinRAR. ZIP and 7Z need only 7-Zip." : format === "tar" ? "TAR bundles without compressing and cannot be encrypted." : undefined}>
              <Chips ariaLabel="Archive format" value={format} onChange={setFormat} options={["zip", "7z", "tar", "rar"].map((v) => ({ value: v, label: v.toUpperCase() }))} />
            </Field>
            <Field label="Compression">
              <Segmented ariaLabel="Compression level" size="sm" full value={level} onChange={setLevel}
                options={[{ value: "store", label: "Store" }, { value: "fast", label: "Fast" }, { value: "normal", label: "Normal" }, { value: "max", label: "Maximum" }]} />
            </Field>
            <Field label="Archive name" htmlFor="arc-name">
              <div className="flex items-center gap-2">
                <input id="arc-name" className="field" placeholder={fallback} value={name} onChange={(e) => setName(e.target.value.replace(/[\\/:*?"<>|]/g, ""))} />
                <span className="mono text-soft">.{format}</span>
              </div>
            </Field>
            <Field label="Password (optional)" htmlFor="arc-pass" hint={canEncrypt ? "Leave empty for no encryption. There is no recovery if it is lost." : undefined}>
              <input id="arc-pass" type="password" className="field" autoComplete="new-password" disabled={!canEncrypt} value={canEncrypt ? password : ""} onChange={(e) => setPassword(e.target.value)} />
            </Field>
            <DestinationField dest={dest} id="arc-dest" />
          </div>
        </Card>
      </div>
      <JobBar job={job} label={`Create ${format.toUpperCase()}`} icon={FileArchive} disabled={!items.length}
        hint={items.length ? `${plural(items.length, "item")} → ${name || fallback}.${format}` : "Add files to pack."}
        onRun={() => void job.run({
          title: `${name || fallback}.${format}`,
          detail: `${plural(items.length, "item")} · ${level} compression${password && canEncrypt ? " · encrypted" : ""}`,
          request: { kind: "archive.create", inputs: inputsOf(items), options: { format, level, name: name || fallback, password: canEncrypt ? password : "", destination: { mode: dest.mode, path: dest.path } } },
        })} />
    </>
  );
}

function Extract() {
  const job = useJob("Archives");
  const dest = useDestination();
  const engines = useEngines();
  const [items, setItems] = useState<QueueItem[]>([]);
  const [ownFolder, setOwnFolder] = useState(true);
  const [password, setPassword] = useState("");
  return (
    <>
      <div className="bento stagger">
        <DropZone items={items} setItems={setItems} accept={["zip", "7z", "rar", "tar", "gz", "tgz", "bz2", "xz"]} title="Drop archives to unpack" formats="ZIP · 7Z · RAR · TAR · GZ · BZ2 · XZ" />
        <Card title="Unpack" icon={PackageOpen} aside={<EnginePill state={engines.get("sevenzip")} name="7-Zip" />}>
          <div className="grid gap-4">
            <DestinationField dest={dest} id="ext-dest" />
            <Check checked={ownFolder} onChange={setOwnFolder}>Give each archive its own folder</Check>
            <Field label="Password (if protected)" htmlFor="ext-pass">
              <input id="ext-pass" type="password" className="field" autoComplete="off" value={password} onChange={(e) => setPassword(e.target.value)} />
            </Field>
            <Note>Existing files are kept; clashing names get a numbered suffix.</Note>
          </div>
        </Card>
      </div>
      <JobBar job={job} label={`Extract ${items.length ? plural(items.length, "archive") : ""}`.trim()} icon={PackageOpen} disabled={!items.length}
        hint={items.length ? listNames(items.map((i) => i.name)) : "Add an archive to unpack."}
        onRun={() => void job.run({
          title: `Extract ${plural(items.length, "archive")}`,
          detail: listNames(items.map((i) => i.name)),
          request: { kind: "archive.extract", inputs: inputsOf(items), options: { ownFolder, password, destination: { mode: dest.mode, path: dest.path } } },
        })} />
    </>
  );
}

function Split() {
  const job = useJob("Archives");
  const [items, setItems] = useState<QueueItem[]>([]);
  const [size, setSize] = useState("25");
  const [out, setOut] = useState<NamedBlob[]>([]);
  const [sha, setSha] = useState<string | null>(null);
  const file = items[0];
  const partBytes = Math.max(0, Number(size) || 0) * MB;
  const count = file?.size && partBytes ? Math.ceil(file.size / partBytes) : 0;
  return (
    <>
      <div className="bento stagger">
        <div className="stack">
          <DropZone items={items} setItems={(v) => { setItems(v); setOut([]); setSha(null); }} accept={["*"]} multiple={false} maxBytes={isTauri ? undefined : 512 * MB}
            title="Drop one file to split" formats="ANY FILE TYPE" />
          <SaveList items={out} title="Parts and manifest" />
        </div>
        <Card title="Parts" icon={SquareSplitHorizontal}>
          <div className="grid gap-4">
            <Field label="Part size" htmlFor="split-size">
              <div className="flex flex-wrap items-center gap-1.5">
                <input id="split-size" className="field mono !w-24" inputMode="decimal" value={size} onChange={(e) => setSize(e.target.value.replace(/[^\d.]/g, "").slice(0, 6))} />
                <span className="mono mr-1 text-soft">MB</span>
                {["10", "25", "100", "700"].map((v) => (
                  <button key={v} type="button" className="chip !h-9" aria-pressed={size === v} onClick={() => setSize(v)}>{v}</button>
                ))}
              </div>
            </Field>
            <div className="rounded-[0.625rem] border border-line bg-app p-3">
              <p className="label">Output</p>
              <p className="mono mt-1.5 text-[0.78125rem] text-ink [overflow-wrap:anywhere]">
                {file ? `${file.name}.001 … .${String(Math.max(count, 1)).padStart(3, "0")}` : "name.ext.001 … .00N"}
              </p>
              <p className="mono mt-0.5 text-[0.78125rem] text-soft [overflow-wrap:anywhere]">{file ? `${file.name}.manifest.json` : "name.ext.manifest.json"}</p>
              <p className="mt-2 text-[0.75rem] text-soft">{count ? `${plural(count, "part")} of up to ${formatBytes(partBytes)}` : "Parts are numbered from .001."}</p>
            </div>
            <Note>The manifest stores the original name, size and SHA-256 so Join can prove the rebuilt file is identical.</Note>
            {sha && <p className="mono text-[0.6875rem] text-soft [overflow-wrap:anywhere]"><span className="text-bright">SHA-256</span> {sha}</p>}
          </div>
        </Card>
      </div>
      <JobBar job={job} label="Split file" icon={SquareSplitHorizontal} disabled={!file || !partBytes}
        hint={file ? `${file.name} → ${plural(count, "part")} + manifest` : "Add a file to split."}
        warning={file && count > 999 ? "That part size would create more than 999 parts. Choose a larger size." : undefined}
        onRun={() => void job.run({
          title: `Split ${file.name}`,
          detail: `${plural(count, "part")} of ${formatBytes(partBytes)} + manifest`,
          request: { kind: "archive.split", inputs: inputsOf(items), options: { partBytes } },
          real: async (onProgress) => {
            if (!file.file) throw new Error("This file is not readable here.");
            const res = await splitFile(file.file, partBytes, onProgress);
            setOut([...res.parts, res.manifest]);
            setSha(res.sha256);
            return `${plural(res.parts.length, "part")} + manifest ready to save`;
          },
        })} />
    </>
  );
}

function Join() {
  const job = useJob("Archives");
  const [items, setItems] = useState<QueueItem[]>([]);
  const [out, setOut] = useState<(NamedBlob & { sha256: string | null; verified: boolean | null }) | null>(null);
  const parts = items.filter((i) => /\.\d{3}$/.test(i.name)).length;
  const manifest = items.some((i) => i.name.endsWith(".manifest.json"));
  return (
    <>
      <div className="bento stagger">
        <div className="stack">
          <DropZone items={items} setItems={(v) => { setItems(v); setOut(null); }} accept={["*"]} title="Drop the parts and the manifest" formats=".001 · .002 · … · MANIFEST.JSON" />
          {out && <SaveList items={[out]} title="Rebuilt file" />}
        </div>
        <Card title="Verification" icon={ShieldCheck}>
          <div className="grid gap-3">
            <div className="flex flex-wrap gap-2">
              <span className="pill" data-tone={parts ? "ok" : undefined}>{plural(parts, "part")}</span>
              <span className="pill" data-tone={manifest ? "ok" : undefined}>{manifest ? "Manifest found" : "No manifest"}</span>
            </div>
            <Note>Parts are joined in numeric order. With a manifest, the rebuilt file’s SHA-256 is compared against the original.</Note>
            {!manifest && parts > 0 && <Note warn>Without the manifest the file can still be rebuilt, but it cannot be verified.</Note>}
            {out && (
              <div className="rounded-[0.625rem] border border-line bg-app p-3" role="status">
                <p className={`flex items-center gap-2 font-semibold ${out.verified === false ? "text-danger" : "text-bright"}`}>
                  {out.verified === false ? <TriangleAlert size={16} /> : <ShieldCheck size={16} />}
                  {out.verified === true ? "SHA-256 matches the original" : out.verified === false ? "SHA-256 does not match — a part is damaged or missing" : "Rebuilt, not verified"}
                </p>
                {out.sha256 && <p className="mono mt-1.5 text-[0.6875rem] text-soft [overflow-wrap:anywhere]">{out.sha256}</p>}
              </div>
            )}
          </div>
        </Card>
      </div>
      <JobBar job={job} label="Join and verify" icon={Combine} disabled={!parts}
        hint={parts ? `${plural(parts, "part")}${manifest ? " + manifest" : ""}` : "Add the .001, .002 … parts to rebuild the file."}
        onRun={() => void job.run({
          title: `Join ${plural(parts, "part")}`,
          detail: listNames(items.map((i) => i.name)),
          request: { kind: "archive.join", inputs: inputsOf(items), options: {} },
          real: async (onProgress) => {
            const files = items.map((i) => i.file).filter((f): f is File => !!f);
            const res = await joinParts(files, onProgress);
            setOut(res);
            if (res.verified === false) throw new Error("SHA-256 mismatch: the rebuilt file differs from the original.");
            return `${res.name} · ${formatBytes(res.blob.size)} · ${res.verified ? "SHA-256 verified" : "not verified"}`;
          },
        })} />
    </>
  );
}

export default function Archives() {
  const [tab, setTab] = useState<Tab>("create");
  return (
    <>
      <PageHeader page="archives" lead="Pack, unpack, or cut a large file into numbered parts that can be rebuilt and verified." />
      <Segmented
        ariaLabel="Archive task"
        value={tab}
        onChange={setTab}
        className="self-start"
        options={[
          { value: "create", label: "Create", icon: FileArchive },
          { value: "extract", label: "Extract", icon: PackageOpen },
          { value: "split", label: "Split", icon: SquareSplitHorizontal },
          { value: "join", label: "Join", icon: Combine },
        ]}
      />
      <div className="contents" hidden={tab !== "create"}><Create /></div>
      <div className="contents" hidden={tab !== "extract"}><Extract /></div>
      <div className="contents" hidden={tab !== "split"}><Split /></div>
      <div className="contents" hidden={tab !== "join"}><Join /></div>
    </>
  );
}
