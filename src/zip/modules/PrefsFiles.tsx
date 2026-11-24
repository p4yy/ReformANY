import { useEffect, useState } from "react";
import { ArrowRight, FolderOpen, FolderSync, HelpCircle, ListOrdered, Plus, Rows3, Trash2, Zap } from "lucide-react";
import { toast } from "../components/Toasts";
import { Card, EmptyState, Field, PageHeader } from "../components/ui";
import { CMD, EVT, invoke, isTauri, listen, pickPaths } from "../lib/bridge";
import { useSettings, type Settings } from "../lib/settings";
import { middleEllipsis } from "../lib/util";

const OUTPUT: Array<{ value: Settings["outputMode"]; title: string; desc: string; icon: typeof FolderOpen }> = [
  { value: "source", title: "Next to the source", desc: "Results appear beside the original file.", icon: Rows3 },
  { value: "fixed", title: "One fixed folder", desc: "Everything lands in the folder below.", icon: FolderOpen },
  { value: "ask", title: "Ask every time", desc: "Choose a folder when each job starts.", icon: HelpCircle },
];

const INPUT_FORMATS = ["png", "jpg", "jpeg", "webp", "bmp", "tiff"] as const;
const OUTPUT_FORMATS = ["pdf", "png", "jpeg", "webp", "bmp", "tiff"] as const;
type NativeWatchRule = {
  id: string;
  folder: string;
  inputExt: string;
  target: string;
  destination: string | null;
};
type NativeWatchEvent = {
  id: string;
  path: string;
  status: "processing" | "completed" | "failed";
  outputPath: string | null;
  error: string | null;
};

const canonicalFormat = (format: string) => format === "jpg" ? "jpeg" : format;

