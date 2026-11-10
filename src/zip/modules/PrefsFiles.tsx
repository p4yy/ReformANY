import { useState } from "react";
import { FolderOpen, FolderSync, HelpCircle, ListOrdered, Plus, Rows3, Trash2, Zap } from "lucide-react";
import { toast } from "../components/Toasts";
import { Card, EmptyState, Field, Note, PageHeader, Switch } from "../components/ui";
import { isTauri, pickPaths } from "../lib/bridge";
import { useSettings, type Settings } from "../lib/settings";
import { middleEllipsis, uid } from "../lib/util";

const OUTPUT: Array<{ value: Settings["outputMode"]; title: string; desc: string; icon: typeof FolderOpen }> = [
  { value: "source", title: "Next to the source", desc: "Results appear beside the original file.", icon: Rows3 },
  { value: "fixed", title: "One fixed folder", desc: "Everything lands in the folder below.", icon: FolderOpen },
  { value: "ask", title: "Ask every time", desc: "Choose a folder when each job starts.", icon: HelpCircle },
];

const ACTIONS = ["Convert to WebP", "Convert to JPEG", "Convert to PNG", "Convert to MP4", "Convert to MP3", "Convert to PDF", "Extract archive"];

export default function PrefsFiles() {
  const { settings: s, update } = useSettings();
  const [folder, setFolder] = useState("");
  const [match, setMatch] = useState("*.png");
  const [action, setAction] = useState(ACTIONS[0]);
  const threads = navigator.hardwareConcurrency || 4;

  const browse = async (apply: (p: string) => void) => {
    const picked = await pickPaths({ directory: true, multiple: false, title: "Choose folder" });
    if (picked?.[0]) apply(picked[0]);
  };

  const addRule = () => {
    if (!folder.trim()) return;
    update({ watchRules: [...s.watchRules, { id: uid(), folder: folder.trim(), match: match.trim() || "*", action, enabled: true }] });
    setFolder("");
    toast({ tone: "success", title: "Watch rule added", body: isTauri ? `${match} in ${middleEllipsis(folder, 40)}` : "Saved. Folders are watched by the desktop app only." });
  };

  return (
    <>
      <PageHeader page="files" lead="Where results go, how many jobs run at once, and which folders convert on their own." />

      <div className="bento is-even stagger">
        <div className="stack">
          <Card title="Output destination" icon={FolderOpen}>
            <div role="radiogroup" aria-label="Output destination" className="grid gap-2">
              {OUTPUT.map((o) => (
                <button key={o.value} type="button" role="radio" aria-checked={s.outputMode === o.value} className="tile !flex-row !items-center !gap-3 !py-2.5" onClick={() => update({ outputMode: o.value })}>
                  <span className="tile-icon flex-none">
                    <o.icon size={16} />
                  </span>
                  <span className="min-w-0">
                    <span className="block font-semibold">{o.title}</span>
                    <span className="block text-[0.75rem] text-soft">{o.desc}</span>
                  </span>
                </button>
              ))}
            </div>
            {s.outputMode === "fixed" && (
              <Field label="Folder" htmlFor="out-path" className="mt-3">
                <div className="flex gap-2">
                  <input id="out-path" className="field mono" placeholder="C:\Users\you\Converted" value={s.outputPath} onChange={(e) => update({ outputPath: e.target.value })} />
                  {isTauri && (
                    <button type="button" className="btn btn-ghost" onClick={() => browse((p) => update({ outputPath: p }))}>
                      Browse
                    </button>
                  )}
                </div>
              </Field>
            )}
            <Note className="mt-3">Each workspace starts from this choice and can override it for a single job. Existing files are never overwritten.</Note>
          </Card>

          <Card title="Queue" icon={ListOrdered}>
            <div role="radiogroup" aria-label="Queue mode" className="grid-2">
              <button type="button" role="radio" aria-checked={s.queueMode === "sequential"} className="tile" onClick={() => update({ queueMode: "sequential" })}>
                <span className="flex items-center gap-2.5">
                  <span className="tile-icon"><ListOrdered size={16} /></span>
                  <span className="font-semibold">Sequential</span>
                </span>
                <span className="text-[0.78125rem] text-soft">One job at a time, in queue order. Quietest on the CPU and easiest to follow.</span>
              </button>
              <button type="button" role="radio" aria-checked={s.queueMode === "balanced"} className="tile" onClick={() => update({ queueMode: "balanced" })}>
                <span className="flex items-center gap-2.5">
                  <span className="tile-icon"><Zap size={16} /></span>
                  <span className="font-semibold">Balanced</span>
                </span>
                <span className="text-[0.78125rem] text-soft">Several jobs side by side while leaving headroom for other apps. Finishes batches sooner.</span>
              </button>
            </div>
            <p className="mono mt-3 text-[0.6875rem] text-soft">This device reports {threads} logical processors.</p>
          </Card>
        </div>

        <Card title="Watched folders" icon={FolderSync} aside={<span className="pill" data-tone={s.watchRules.some((r) => r.enabled) ? "ok" : undefined}>{s.watchRules.filter((r) => r.enabled).length} active</span>}>
          <p className="text-soft text-pretty">A rule runs one action on every new file in a folder that matches a pattern. Results follow the output destination.</p>

          <div className="mt-3 grid gap-2.5 rounded-[0.75rem] border border-line bg-app p-3">
            <Field label="Folder to watch" htmlFor="rule-folder">
              <div className="flex gap-2">
                <input id="rule-folder" className="field mono" placeholder="C:\Users\you\Downloads" value={folder} onChange={(e) => setFolder(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addRule()} />
                {isTauri && (
                  <button type="button" className="btn btn-ghost" onClick={() => browse(setFolder)}>
                    Browse
                  </button>
                )}
              </div>
            </Field>
            <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] gap-2.5">
              <Field label="Pattern" htmlFor="rule-match">
                <input id="rule-match" className="field mono" placeholder="*.png" value={match} onChange={(e) => setMatch(e.target.value)} />
              </Field>
              <Field label="Action" htmlFor="rule-action">
                <select id="rule-action" className="field" value={action} onChange={(e) => setAction(e.target.value)}>
                  {ACTIONS.map((a) => (
                    <option key={a}>{a}</option>
                  ))}
                </select>
              </Field>
            </div>
            <button type="button" className="btn btn-primary btn-sm justify-self-start" disabled={!folder.trim()} onClick={addRule}>
              <Plus size={14} />
              Add rule
            </button>
          </div>

          <div className="mt-3">
            {s.watchRules.length === 0 ? (
              <EmptyState icon={FolderSync} title="No folders are watched">
                <p>Add a rule above — for example, turn every PNG that lands in Downloads into WebP.</p>
              </EmptyState>
            ) : (
              <ul className="grid gap-1.5" aria-label="Watch rules">
                {s.watchRules.map((r) => (
                  <li key={r.id} className="flex items-center gap-3 rounded-[0.625rem] border border-line bg-app px-3 py-2">
                    <div className="min-w-0 flex-1" style={{ opacity: r.enabled ? 1 : 0.55 }}>
                      <p className="truncate font-medium">
                        <span className="mono text-bright">{r.match}</span> → {r.action}
                      </p>
                      <p className="mono truncate text-[0.6875rem] text-soft" title={r.folder}>{middleEllipsis(r.folder, 52)}</p>
                    </div>
                    <Switch checked={r.enabled} label={`Rule for ${r.match} in ${r.folder}`} onChange={(enabled) => update({ watchRules: s.watchRules.map((x) => (x.id === r.id ? { ...x, enabled } : x)) })} />
                    <button type="button" className="btn btn-icon is-danger" aria-label={`Delete rule for ${r.match}`} onClick={() => update({ watchRules: s.watchRules.filter((x) => x.id !== r.id) })}>
                      <Trash2 size={14} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          {!isTauri && <Note className="mt-3">Rules are saved here, but a browser cannot watch folders. They take effect in the desktop app.</Note>}
        </Card>
      </div>
    </>
  );
}
