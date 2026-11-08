/** Versioned local Orbit preferences; no hidden remote sync or shell injections. */
export type OrbitTab = "convert" | "tools" | "actions";
export type BuiltInAction = "convert" | "zip" | "7z" | "extract" | "more" |
  "rename" | "copy" | "folder" | "terminal" | "copyFile" | "float" | "bluetooth";
export type OrbitAction = BuiltInAction | "openWith" | "preset" | "chain";
export type RecipeStep = { type: "convert"; format: string; quality: number; maxEdge: number | null }
  | { type: "zip" };
export type OrbitSlice = {
  id: string;
  label: string;
  action: OrbitAction;
  enabled: boolean;
  format?: string;
  appPath?: string;
  steps?: RecipeStep[];
};
export type OrbitPreferences = {
  version: 1;
  mouseShake: boolean;
  mouseWheel: boolean;
  loadingSpin: boolean;
  shakeOpens: OrbitTab;
  wheelOpens: OrbitTab;
  slices: Record<OrbitTab, OrbitSlice[]>;
};

export const ORBIT_SETTINGS_KEY = "reformany.orbit.preferences.v1";
export const IMAGE_FORMATS = ["png", "jpeg", "webp", "bmp", "gif", "tiff"] as const;
export const MEDIA_FORMATS = ["mp3", "wav", "flac", "m4a", "mp4", "webm", "mkv", "mov"];
export const ORBIT_TABS: OrbitTab[] = ["convert", "tools", "actions"];
const builtin = (action: BuiltInAction, label: string, format?: string): OrbitSlice =>
  ({ id: format ? `builtin:${action}:${format}` : `builtin:${action}`, label, action, format, enabled: true });

const defaults: OrbitPreferences = {
  version: 1,
  mouseShake: false,
  mouseWheel: true,
  loadingSpin: true,
  shakeOpens: "convert",
  wheelOpens: "tools",
  slices: {
    convert: [
      builtin("convert","PNG","png"), builtin("convert","JPEG","jpeg"),
      builtin("convert","WebP","webp"), builtin("convert","BMP","bmp"),
      builtin("convert","GIF","gif"), builtin("convert","TIFF","tiff"),
      ...MEDIA_FORMATS.map(format => builtin("convert",format.toUpperCase(),format)),
    ],
    tools: [builtin("zip","ZIP"), builtin("7z","7z"), builtin("extract","Extract"), builtin("more","More")],
    actions: [builtin("rename","Rename"), builtin("copy","Copy path"), builtin("folder","Show file"),
      builtin("terminal","Terminal"), builtin("copyFile","Copy file"),
      builtin("float","Float"), builtin("bluetooth","Bluetooth")],
  },
};

export function defaultOrbitPreferences(): OrbitPreferences {
  return structuredClone(defaults);
}
const actions: OrbitAction[] = ["convert","zip","7z","extract","more","rename","copy",
  "folder","terminal","copyFile","float","bluetooth","openWith","preset","chain"];
const isTab = (x: unknown): x is OrbitTab => typeof x === "string" && ORBIT_TABS.includes(x as OrbitTab);
const allowedFormats = [...IMAGE_FORMATS,...MEDIA_FORMATS];
function sanitizeStep(step: unknown): RecipeStep | null {
  if (!step || typeof step !== "object") return null;
  const candidate = step as Record<string, unknown>;
  if (candidate.type === "zip") return { type: "zip" };
  if (candidate.type !== "convert" || typeof candidate.format !== "string" ||
    !IMAGE_FORMATS.includes(candidate.format as typeof IMAGE_FORMATS[number])) return null;
  const quality = typeof candidate.quality === "number" && Number.isInteger(candidate.quality)
    ? Math.max(1,Math.min(100,candidate.quality)) : 88;
  const edge = candidate.maxEdge === null ? null :
    typeof candidate.maxEdge === "number" && Number.isInteger(candidate.maxEdge)
    && candidate.maxEdge >= 128 && candidate.maxEdge <= 8192 ? candidate.maxEdge : null;
  return { type: "convert", format: candidate.format, quality, maxEdge: edge };
}
function sanitizeSlice(input: unknown): OrbitSlice | null {
  if (!input || typeof input !== "object") return null;
  const candidate = input as Record<string,unknown>;
  if (typeof candidate.id !== "string" || candidate.id.length > 90 ||
    typeof candidate.label !== "string" || !candidate.label.trim() || candidate.label.length > 32 ||
    !actions.includes(candidate.action as OrbitAction)) return null;
  const slice: OrbitSlice = {
    id: candidate.id,
    label: candidate.label.trim(),
    action: candidate.action as OrbitAction,
    enabled: candidate.enabled !== false,
  };
  if (slice.action === "convert") {
    if (typeof candidate.format !== "string" || !allowedFormats.includes(candidate.format)) return null;
    slice.format = candidate.format;
  }
  if (slice.action === "openWith") {
    if (typeof candidate.appPath !== "string" || !candidate.appPath.toLowerCase().endsWith(".exe") ||
      candidate.appPath.length > 1024) return null;
    slice.appPath = candidate.appPath;
  }
  if (slice.action === "preset" || slice.action === "chain") {
    if (!Array.isArray(candidate.steps) || candidate.steps.length < 1 || candidate.steps.length > 5) return null;
    const steps = candidate.steps.map(sanitizeStep);
    if (steps.some(item => item === null)) return null;
    if (slice.action === "preset" && (steps.length !== 1 || steps[0]?.type !== "convert")) return null;
    if (slice.action === "chain" && steps.length < 2) return null;
    slice.steps = steps as RecipeStep[];
  }
  return slice;
}
export function readOrbitPreferences(): OrbitPreferences {
  const fallback = defaultOrbitPreferences();
  try {
    const raw = localStorage.getItem(ORBIT_SETTINGS_KEY);
    if (!raw || raw.length > 100_000) return fallback;
    const data: unknown = JSON.parse(raw);
    if (!data || typeof data !== "object" || (data as Record<string,unknown>).version !== 1) return fallback;
    const obj = data as Record<string,unknown>;
    const slices = obj.slices && typeof obj.slices === "object" ? obj.slices as Record<string,unknown> : {};
    for (const tab of ORBIT_TABS) {
      if (Array.isArray(slices[tab])) {
        const valid = (slices[tab] as unknown[]).slice(0,40).map(sanitizeSlice)
          .filter((slice): slice is OrbitSlice => slice !== null);
        const unique = new Set<string>();
        fallback.slices[tab] = valid.filter(item => {
          if (unique.has(item.id)) return false;
          unique.add(item.id);return true;
        });
      }
    }
    fallback.mouseShake = obj.mouseShake === true;
    fallback.mouseWheel = obj.mouseWheel !== false;
    fallback.loadingSpin = obj.loadingSpin !== false;
    if (isTab(obj.shakeOpens)) fallback.shakeOpens = obj.shakeOpens;
    if (isTab(obj.wheelOpens)) fallback.wheelOpens = obj.wheelOpens;
  } catch { /* Corrupt or denied storage must never prevent launch. */ }
  return fallback;
}
export function saveOrbitPreferences(config: OrbitPreferences): void {
  const parsed: OrbitPreferences = { ...config, version: 1 };
  try {
    localStorage.setItem(ORBIT_SETTINGS_KEY, JSON.stringify(parsed));
    window.dispatchEvent(new Event("reformany:orbit-preferences-updated"));
  } catch { throw new Error("Unable to save Orbit preferences on this computer"); }
}