export default function PrefsFiles() {
  const { settings: s, update } = useSettings();
  const [folder, setFolder] = useState("");
  const [incoming, setIncoming] = useState<(typeof INPUT_FORMATS)[number]>("png");
  const [target, setTarget] = useState<(typeof OUTPUT_FORMATS)[number]>("webp");
  const [rules, setRules] = useState<NativeWatchRule[]>([]);
  const [loading, setLoading] = useState(isTauri);
  const [busy, setBusy] = useState(false);
  const [queueBusy, setQueueBusy] = useState(false);
  const [queueMode, setQueueMode] = useState<Settings["queueMode"]>(s.queueMode);
  const threads = navigator.hardwareConcurrency || 4;
  const supportedTargets = OUTPUT_FORMATS.filter((format) => canonicalFormat(format) !== canonicalFormat(incoming));
  const fixedDestinationMissing = s.outputMode === "fixed" && !s.outputPath.trim();

  useEffect(() => {
    if (!isTauri) {
      setLoading(false);
      return;
    }

    let alive = true;
    let dispose: (() => void) | undefined;

    void Promise.all([
      invoke<NativeWatchRule[]>(CMD.getWatchRules),
      invoke<{ mode: Settings["queueMode"] }>(CMD.getQueuePolicy),
    ]).then(([nativeRules, policy]) => {
      if (!alive) return;
      setRules(nativeRules);
      setQueueMode(policy.mode);
      update({ queueMode: policy.mode });
    }).catch((error) => {
      if (alive) toast({ tone: "danger", title: "Native preferences unavailable", body: String(error) });
    }).finally(() => {
      if (alive) setLoading(false);
    });

    void listen<NativeWatchEvent>(EVT.watchJob, (event) => {
      if (!alive) return;
      if (event.status === "completed" && event.outputPath) {
        toast({ tone: "success", title: "Automatic conversion complete", body: event.outputPath });
      } else if (event.status === "failed") {
        toast({ tone: "danger", title: "Automatic conversion failed", body: event.error || event.path });
      }
    }).then((unlisten) => {
      if (alive) dispose = unlisten;
      else unlisten();
    }).catch((error) => {
      if (alive) toast({ tone: "danger", title: "Watcher notifications unavailable", body: String(error) });
    });

    return () => {
      alive = false;
      dispose?.();
    };
  }, [update]);

  const browse = async () => {
    if (!isTauri || busy) return;
    try {
      const picked = await pickPaths({ directory: true, multiple: false, title: "Choose folder to watch" });
      if (picked?.[0]) setFolder(picked[0]);
    } catch (error) {
      toast({ tone: "danger", title: "Folder selection failed", body: String(error) });
    }
  };

  const setSchedule = async (mode: Settings["queueMode"]) => {
    if (!isTauri || queueBusy) return;
    setQueueBusy(true);
    try {
      const saved = await invoke<{ mode: Settings["queueMode"] }>(CMD.setQueuePolicy, { mode });
      setQueueMode(saved.mode);
      update({ queueMode: saved.mode });
      toast({ tone: "success", title: "Queue preference saved", body: saved.mode === "sequential" ? "Conversions will run one at a time." : "Conversions can use up to two workers." });
    } catch (error) {
      toast({ tone: "danger", title: "Queue preference was not saved", body: String(error) });
    } finally {
      setQueueBusy(false);
    }
  };

  const addRule = async () => {
    if (!isTauri || !folder.trim() || busy || loading || rules.length >= 10 || fixedDestinationMissing) return;
    setBusy(true);
    try {
      const destination = s.outputMode === "fixed" ? s.outputPath.trim() : null;
      const nativeRules = await invoke<NativeWatchRule[]>(CMD.addWatchRule, {
        folder: folder.trim(),
        inputExt: incoming,
        target,
        destination,
      });
      setRules(nativeRules);
      toast({
        tone: "success",
        title: "Folder monitoring started",
        body: `${incoming.toUpperCase()} → ${target.toUpperCase()} · ${middleEllipsis(folder.trim(), 48)}`,
      });
      setFolder("");
    } catch (error) {
      toast({ tone: "danger", title: "Could not start folder monitoring", body: String(error) });
    } finally {
      setBusy(false);
    }
  };

  const removeRule = async (rule: NativeWatchRule) => {
    if (!isTauri || busy) return;
    setBusy(true);
    try {
      const remaining = await invoke<NativeWatchRule[]>(CMD.removeWatchRule, { id: rule.id });
      setRules(remaining);
      toast({ tone: "success", title: "Folder monitoring stopped", body: middleEllipsis(rule.folder, 56) });
    } catch (error) {
      toast({ tone: "danger", title: "Could not stop folder monitoring", body: String(error) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHeader page="files" lead="Choose where results go, how conversion jobs are scheduled, and which folders convert automatically." />

      <div className="bento is-even stagger">
        <div className="stack">
          <Card title="Output destination" icon={FolderOpen}>
            <div role="radiogroup" aria-label="Output destination" className="grid gap-2">
              {OUTPUT.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  role="radio"
                  aria-checked={s.outputMode === option.value}
                  className="tile !flex-row !items-center !gap-3 !py-2.5"
                  onClick={() => update({ outputMode: option.value })}
                >
                  <span className="tile-icon flex-none"><option.icon size={16} /></span>
                  <span className="min-w-0">
                    <span className="block font-semibold">{option.title}</span>
                    <span className="block text-[0.75rem] text-soft">{option.desc}</span>
                  </span>
                </button>
              ))}
            </div>
            {s.outputMode === "fixed" && (
              <Field label="Folder" htmlFor="out-path" className="mt-3">
                <div className="flex gap-2">
                  <input
                    id="out-path"
                    className="field mono"
                    placeholder="C:\\Users\\you\\Converted"
                    value={s.outputPath}
                    onChange={(event) => update({ outputPath: event.target.value })}
                  />
                  {isTauri && (
                    <button
                      type="button"
                      className="btn btn-ghost"
                      onClick={async () => {
                        const picked = await pickPaths({ directory: true, multiple: false, title: "Choose output folder" });
                        if (picked?.[0]) update({ outputPath: picked[0] });
                      }}
                    >
                      Browse
                    </button>
                  )}
                </div>
              </Field>
            )}
            <p className="mt-3 text-[0.75rem] text-soft">Each workspace starts from this choice and can override it for one job. Existing files are never overwritten.</p>
          </Card>

          <Card title="Queue" icon={ListOrdered}>
            <div role="radiogroup" aria-label="Queue mode" className="grid-2">
              <button
                type="button"
                role="radio"
                aria-checked={queueMode === "sequential"}
                aria-disabled={!isTauri || queueBusy || loading}
                disabled={!isTauri || queueBusy || loading}
                className="tile"
                onClick={() => void setSchedule("sequential")}
              >
                <span className="flex items-center gap-2.5">
                  <span className="tile-icon"><ListOrdered size={16} /></span>
                  <span className="font-semibold">Sequential</span>
                </span>
                <span className="text-[0.78125rem] text-soft">One job at a time, in queue order. Quietest on the CPU and easiest to follow.</span>
              </button>
              <button
                type="button"
                role="radio"
                aria-checked={queueMode === "balanced"}
                aria-disabled={!isTauri || queueBusy || loading}
                disabled={!isTauri || queueBusy || loading}
                className="tile"
                onClick={() => void setSchedule("balanced")}
              >
                <span className="flex items-center gap-2.5">
                  <span className="tile-icon"><Zap size={16} /></span>
                  <span className="font-semibold">Balanced</span>
                </span>
                <span className="text-[0.78125rem] text-soft">Use up to two workers where supported, leaving headroom for other apps.</span>
              </button>
            </div>
            <p className="mono mt-3 text-[0.6875rem] text-soft">This device reports {threads} logical processors. Queue mode is stored by the native engine and shared with Orbit.</p>
            {!isTauri && <p className="mt-2 text-[0.75rem] text-soft">Queue controls become active in the installed Windows application.</p>}
          </Card>
        </div>

        <Card
          title="Watched folders"
          icon={FolderSync}
          aside={<span className="pill" data-tone={rules.length ? "ok" : undefined}>{rules.length} / 10 active</span>}
        >
          <p className="text-soft text-pretty">Automatically convert new images placed directly inside a watched folder. Monitoring runs locally in the Windows app and resumes when ReformANY starts.</p>

          <div className="mt-3 grid gap-2.5 rounded-[0.75rem] border border-line bg-app p-3">
            <Field label="Folder to watch" htmlFor="rule-folder">
              <div className="flex gap-2">
                <input
                  id="rule-folder"
                  className="field mono"
                  placeholder="C:\\Users\\you\\Downloads"
                  value={folder}
                  onChange={(event) => setFolder(event.target.value)}
                  disabled={!isTauri || busy}
                />
                <button type="button" className="btn btn-ghost" onClick={() => void browse()} disabled={!isTauri || busy}>
                  Browse
                </button>
              </div>
            </Field>

            <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)] gap-2.5">
              <Field label="Incoming image type" htmlFor="rule-input">
                <select
                  id="rule-input"
                  className="field"
                  value={incoming}
                  disabled={!isTauri || busy}
                  onChange={(event) => {
                    const next = event.target.value as (typeof INPUT_FORMATS)[number];
                    setIncoming(next);
                    if (canonicalFormat(target) === canonicalFormat(next)) {
                      setTarget(OUTPUT_FORMATS.find((format) => canonicalFormat(format) !== canonicalFormat(next)) ?? "pdf");
                    }
                  }}
                >
                  {INPUT_FORMATS.map((format) => <option key={format} value={format}>{format.toUpperCase()}</option>)}
                </select>
              </Field>
              <Field label="Convert to" htmlFor="rule-output">
                <select
                  id="rule-output"
                  className="field"
                  value={target}
                  disabled={!isTauri || busy}
                  onChange={(event) => setTarget(event.target.value as (typeof OUTPUT_FORMATS)[number])}
                >
                  {supportedTargets.map((format) => <option key={format} value={format}>{format.toUpperCase()}</option>)}
                </select>
              </Field>
            </div>

            <button
              type="button"
              className="btn btn-primary btn-sm justify-self-start"
              disabled={!isTauri || loading || busy || !folder.trim() || rules.length >= 10 || fixedDestinationMissing}
              onClick={() => void addRule()}
            >
              <Plus size={14} />
              {busy ? "Working…" : "Start watching"}
            </button>
          </div>

          {fixedDestinationMissing && (
            <p className="mt-2 text-[0.75rem] text-danger">Choose a valid fixed output folder above, or switch to another destination before starting a watcher.</p>
          )}
          {s.outputMode === "ask" && (
            <p className="mt-2 text-[0.75rem] text-soft">Background conversions cannot pause to ask for a folder. Watched files will be saved beside their originals.</p>
          )}
          {s.outputMode !== "fixed" && (
            <p className="mt-2 text-[0.75rem] text-soft">Watched conversions save beside each source file unless a fixed output folder is selected.</p>
          )}

          <div className="mt-3">
            {loading ? (
              <p className="text-[0.8125rem] text-soft" role="status">Loading native folder rules…</p>
            ) : rules.length === 0 ? (
              <EmptyState icon={FolderSync} title={isTauri ? "No folders are watched" : "Desktop app required"}>
                <p>{isTauri ? "Add a rule above — for example, convert every PNG placed in Downloads into WebP." : "A browser cannot monitor local folders. Start the installed Windows application to configure real folder watches."}</p>
              </EmptyState>
            ) : (
              <ul className="grid gap-1.5" aria-label="Active watched folders">
                {rules.map((rule) => (
                  <li key={rule.id} className="flex items-center gap-3 rounded-[0.625rem] border border-line bg-app px-3 py-2">
                    <div className="tile-icon flex-none"><FolderSync size={16} /></div>
                    <div className="min-w-0 flex-1">
                      <p className="flex items-center gap-1.5 font-medium">
                        <span className="mono text-bright">{rule.inputExt.toUpperCase()}</span>
                        <ArrowRight size={13} className="text-muted" />
                        <span>{rule.target.toUpperCase()}</span>
                      </p>
                      <p className="mono truncate text-[0.6875rem] text-soft" title={rule.folder}>{middleEllipsis(rule.folder, 52)}</p>
                      <p className="text-[0.6875rem] text-muted">{rule.destination ? `Save to ${middleEllipsis(rule.destination, 42)}` : "Save beside each source file"}</p>
                    </div>
                    <button
                      type="button"
                      className="btn btn-icon is-danger"
                      aria-label={`Stop watching ${rule.folder}`}
                      disabled={busy}
                      onClick={() => void removeRule(rule)}
                    >
                      <Trash2 size={14} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          {!isTauri && <p className="mt-3 text-[0.75rem] text-soft">This preview does not create fake rules or simulate background file monitoring.</p>}
        </Card>
      </div>
    </>
  );
}
