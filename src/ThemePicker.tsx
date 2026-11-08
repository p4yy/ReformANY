import { Check, Monitor, Moon, Sun, type LucideIcon } from "lucide-react";

export type ThemePreference = "system" | "light" | "dark";

const choices: ReadonlyArray<{
  key: ThemePreference; label: string; detail: string; icon: LucideIcon;
}> = [
  { key: "system", label: "Automatic", detail: "Match Windows", icon: Monitor },
  { key: "light", label: "Light", detail: "Soft neutral", icon: Sun },
  { key: "dark", label: "Dark", detail: "Graphite", icon: Moon },
];

export default function ThemePicker({ value, onChange }: {
  value: ThemePreference;
  onChange: (next: ThemePreference) => void;
}) {
  return <div className="appearance-theme-picker" role="group" aria-label="Appearance theme">
    {choices.map(item => {
      const Icon = item.icon;
      const selected = item.key === value;
      return <button type="button" key={item.key} aria-pressed={selected}
        className={`appearance-theme-option ${selected ? "is-selected" : ""}`}
        onClick={() => onChange(item.key)}>
        <span className="appearance-theme-symbol"><Icon size={19} strokeWidth={1.8}/></span>
        <span className="appearance-theme-copy"><strong>{item.label}</strong><small>{item.detail}</small></span>
        <span className="appearance-theme-check" aria-hidden="true">{selected && <Check size={14}/>}</span>
      </button>;
    })}
  </div>;
}
