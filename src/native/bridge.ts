import { invoke, isTauri } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { open } from '@tauri-apps/plugin-dialog';

/** The redesign's File objects retain their original filesystem identity. */
export type NativeFile = File & { readonly nativePath?: string; readonly nativeBytesLoaded?: boolean; readonly nativeDirectory?: boolean };
export const native = isTauri();
export function pathOf(file: File | null | undefined): string | null { return (file as NativeFile | undefined)?.nativePath || null; }
export function hasOriginalBytes(file: File | null | undefined): boolean { return !!file && (!pathOf(file) || !!(file as NativeFile).nativeBytesLoaded); }
export function requireNativePath(file: File | null | undefined): string {
  const path = file && pathOf(file);
  if (!path) throw new Error('Select an original local file to use this desktop engine.');
  return path;
}

interface NativeEntry { path: string; name: string; bytes: number; directory: boolean; canReadBytes: boolean }
let activeSourcePath: string | null = null;
let destinationPreference = 'Next to original';
export function setDestinationPreference(destination: string) { destinationPreference = destination; }
export function setSourcePath(file: File | null) { activeSourcePath = pathOf(file); }
export function getActiveSourcePath() { return activeSourcePath; }

function decodeBase64(base64: string): Uint8Array {
  const chars = atob(base64);
  const output = new Uint8Array(chars.length);
  for (let i = 0; i < chars.length; i++) output[i] = chars.charCodeAt(i);
  return output;
}
function encodeBase64(bytes: Uint8Array): string {
  const step = 0x8000;
  const chunks: string[] = [];
  for (let i = 0; i < bytes.length; i += step) chunks.push(String.fromCharCode(...bytes.subarray(i, i + step)));
  return btoa(chunks.join(''));
}
export async function loadNativeFile(path: string, readBytes = true): Promise<NativeFile> {
  const meta = await invoke<NativeEntry>('ui_file_stat', { path });
  let bytes: Uint8Array | null = null;
  if (readBytes && meta.canReadBytes && !meta.directory) {
    bytes = decodeBase64(await invoke<string>('ui_file_read', { path }));
  }
  const mime = meta.name.toLowerCase().endsWith('.pdf') ? 'application/pdf' : '';
  const file = new File(bytes ? [new Uint8Array(bytes) as BlobPart] : [], meta.name, { type: mime }) as NativeFile;
  Object.defineProperties(file, {
    nativePath: { value: meta.path, enumerable: false },
    nativeBytesLoaded: { value: !!bytes, enumerable: false },
    nativeDirectory: { value: meta.directory, enumerable: false },
    size: { value: meta.bytes, enumerable: false },
  });
  return file;
}

export async function selectLocalFiles(options: { multiple?: boolean; directory?: boolean; accept?: string } = {}): Promise<File[]> {
  if (!native) return [];
  const selected = await open({ directory: options.directory ?? false, multiple: options.multiple ?? false });
  const initial = (Array.isArray(selected) ? selected : selected ? [selected] : []).filter((path): path is string => typeof path === 'string');
  if (!initial.length) return [];
  activeSourcePath = initial[0];
  let paths = initial;
  if (options.directory) {
    const expanded = await invoke<{ paths: string[]; warnings: string[] }>('expand_inputs', { paths: initial });
    paths = expanded.paths;
    if (expanded.warnings.length) window.dispatchEvent(new CustomEvent('reformany:notice', { detail: expanded.warnings.join(' · ') }));
  }
  if (options.accept && !options.directory) {
    const matches = options.accept.split(',').map(item => item.trim().replace(/^\./, '').toLowerCase()).filter(Boolean);
    if (matches.length && !matches.some(type => type.endsWith('/*') || type === '*/*' || type === '*')) paths = paths.filter(path => matches.some(ext => path.toLowerCase().endsWith(`.${ext}`)));
  }
  const results: NativeFile[] = [];
  for (const path of paths.slice(0, 300)) {
    try { results.push(await loadNativeFile(path)); }
    catch (error) { window.dispatchEvent(new CustomEvent('reformany:notice', { detail: String(error) })); }
  }
  return results;
}

