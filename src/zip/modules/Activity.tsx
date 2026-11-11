import { useEffect, useState } from "react";
import { CircleCheck, CircleDashed, History, Trash2, TriangleAlert } from "lucide-react";
import { EmptyState, PageHeader, Segmented } from "../components/ui";
import { activity, useActivity, type ActivityEntry } from "../lib/activity";
import { timeAgo } from "../lib/util";
import { useShell } from "../shell/nav";

type Filter = "all" | ActivityEntry["status"];

const STATUS = {
  done: { icon: CircleCheck, label: "Done", tone: "ok" },
  dry: { icon: CircleDashed, label: "Dry run", tone: "info" },
  failed: { icon: TriangleAlert, label: "Failed", tone: "warn" },
} as const;

export default function Activity() {
  const entries = useActivity();
  const { navigate } = useShell();
  const [filter, setFilter] = useState<Filter>("all");
  const [arming, setArming] = useState(false);
  const list = filter === "all" ? entries : entries.filter((e) => e.status === filter);
  const count = (s: ActivityEntry["status"]) => entries.filter((e) => e.status === s).length;

  useEffect(() => {
    if (!arming) return;
    const t = setTimeout(() => setArming(false), 3500);
    return () => clearTimeout(t);
  }, [arming]);

  return (
    <>
      <PageHeader page="activity" lead="A history of the jobs run on this device. It is stored locally and never leaves it." />

      {entries.length === 0 ? (
        <EmptyState icon={History} title="Nothing has run yet">
          <p>Finished conversions, dry runs and failures are listed here with what was converted and when.</p>
          <button type="button" className="btn btn-primary mt-4" onClick={() => navigate("images")}>
            Convert some images
          </button>
        </EmptyState>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-3">
            <Segmented
              ariaLabel="Filter history"
              size="sm"
              value={filter}
              onChange={setFilter}
              options={[
                { value: "all", label: `All ${entries.length}` },
                { value: "done", label: `Done ${count("done")}` },
                { value: "dry", label: `Dry runs ${count("dry")}` },
                { value: "failed", label: `Failed ${count("failed")}` },
              ]}
            />
            <button
              type="button"
              className={`btn btn-sm ml-auto ${arming ? "btn-danger" : "btn-ghost"}`}
              onClick={() => {
                if (arming) {
                  activity.clear();
                  setArming(false);
                } else setArming(true);
              }}
            >
              <Trash2 size={14} />
              {arming ? "Click again to clear history" : "Clear history"}
            </button>
          </div>

          {list.length === 0 ? (
            <div className="empty">
              <p>No entries match this filter.</p>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setFilter("all")}>
                Show all
              </button>
            </div>
          ) : (
            <ul className="card stagger !p-0" aria-label="Job history">
              {list.map((e) => {
                const s = STATUS[e.status];
                return (
                  <li key={e.id} className="flex items-center gap-3 border-b border-line px-3.5 py-2.5 last:border-b-0">
                    <s.icon size={16} className={e.status === "failed" ? "flex-none text-danger" : e.status === "done" ? "flex-none text-bright" : "flex-none text-muted"} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium" title={e.title}>{e.title}</p>
                      <p className="truncate text-[0.75rem] text-soft" title={e.detail}>{e.detail}</p>
                    </div>
                    <span className="pill max-[560px]:hidden">{e.module}</span>
                    <span className="pill" data-tone={s.tone}>{s.label}</span>
                    <time className="mono w-[4.5rem] flex-none text-right text-[0.6875rem] text-muted" dateTime={new Date(e.at).toISOString()}>
                      {timeAgo(e.at)}
                    </time>
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}
    </>
  );
}
