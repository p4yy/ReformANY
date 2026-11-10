/**
 * ReformANY ZIP interface -> EXISTING tested Rust commands.
 * There is deliberately no run_job or orbit_action Rust dependency: both were
 * placeholders in the design ZIP, not implemented Windows backend functions.
 */
import { sleep, uid } from './util';
import { loadNativeFile, nativeConvertImages } from '../../native/bridge';

export const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
export const CMD = {
  runJob: 'run_job', engineStatus: 'engine_status', loadSettings: 'load_settings',
  saveSettings: 'save_settings', setOrbitVolume: 'set_orbit_volume',
  orbitContext: 'orbit_context', orbitAction: 'orbit_action',
  hideOrbit: 'hide_orbit', openPanel: 'open_panel',
} as const;
export const EVT = { jobProgress: 'reformany:conversion', orbitShow: 'reformany:orbit-context-updated', fileDrop: 'tauri://drag-drop' } as const;

async function raw<T>(cmd: string, args: Record<string, unknown> = {}): Promise<T> {
  if (!isTauri) throw new Error('This operation needs the ReformANY Windows application.');
  const { invoke: rust } = await import('@tauri-apps/api/core');
  return rust<T>(cmd, args);
}
const fmt = (path: string) => path.split(/[\\/]/).pop()?.split('.').pop()?.toLowerCase() ?? '';
function destination(options: Record<string, unknown>): { mode: string; path?: string } {
  const d = options.destination;
  return d && typeof d === 'object' ? d as { mode: string; path?: string } : { mode: 'source' };
}
async function resolveDestination(options: Record<string, unknown>): Promise<string | null> {
  const d = destination(options);
  if (d.mode === 'fixed') {
    if (!d.path) throw new Error('Choose an output folder before converting.');
    return d.path;
  }
  if (d.mode === 'ask') {
    const { open } = await import('@tauri-apps/plugin-dialog');
    const p = await open({ directory: true, multiple: false });
    if (typeof p !== 'string') throw new Error('Output folder selection cancelled.');
    return p;
  }
  return null;
}

export interface JobRequest { kind: string; inputs: string[]; options: Record<string, unknown> }
export interface JobResult { simulated: boolean; outputs: string[] }

