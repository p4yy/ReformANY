import { useSyncExternalStore } from "react";
import { uid } from "./util";

export interface ActivityEntry {
  id: string;
  at: number;
  module: string;
  title: string;
  detail: string;
  /** "dry" = dry run in the browser preview; no file was written. */
  status: "done" | "dry" | "failed";
}

const KEY = "reformany.activity.v1";
const subs = new Set<() => void>();

function load(): ActivityEntry[] {
  try {
    const raw = localStorage.getItem(KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

let entries: ActivityEntry[] = load();

function commit(next: ActivityEntry[]) {
  entries = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(entries));
  } catch {
    /* ignore */
  }
  subs.forEach((fn) => fn());
}

export const activity = {
  add(e: Omit<ActivityEntry, "id" | "at">) {
    commit([{ ...e, id: uid(), at: Date.now() }, ...entries].slice(0, 200));
  },
  clear() {
    commit([]);
  },
  subscribe(fn: () => void) {
    subs.add(fn);
    return () => {
      subs.delete(fn);
    };
  },
  get: () => entries,
};

export function useActivity(): ActivityEntry[] {
  return useSyncExternalStore(activity.subscribe, activity.get);
}
