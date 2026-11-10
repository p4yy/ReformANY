
import { useEffect, useState } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { invoke } from '@tauri-apps/api/core';
import { emit } from '@tauri-apps/api/event';
import { OrbitDialogRouter, type OrbitDialogKind } from '../orbit/OrbitDialogs';
import type { OrbitFile, ToastMessage } from '../types';
import { ext, uid } from '../lib/files';
import { loadNativeFile, nativeRename, setSourcePath } from './bridge';

const supported: OrbitDialogKind[] = ['sign','watermark','split-pdf','arrange','password-zip','split-binary','rename','shred','more-tools'];
function fileKind(name: string): OrbitFile['kind'] {
  const suffix = ext(name);
  if (suffix === 'pdf') return 'pdf';
  if (['png','jpg','jpeg','gif','bmp','webp','tiff','svg','ico','qoi','tga'].includes(suffix)) return 'image';
  if (['mp4','mov','avi','webm','mkv','wmv'].includes(suffix)) return 'video';
  if (['mp3','wav','flac','ogg','opus','m4a'].includes(suffix)) return 'audio';
  return 'text';
}
export default function OrbitPanelWindow() {
  const [file, setFile] = useState<OrbitFile | null>(null);
  const [error, setError] = useState('');
  const [notices, setNotices] = useState<ToastMessage[]>([]);
  const suffix = getCurrentWindow().label.slice('orbit-panel-'.length);
  const kind = suffix.slice(0, suffix.lastIndexOf('-')) as OrbitDialogKind;
  const close = () => { void getCurrentWindow().close(); };
  const notify = (title: string, message?: string, tone: ToastMessage['tone'] = 'default') => {
    setNotices(current => [{ id: uid(), title, message, tone }, ...current].slice(0, 2));
  };
  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        if (!supported.includes(kind)) throw new Error('Unsupported Orbit tool.');
        const context = await invoke<{ path: string; name: string; bytes: number; detected: string | null; error: string | null } | null>('orbit_context');
        if (!context || context.error) throw new Error(context?.error || 'No Explorer file context is available.');
        const local = await loadNativeFile(context.path);
        if (!live) return;
        setSourcePath(local);
        setFile({ id: uid(), name: context.name, size: context.bytes, path: context.path,
          file: local, kind: fileKind(context.name), typeLabel: ext(context.name).toUpperCase() });
      } catch (reason) { if (live) setError(String(reason)); }
    })();
    return () => { live = false; };
  }, [kind]);
  if (error || !file) return <div className="orbit-panel-window"><section className="orbit-dialog" style={{ padding: 24 }}>
    <h2>{error ? 'Cannot open this tool' : 'Opening tool…'}</h2><p>{error}</p>
    <button onClick={close}>Close</button></section></div>;
  return <div className="orbit-panel-window">
    <OrbitDialogRouter kind={kind} file={file} onClose={close} notify={notify}
      onRename={async name => {
        const result = await nativeRename(file.path, name);
        await emit('reformany:orbit-source-renamed', { path: result.path, name: result.name });
      }}
      onShred={() => { void emit('reformany:orbit-source-deleted'); }} />
    {notices.length > 0 && <div className="toast-stack" role="status">
      {notices.map(notice => <div className={`toast ${notice.tone || 'default'}`} key={notice.id}>
        <strong>{notice.title}</strong>{notice.message && <p>{notice.message}</p>}
        <button onClick={() => setNotices(current => current.filter(item => item.id !== notice.id))}>Dismiss</button>
      </div>)}
    </div>}
  </div>;
}