async function runRealJob(req: JobRequest, onProgress: (p: number, note?: string) => void): Promise<string[]> {
  const { kind, inputs, options } = req;
  if (!inputs.length) throw new Error('Choose a source file first.');
  // The original ZIP sometimes used file.name instead of an actual path for
  // browser-dropped objects. Never pass such a fake location to Rust.
  if (inputs.some(p => !/^(?:[A-Za-z]:\\|\\\\)/.test(p)))
    throw new Error('Use Add files to select an original file with a Windows path.');
  const dest = await resolveDestination(options);
  const saved: string[] = [];
  const each = async (command: string, argsFor: (path: string) => Record<string, unknown>, wrap = (x: unknown): string[] => [String(x)]) => {
    for (const [i, path] of inputs.entries()) {
      const result = await raw<unknown>(command, argsFor(path));
      saved.push(...wrap(result));
      onProgress((i + 1) / inputs.length, path.split(/[\\/]/).pop());
    }
    return saved;
  };
  switch (kind) {
    case 'image.convert': {
      const target = String(options.format ?? 'png');
      const matte = String(options.background ?? 'white');
      const files = inputs.map(path => ({ id: uid(), path }));
      const result = await nativeConvertImages(files, {
        target, quality: Number(options.quality ?? 86),
        matte: matte === 'keep' || matte === 'null' ? 'white' : matte === '#11140e' ? 'black' : matte,
        maxDimension: Number(options.maxEdge || 0) || undefined,
        rotation: Number(options.rotate ?? 0), grayscale: Boolean(options.grayscale),
        destination: dest,
      }, update => {
        if (update.outputPath) saved.push(update.outputPath);
        if (update.status === 'failed') onProgress(0, update.error ?? 'Conversion failed');
        else onProgress(Math.min(0.98, (saved.length / files.length)), update.status);
      });
      if (!result.completed || result.failed) {
        throw new Error(`${result.completed} converted; ${result.failed} failed. Check input formats and permissions.`);
      }
      return saved;
    }
    case 'media.convert':
      return each('media_convert', path => ({ job: {
        path, target: options.format === 'h265' ? 'mp4_h265' : options.format,
        destination: dest,
        profile: options.quality === 'high' || options.quality === 'source' ? 'high' :
          options.quality === 'compact' || options.quality === 'small' ? 'small' : 'standard',
        startSeconds: Number(options.start ?? 0) || null,
        durationSeconds: options.duration == null ? null : Number(options.duration),
      } }));
    case 'archive.create': {
      const name = String(options.name || 'Archive');
      const result = await raw<{ outputPaths: string[] }>('archive_create', { job: {
        paths: inputs, destination: dest, name,
        format: options.format || 'zip', level: Number(options.level ?? 5),
        password: options.password || null, splitMegabytes: null,
      } });
      onProgress(1);
      return result.outputPaths;
    }
    case 'archive.extract':
      return each('archive_extract', path => ({ job: { path, destination: dest, password: options.password || null } }));
    case 'archive.split':
      return each('file_split', path => ({ path, destination: dest,
        partMegabytes: Math.max(1, Math.ceil(Number(options.partBytes) / 1048576)) }),
        (r: unknown) => (r as { outputPaths?: string[] }).outputPaths ?? []);
    case 'archive.join': {
      const manifest = inputs.find(p => p.endsWith('.manifest.json'));
      if (!manifest) throw new Error('Select the original .manifest.json file to verify and join its parts.');
      return [await raw<string>('file_join', { manifestPath: manifest, destination: dest })];
    }
    case 'doc.images_to_pdf':
      return [await raw<string>('images_to_pdf', { paths: inputs, destination: dest })];
    case 'doc.pdf_to_text':
      return each('pdf_to_text_format', path => ({ path, target: 'txt', destination: dest }));
    case 'doc.text_to':
      return each('text_convert', path => ({ path, target: options.target ?? 'pdf', destination: dest }), r => r as string[]);
    case 'doc.office_to_pdf':
      return each('office_to_pdf', path => ({ path, destination: dest }));
    case 'doc.split_pdf': {
      const value = options.method === 'pages' ? Number(options.pages ?? 1) : options.method === 'size' ? Number(options.megabytes ?? 5) : Number(options.pages ?? 2);
      return each('pdf_split', path => ({ path, destination: dest,
        mode: options.method === 'count' ? 'parts' : options.method === 'size' ? 'size' : 'pages', value: Math.max(1, Math.trunc(value)) }),
        (r: unknown) => (r as { outputPaths: string[] }).outputPaths);
    }
    case 'ebook.to_epub':
      return each('ebook_convert_file', path => ({ job: { path, target: 'epub', destination: dest } }));
    case 'sheet.convert':
      return each('spreadsheet_convert', path => ({ job: { path, target: options.target ?? 'csv', destination: dest } }));
    case 'subtitle.convert':
      return each('subtitle_convert', path => ({ job: { path,
        target: fmt(path) === 'srt' ? 'vtt' : 'srt', destination: dest } }));
    default:
      if (kind.startsWith('media.')) {
        const action = ({
          normalize: 'normalize-audio', rotate: 'rotate-video', 'flip-h': 'flip-video',
          'flip-v': 'flip-vertical', 'strip-meta': 'strip-metadata',
        } as Record<string, string>)[kind.slice(6)] || kind.slice(6);
        const result = await raw<string>('media_edit', { job: { paths: inputs, action, destination: dest } });
        onProgress(1);
        return [result];
      }
      throw new Error(`Unsupported job type: ${kind}. No file was changed.`);
  }
}
export async function runJob(req: JobRequest, onProgress: (p: number, note?: string) => void): Promise<JobResult> {
  if (isTauri) {
    const outputs = await runRealJob(req, onProgress);
    if (outputs.length === 0) throw new Error('The engine returned no converted files.');
    onProgress(1, `${outputs.length} output${outputs.length === 1 ? '' : 's'} saved`);
    return { simulated: false, outputs };
  }
  for (let i = 0; i < 24; i++) { await sleep(45); onProgress((i + 1) / 24, 'Browser preview only'); }
  return { simulated: true, outputs: [] };
}

