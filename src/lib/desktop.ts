import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import { getCurrentWindow } from '@tauri-apps/api/window';

export const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
export const isNativeFloatRoute = isTauri && getCurrentWindow().label === 'hover';
export const isNativeOrbitRoute = isTauri && (getCurrentWindow().label === 'orbit' || new URLSearchParams(window.location.search).get('orbit') === '1');

export async function openNativeOrbit() {
  if (!isTauri) return false;
  const selected = await open({ multiple: false, directory: false });
  if (typeof selected !== 'string') return false;
  await invoke('orbit_launch_file', { path: selected });
  return true;
}

export async function closeCurrentNativeWindow() {
  if (isTauri) await getCurrentWindow().close();
}
