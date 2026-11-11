export const cx = (...parts: Array<string | false | null | undefined>) => parts.filter(Boolean).join(" ");

export const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

export const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export const reducedMotion = () =>
  typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export function formatBytes(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return "—";
  if (n < 1024) return `${n} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v >= 100 || Number.isInteger(v) ? v.toFixed(0) : v.toFixed(1)} ${units[i]}`;
}

export function extOf(name: string): string {
  const i = name.lastIndexOf(".");
  return i > 0 ? name.slice(i + 1).toLowerCase() : "";
}

export function stem(name: string): string {
  const i = name.lastIndexOf(".");
  return i > 0 ? name.slice(0, i) : name;
}

/** Keeps both ends of a path readable: C:\Users\…\file.png */
export function middleEllipsis(s: string, max = 44): string {
  if (s.length <= max) return s;
  const keep = max - 1;
  const head = Math.ceil(keep * 0.42);
  return `${s.slice(0, head)}…${s.slice(s.length - (keep - head))}`;
}

export function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
      ta.remove();
      return ok;
    } catch {
      return false;
    }
  }
}

export function timeAgo(ts: number): string {
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (s < 45) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return new Date(ts).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export type Family = "image" | "video" | "audio" | "doc" | "archive" | "data" | "other";

const FAMILIES: Record<Exclude<Family, "other">, string[]> = {
  image: ["png", "jpg", "jpeg", "webp", "bmp", "gif", "tif", "tiff", "ico", "tga", "qoi", "svg", "avif"],
  video: ["mp4", "mkv", "mov", "webm", "avi", "wmv", "m4v", "flv", "mpg", "mpeg"],
  audio: ["mp3", "wav", "flac", "ogg", "opus", "m4a", "aac", "aiff", "wma", "ac3"],
  doc: ["pdf", "txt", "md", "doc", "docx", "odt", "rtf", "ppt", "pptx", "html", "epub", "mobi", "azw3", "fb2", "srt", "vtt"],
  archive: ["zip", "7z", "rar", "tar", "gz", "001"],
  data: ["csv", "tsv", "json", "xlsx", "xls", "ods"],
};

export function familyOf(ext: string): Family {
  for (const key of Object.keys(FAMILIES) as Array<Exclude<Family, "other">>) {
    if (FAMILIES[key].includes(ext)) return key;
  }
  return /^\d{3}$/.test(ext) ? "archive" : "other";
}

/** "00:01:30" | "1:30" | "90" → seconds, or null when unparseable. */
export function parseTimecode(v: string): number | null {
  const t = v.trim();
  if (!t) return null;
  const parts = t.split(":").map(Number);
  if (parts.some((p) => Number.isNaN(p) || p < 0) || parts.length > 3) return null;
  return parts.reduce((acc, p) => acc * 60 + p, 0);
}

export function formatTimecode(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;
}