async function orbitAction(args: Record<string, unknown>): Promise<unknown> {
  const path = String(args.path || '');
  if (!path) throw new Error('Orbit has no selected file.');
  const action = String(args.action || '');
  if (['rename', 'shred', 'watermark-pdf', 'arrange-pdf', 'split', 'split-pages', 'watermark', 'arrange-pages',
       'extract-pages', 'sign', 'password', 'password-zip', 'split-binary', 'more-tools'].includes(action)) {
    const kind = ({
      'watermark-pdf':'watermark', 'arrange-pdf':'arrange', 'split':'split-pdf',
      'split-pages':'split-pdf', 'arrange-pages':'arrange', 'password':'pdf-password',
    } as Record<string,string>)[action] || action;
    return raw('orbit_open_panel', { kind });
  }
  if (action === 'open-folder' || action === 'show-file') return raw('reveal_output', { path });
  if (action === 'terminal') return raw('open_terminal', { path });
  if (action === 'bluetooth') return raw('send_bluetooth', { path });
  if (action === 'hover') return raw('hover_file', { path });
  if (action === 'copy-file') {
    const { open } = await import('@tauri-apps/plugin-dialog');
    const destination = await open({ directory: true, multiple: false });
    if (typeof destination !== 'string') throw new Error('Copy cancelled.');
    return raw('copy_file_to', { path, destination });
  }
  if (action === 'rotate-90') return raw('pdf_rotate_pages', { path, pages: null, degrees: 90, destination: null });
  if (action === 'extract-images') return raw('pdf_extract_images', { path, destination: null });
  if (action.startsWith('to-')) {
    const target = action.slice(3).replace(/^docx-editable$/, 'docx-edit').replace(/^docx-layout$/, 'docx-layout').replace(/^h-265$/, 'mp4_h265');
    const ext = fmt(path);
    if (['png','jpg','jpeg','webp','gif','bmp','tiff','tif','ico','tga','qoi','svg','avif'].includes(ext)) {
      if (target === 'pdf') return raw('images_to_pdf', { paths: [path], destination: null });
      const completed: string[] = [];
      const result = await nativeConvertImages([{ id: uid(), path }], { target, quality: 86, matte: 'white', rotation: 0, grayscale: false },
        ev => { if (ev.outputPath) completed.push(ev.outputPath); });
      if (!result.completed || !completed.length) throw new Error('Image conversion failed.');
      return completed;
    }
    if (['mp4','mov','mkv','avi','webm','wmv','mp3','wav','m4a','flac','ogg','opus','aiff','wma'].includes(ext)) {
      return raw('media_convert', { job: { path, target, destination: null, profile: 'high', startSeconds: null, durationSeconds: null } });
    }
    if (ext === 'pdf') {
      if (target === 'docx-edit') return raw('pdf_docx_editable', { path, destination: null });
      if (target === 'docx-layout' || target === 'png' || target === 'jpg') {
        const file = await loadNativeFile(path);
        if (!file.nativeBytesLoaded) throw new Error('The selected PDF is too large to render in the local editor.');
        const { renderPdfPageImages } = await import('./pdf');
        const outputFormat = target === 'jpg' ? 'jpg' : 'png';
        const images = await renderPdfPageImages(file, outputFormat);
        if (target === 'docx-layout') return raw('pdf_docx_layout', { path, images, destination: null });
        return raw('pdf_save_rendered_pages', { path, target, images, destination: null });
      }
      if (['txt', 'md', 'html'].includes(target)) {
        return raw('pdf_to_text_format', { path, target, destination: null });
      }
      throw new Error(`PDF → ${target.toUpperCase()} is not supported by the installed local engine.`);
    }
    if (['zip','7z','tar','rar'].includes(target)) return raw('archive_create', { job: {
      paths: [path], destination: null, name: path.split(/[\\/]/).pop() || 'Archive',
      format: target, password: null, splitMegabytes: null, level: 5,
    } });
    return raw('text_convert', { path, target, destination: null });
  }
  throw new Error(`Orbit action ${action} is not available for this source. Nothing was changed.`);
}

