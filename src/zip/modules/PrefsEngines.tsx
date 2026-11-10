import { Copy, LoaderCircle, RefreshCw } from "lucide-react";
import { toast } from "../components/Toasts";
import { Note, PageHeader } from "../components/ui";
import { isTauri } from "../lib/bridge";
import { ENGINES, useEngines } from "../lib/engines";
import { copyText, middleEllipsis } from "../lib/util";

export default function PrefsEngines() {
  const { list, refresh, get } = useEngines();
  const checking = list === null;

  const check = async () => {
    await refresh();
    toast(
      isTauri
        ? { tone: "success", title: "Engines checked", body: "Versions and paths are up to date." }
        : { tone: "info", title: "Checked what a browser can see", body: "Installed programs are only visible to the desktop app. Built-in tools are ready." },
    );
  };

  const copy = async (cmd: string, name: string) =>
    toast((await copyText(cmd)) ? { tone: "success", title: `${name} install command copied`, body: "Paste it into Windows Terminal." } : { tone: "warn", title: "Clipboard is blocked", body: cmd });

  return (
    <>
      <PageHeader page="engines" lead="The programs that do the converting. One is built in; the rest are free or commercial tools installed separately.">
        <button type="button" className="btn btn-ghost btn-sm" disabled={checking} onClick={check}>
          {checking ? <LoaderCircle size={14} className="spin" /> : <RefreshCw size={14} />}
          Check for updates
        </button>
      </PageHeader>

      <div className="grid-3 stagger">
        {ENGINES.map((e) => {
          const st = get(e.id);
          const tone = st?.state === "ready" ? "ok" : st?.state === "missing" ? "warn" : undefined;
          const label = !st ? "Checking…" : st.state === "ready" ? "Ready" : st.state === "missing" ? "Not installed" : isTauri ? "Unknown" : "Not detectable here";
          return (
            <section key={e.id} className="card flex flex-col gap-2.5">
              <header className="flex items-start justify-between gap-2">
                <h2 className="card-title">{e.name}</h2>
                <span className="pill flex-none" data-tone={tone}>{label}</span>
              </header>
              <p className="text-[0.78125rem] text-soft text-pretty">{e.use}</p>
              <dl className="mono mt-auto grid gap-1 text-[0.6875rem]">
                <div className="flex gap-2">
                  <dt className="w-14 flex-none text-muted">Version</dt>
                  <dd className="min-w-0 truncate text-soft">{st?.version ?? "—"}</dd>
                </div>
                <div className="flex gap-2">
                  <dt className="w-14 flex-none text-muted">Path</dt>
                  <dd className="min-w-0 truncate text-soft" title={st?.path}>{st?.path ? middleEllipsis(st.path, 34) : e.id === "builtin" ? "Bundled" : "—"}</dd>
                </div>
              </dl>
              {e.install && (
                <div className="flex items-center gap-1 rounded-[0.5rem] border border-line bg-app py-0.5 pl-2.5 pr-0.5">
                  <code className="mono min-w-0 flex-1 truncate text-[0.6875rem] text-soft" title={e.install}>{e.install}</code>
                  <button type="button" className="btn btn-icon flex-none" aria-label={`Copy install command for ${e.name}`} onClick={() => copy(e.install!, e.name)}>
                    <Copy size={14} />
                  </button>
                </div>
              )}
            </section>
          );
        })}
      </div>

      <Note>
        ReformANY does not bundle, modify or redistribute FFmpeg, 7-Zip, WinRAR, Calibre or LibreOffice. Each is a separate project under its own
        licence, and WinRAR is commercial software. Install commands use winget and come from each project’s published package. Names and marks
        belong to their owners.
      </Note>
    </>
  );
}
