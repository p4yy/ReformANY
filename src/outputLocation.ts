// One output-location preference for Orbit and every ReformANY workspace.
// The conversion engines still validate the destination and never overwrite.
import { desktopDir } from "@tauri-apps/api/path";

export type OutputMode = "alongside" | "desktop" | "folder";
export type OutputPreference = { mode: OutputMode; folder: string | null };
const KEY = "reformany.files.output";
const fallback: OutputPreference = { mode: "alongside", folder: null };

export function readOutputPreference(): OutputPreference {
  try {
    const candidate: unknown = JSON.parse(localStorage.getItem(KEY) || "null");
    if (!candidate || typeof candidate !== "object") return fallback;
    const { mode, folder } = candidate as Partial<OutputPreference>;
    if (mode !== "alongside" && mode !== "desktop" && mode !== "folder") return fallback;
    if (mode === "folder" && (!folder || typeof folder !== "string" || !folder.trim())) return fallback;
    return { mode, folder: typeof folder === "string" && folder.trim() ? folder : null };
  } catch { return fallback; }
}

export function saveOutputPreference(preference: OutputPreference): void {
  if (preference.mode === "folder" && !preference.folder?.trim()) {
    throw new Error("Choose a destination folder before using custom output");
  }
  localStorage.setItem(KEY, JSON.stringify(preference));
}

export async function resolvePreferredDestination(): Promise<string | null> {
  const preference = readOutputPreference();
  if (preference.mode === "desktop") return desktopDir();
  if (preference.mode === "folder") return preference.folder;
  return null;
}