export async function invoke<T>(cmd: string, args: Record<string, unknown> = {}): Promise<T> {
  if (!isTauri) throw new Error('This action needs the ReformANY desktop runtime.');
  switch (cmd) {
    case CMD.runJob: throw new Error('Use runJob() so progress and output paths are retained.');
    case CMD.loadSettings: return null as T; // SettingsProvider already hydrates from saved local preferences.
    case CMD.saveSettings: {
      const s = args.settings as { closeToTray?: boolean; shakeEnabled?: boolean; shakeSensitivity?: number; orbitVolume?: number; orbitSounds?: boolean } | undefined;
      if (s) {
        const writes: Promise<unknown>[] = [];
        if (typeof s.closeToTray === 'boolean') writes.push(raw('set_close_to_tray', { enabled: s.closeToTray }));
        if (typeof s.shakeEnabled === 'boolean') writes.push(raw('set_shake_settings', { enabled: s.shakeEnabled, sensitivity: Math.max(1, Math.min(5, Math.round(Number(s.shakeSensitivity ?? 6) / 2))) }));
        if (typeof s.orbitVolume === 'number') writes.push(raw('set_orbit_sound_preferences', { enabled: s.orbitSounds ?? true,
          volume: s.orbitVolume, openEnabled: true, closeEnabled: true, hoverEnabled: true }));
        const results = await Promise.allSettled(writes);
        const bad = results.find((r): r is PromiseRejectedResult => r.status === 'rejected');
        if (bad) throw bad.reason;
      }
      return undefined as T;
    }
    case CMD.setOrbitVolume: return raw('set_orbit_sound_preferences', { enabled: Number(args.volume ?? 0) > 0,
      volume: Number(args.volume ?? 0) * 100, openEnabled: true, closeEnabled: true, hoverEnabled: true }) as Promise<T>;
    case CMD.orbitContext: {
      const ctx = await raw<{ path: string; name: string; bytes: number; detected: string | null; error: string | null } | null>('orbit_context');
      if (!ctx || ctx.error) throw new Error(ctx?.error || 'Orbit has no Explorer selection.');
      const x = fmt(ctx.path);
      const detected = (ctx.detected || '').toLowerCase();
      const kind = detected.includes('folder') || detected.includes('directory') ? 'folder' : x === 'pdf' ? 'pdf' :
        ['png','jpg','jpeg','webp','gif','bmp','tiff','tif','svg','ico','tga','avif','qoi'].includes(x) ? 'image' :
        ['mp4','mov','webm','avi','mkv','wmv'].includes(x) ? 'video' :
        ['mp3','wav','ogg','opus','flac','m4a','aac','aiff','wma'].includes(x) ? 'audio' : 'text';
      const pages = kind === 'pdf' ? await raw<number>('pdf_page_count', { path: ctx.path }).catch(() => 1) : undefined;
      return { kind, name: ctx.name, ext: x, size: ctx.bytes, path: ctx.path, pages } as T;
    }
    case CMD.orbitAction: return orbitAction(args) as Promise<T>;
    case CMD.hideOrbit: {
      const { getCurrentWindow } = await import('@tauri-apps/api/window');
      await getCurrentWindow().close();
      return undefined as T;
    }
    case CMD.openPanel: return raw('orbit_open_panel', { kind: args.kind }) as Promise<T>;
    default: return raw<T>(cmd, args);
  }
}
export async function listen<T>(event: string, cb: (payload: T) => void): Promise<() => void> {
  if (!isTauri) return () => {};
  const { listen: subscribe } = await import('@tauri-apps/api/event');
  return subscribe<T>(event, e => cb(e.payload));
}
async function appWindow() { const { getCurrentWindow } = await import('@tauri-apps/api/window'); return getCurrentWindow(); }
export const win = {
  minimize: async () => { if (isTauri) await (await appWindow()).minimize(); },
  toggleMaximize: async () => { if (isTauri) await (await appWindow()).toggleMaximize(); else if (document.fullscreenElement) await document.exitFullscreen(); else await document.documentElement.requestFullscreen(); },
  hide: async () => { if (isTauri) await (await appWindow()).hide(); },
  show: async () => { if (isTauri) { const w = await appWindow(); await w.show(); await w.setFocus(); } },
  quit: async () => { if (isTauri) await (await appWindow()).destroy(); },
  setAlwaysOnTop: async (on: boolean) => { if (isTauri) await (await appWindow()).setAlwaysOnTop(on); },
};
export async function installCloseToTray(enabled: () => boolean): Promise<() => void> {
  if (!isTauri) return () => {};
  const w = await appWindow();
  return w.onCloseRequested(async event => { if (enabled()) { event.preventDefault(); await w.hide(); } });
}
export async function pickPaths(opts: { multiple?: boolean; directory?: boolean; extensions?: string[]; title?: string }): Promise<string[] | null> {
  if (!isTauri) return null;
  const { open } = await import('@tauri-apps/plugin-dialog');
  const value = await open({ multiple: opts.multiple ?? true, directory: opts.directory ?? false, title: opts.title,
    filters: opts.extensions && !opts.directory ? [{ name: 'Supported files', extensions: opts.extensions }] : undefined });
  if (!value) return null;
  return Array.isArray(value) ? value : [value];
}
export type EngineId = 'builtin' | 'ffmpeg' | 'sevenzip' | 'winrar' | 'calibre' | 'libreoffice';
export interface EngineState { id: EngineId; state: 'ready' | 'missing' | 'unknown'; version?: string; path?: string }
export async function engineStatus(): Promise<EngineState[]> {
  const keys: EngineId[] = ['builtin','ffmpeg','sevenzip','winrar','calibre','libreoffice'];
  if (isTauri) {
    const result = await raw<Record<string, unknown>>('engine_status');
    return keys.map(id => {
      const value = id === 'sevenzip' ? (result.sevenZip ?? result.seven_zip ?? result['7zip']) : result[id];
      const available = value === true || Boolean(value && typeof value === 'object' && (value as { available?: boolean }).available);
      const good = id === 'ffmpeg' ? available && result.ffprobe === true : available;
      return { id, state: id === 'builtin' || good ? 'ready' : 'missing' };
    });
  }
  return keys.map(id => ({ id, state: id === 'builtin' ? 'ready' : 'unknown' }));
}
