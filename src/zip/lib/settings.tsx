import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { CMD, invoke, isTauri } from "./bridge";
import { setOrbitAudio } from "./sound";

export type ModKey = "Shift" | "Control" | "Alt";
export type Section = "convert" | "tools" | "actions";
export const SECTIONS: Section[] = ["convert", "tools", "actions"];
export const MOD_KEYS: ModKey[] = ["Shift", "Control", "Alt"];
export const MOD_LABEL: Record<ModKey, string> = { Shift: "Shift", Control: "Ctrl", Alt: "Alt" };
export const SECTION_LABEL: Record<Section, string> = { convert: "Convert", tools: "Tools", actions: "Actions" };

export interface WatchRule {
  id: string;
  folder: string;
  match: string;
  action: string;
  enabled: boolean;
}

export interface Settings {
  theme: "system" | "light" | "dark";
  language: "en" | "de" | "es" | "fr";
  accent: "sage";
  showIntro: boolean;
  closeToTray: boolean;
  orbitSounds: boolean;
  orbitVolume: number;
  orbitStartSection: Section;
  orbitScrollSections: boolean;
  orbitKeys: Record<Section, ModKey>;
  shakeEnabled: boolean;
  shakeSensitivity: number;
  pointerRing: boolean;
  outputMode: "source" | "fixed" | "ask";
  outputPath: string;
  queueMode: "sequential" | "balanced";
  watchRules: WatchRule[];
  sidebarCollapsed: boolean;
}

export const ORBIT_KEY_DEFAULTS: Record<Section, ModKey> = { convert: "Shift", tools: "Control", actions: "Alt" };

export const DEFAULTS: Settings = {
  theme: "dark",
  language: "en",
  accent: "sage",
  showIntro: true,
  closeToTray: true,
  orbitSounds: true,
  orbitVolume: 65,
  orbitStartSection: "convert",
  orbitScrollSections: true,
  orbitKeys: ORBIT_KEY_DEFAULTS,
  shakeEnabled: true,
  shakeSensitivity: 6,
  pointerRing: true,
  outputMode: "source",
  outputPath: "",
  queueMode: "balanced",
  watchRules: [],
  sidebarCollapsed: false,
};

const KEY = "reformany.settings.v1";

function merge(raw: unknown): Settings {
  const p = (raw && typeof raw === "object" ? raw : {}) as Partial<Settings>;
  return { ...DEFAULTS, ...p, language: "en", orbitKeys: { ...ORBIT_KEY_DEFAULTS, ...(p.orbitKeys ?? {}) } };
}

function load(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return merge(JSON.parse(raw));
  } catch {
    /* storage unavailable */
  }
  return DEFAULTS;
}

/* Navigation and page titles are translated; body copy stays English for now. */
const DICT: Record<Settings["language"], Record<string, string>> = {
  en: {
    workspace: "Workspace", app: "ReformANY", preferences: "Preferences",
    images: "Images", av: "Audio & Video", media: "Media Tools", archives: "Archives", documents: "Documents",
    subtitles: "Subtitles", sheets: "Spreadsheets", preview: "Preview", ebooks: "E-books",
    activity: "Activity", guide: "Guide", appearance: "Settings", files: "Files & Jobs", engines: "Engines",
    collapse: "Collapse sidebar", expand: "Expand sidebar",
  },
  de: {
    workspace: "Arbeitsbereich", app: "ReformANY", preferences: "Einstellungen",
    images: "Bilder", av: "Audio & Video", media: "Medienwerkzeuge", archives: "Archive", documents: "Dokumente",
    subtitles: "Untertitel", sheets: "Tabellen", preview: "Vorschau", ebooks: "E-Books",
    activity: "Aktivität", guide: "Anleitung", appearance: "Darstellung", files: "Dateien & Aufträge", engines: "Engines",
    collapse: "Seitenleiste einklappen", expand: "Seitenleiste ausklappen",
  },
  es: {
    workspace: "Espacio de trabajo", app: "ReformANY", preferences: "Preferencias",
    images: "Imágenes", av: "Audio y vídeo", media: "Herramientas multimedia", archives: "Archivos comprimidos", documents: "Documentos",
    subtitles: "Subtítulos", sheets: "Hojas de cálculo", preview: "Vista previa", ebooks: "Libros electrónicos",
    activity: "Actividad", guide: "Guía", appearance: "Apariencia", files: "Archivos y tareas", engines: "Motores",
    collapse: "Contraer barra lateral", expand: "Expandir barra lateral",
  },
  fr: {
    workspace: "Espace de travail", app: "ReformANY", preferences: "Préférences",
    images: "Images", av: "Audio et vidéo", media: "Outils multimédias", archives: "Archives", documents: "Documents",
    subtitles: "Sous-titres", sheets: "Feuilles de calcul", preview: "Aperçu", ebooks: "Livres numériques",
    activity: "Activité", guide: "Guide", appearance: "Apparence", files: "Fichiers et tâches", engines: "Moteurs",
    collapse: "Réduire la barre latérale", expand: "Développer la barre latérale",
  },
};

export const LANGS: Array<{ value: Settings["language"]; label: string }> = [
  { value: "en", label: "English" },
];

interface Ctx {
  settings: Settings;
  update: (patch: Partial<Settings>) => void;
  t: (key: string) => string;
}
const SettingsContext = createContext<Ctx | null>(null);

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<Settings>(load);
  const hydrated = useRef(false);

  // Desktop: the Rust-side store is the source of truth once it answers.
  useEffect(() => {
    if (!isTauri) return;
    invoke<unknown>(CMD.loadSettings)
      .then((remote) => remote && setSettings((s) => merge({ ...s, ...(remote as object) })))
      .catch(() => {})
      .finally(() => (hydrated.current = true));
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(settings));
    } catch {
      /* ignore */
    }
    if (isTauri && hydrated.current) invoke(CMD.saveSettings, { settings }).catch(() => {});
  }, [settings]);

  // Theme
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: light)");
    const apply = () => {
      const mode = settings.theme === "system" ? (mq.matches ? "light" : "dark") : settings.theme;
      document.documentElement.dataset.theme = mode;
    };
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, [settings.theme]);

  useEffect(() => {
    document.documentElement.lang = settings.language;
  }, [settings.language]);

  // Real volume: Web Audio master gain, plus the native mixer when on desktop.
  useEffect(() => {
    setOrbitAudio(settings.orbitSounds, settings.orbitVolume);
    if (isTauri) {
      invoke(CMD.setOrbitVolume, { volume: settings.orbitSounds ? settings.orbitVolume / 100 : 0 }).catch(() => {});
    }
  }, [settings.orbitSounds, settings.orbitVolume]);

  const update = useCallback((patch: Partial<Settings>) => setSettings((s) => ({ ...s, ...patch })), []);
  const t = useCallback((key: string) => DICT[settings.language][key] ?? DICT.en[key] ?? key, [settings.language]);
  const value = useMemo(() => ({ settings, update, t }), [settings, update, t]);

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

export function useSettings(): Ctx {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error("useSettings must be used inside SettingsProvider");
  return ctx;
}
