import type { ReactNode } from "react";

export function SettingRow({ title, desc, icon, children }: { title: string; desc?: ReactNode; icon?: ReactNode; children: ReactNode }) {
  return (
    <div className="row">
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-2 font-medium">
          {icon}
          {title}
        </p>
        {desc && <p className="mt-0.5 text-[0.75rem] text-soft text-pretty">{desc}</p>}
      </div>
      <div className="flex flex-none items-center gap-2">{children}</div>
    </div>
  );
}
