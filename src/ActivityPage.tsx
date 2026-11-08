import { Check, CircleAlert, Clock3, Folder, Trash2 } from "lucide-react";

export type ActivityEntry = {
  id: string;
  name: string;
  target: string;
  outputPath: string | null;
  error: string | null;
  status: "completed" | "failed" | "cancelled";
  timestamp: number;
};

export default function ActivityPage({ items, onClear, onReveal, onOpenWorkspace }: {
  items: ReadonlyArray<ActivityEntry>;
  onClear: () => void;
  onReveal: (path: string) => void;
  onOpenWorkspace: () => void;
}) {
  return <div className="content page-panel">
    <div className="eyebrow">ACTIVITY</div>
    <div className="activity-heading">
      <div><h1>Recent activity</h1><p>Conversion history stored on this device.</p></div>
      {items.length > 0 && <button type="button" className="text-action" onClick={onClear}>
        <Trash2 size={15} aria-hidden="true"/> Clear history
      </button>}
    </div>
    {items.length > 0 ? <div className="activity-list">
      {items.map(item => <div className="activity-item" key={item.id}>
        <div className={`activity-symbol ${item.status}`}>
          {item.status === "completed" ? <Check size={18}/> : <CircleAlert size={18}/>}
        </div>
        <div>
          <strong title={item.name}>{item.name}</strong>
          <small>{item.outputPath || item.error || item.status}</small>
          <small>{new Date(item.timestamp).toLocaleString()} · {item.target.toUpperCase()}</small>
        </div>
        {item.outputPath && <button type="button" className="text-action"
          aria-label={`Reveal ${item.name} in Explorer`}
          onClick={() => onReveal(item.outputPath!)}>
          <Folder size={15} aria-hidden="true"/> Show
        </button>}
        <span>{item.status}</span>
      </div>)}
    </div> : <div className="blank-state">
      <Clock3 size={25} aria-hidden="true"/>
      <strong>No activity yet</strong>
      <p>Completed jobs and errors will appear here.</p>
      <button type="button" className="button secondary" onClick={onOpenWorkspace}>Open workspace</button>
    </div>}
  </div>;
}