export async function saveNativeBlob(blob: Blob, name: string, sourcePath?: string | null): Promise<string | null> {
  if (!native) return null;
  if (blob.size > 80 * 1024 * 1024) throw new Error('This in-memory export exceeds 80 MB. Use the native converter for large files.');
  let directory: string | null = null;
  if (destinationPreference === 'Choose folder') {
    const selected = await open({ directory: true, multiple: false });
    if (typeof selected !== 'string') throw new Error('Save cancelled. No output was written.');
    directory = selected;
  }
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const output = await invoke<string>('ui_save_output', {
    sourcePath: sourcePath ?? activeSourcePath,
    destination: directory || destinationPreference,
    fileName: name,
    base64: encodeBase64(bytes),
  });
  window.dispatchEvent(new CustomEvent('reformany:saved', { detail: output }));
  return output;
}

export async function runNative<T>(command: string, args: Record<string, unknown>): Promise<T> {
  if (!native) throw new Error('The native Windows application is required for this operation.');
  return invoke<T>(command, args);
}

export async function nativeReveal(path: string) { return runNative<void>('reveal_output', { path }); }
export async function nativeRename(path: string, newName: string) { return runNative<{ path: string; name: string }>('rename_file', { path, newName }); }
export async function nativeShred(path: string) { return runNative<{ fileCount: number; totalBytes: number; directories: number }>('shred_confirm', { path, confirmation: 'SHRED' }); }
export async function nativeCopyFile(path: string) {
  const directory = await open({ directory: true, multiple: false });
  if (typeof directory !== 'string') return null;
  return runNative<string>('copy_file_to', { path, destination: directory });
}

type ImageStatus = { id: string; status: 'processing' | 'completed' | 'failed' | 'cancelled'; outputPath: string | null; error: string | null };
export async function nativeConvertImages(
  files: { id: string; path: string }[],
  options: { target: string; quality: number; matte: string; maxDimension?: number; rotation: number; grayscale: boolean; destination?: string | null },
  onUpdate: (event: ImageStatus) => void,
): Promise<{ completed: number; failed: number }> {
  if (!files.length) return { completed: 0, failed: 0 };
  const expected = new Set(files.map(f => f.id));
  let completed = 0, failed = 0;
  let unlisten: (() => void) | null = null;
  try {
    return await new Promise(async (resolve, reject) => {
      try {
        unlisten = await listen<ImageStatus>('reformany:conversion', event => {
          const item = event.payload;
          if (!expected.has(item.id)) return;
          onUpdate(item);
          if (item.status === 'completed' || item.status === 'failed' || item.status === 'cancelled') {
            expected.delete(item.id);
            if (item.status === 'completed') completed++; else failed++;
            if (expected.size === 0) resolve({ completed, failed });
          }
        });
        await invoke<string>('convert_batch', {
          files: files.map(item => ({ id: item.id, path: item.path, target: options.target,
            quality: options.quality, matte: options.matte,
            options: { maxDimension: options.maxDimension || null, rotation: options.rotation, grayscale: options.grayscale },
          })),
          destination: options.destination || null,
        });
      } catch (error) { reject(error); }
    });
  } finally { if (unlisten) (unlisten as () => void)(); }
}

export async function nativeEngineStatus(): Promise<Record<string, boolean>> {
  const status = await runNative<Record<string, unknown>>('engine_status', {});
  const flags: Record<string, boolean> = {};
  for (const [key, value] of Object.entries(status)) flags[key.toLowerCase()] = value === true || (typeof value === 'object' && value != null && 'available' in value && value.available === true);
  return flags;
}

export async function resolveNativeDestination(choice: string): Promise<string | null> {
  if (!native) return null;
  if (choice === 'Choose folder') {
    const result = await open({ directory: true, multiple: false });
    if (typeof result !== 'string') throw new Error('Destination selection cancelled.');
    return result;
  }
  return runNative<string | null>('ui_destination', { choice });
}
