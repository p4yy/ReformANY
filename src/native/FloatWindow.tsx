import { useEffect, useState } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { invoke } from '@tauri-apps/api/core';
import { OrbitDialogRouter } from '../orbit/OrbitDialogs';
import type { OrbitFile, ToastMessage } from '../types';
import { ext, uid } from '../lib/files';
import { loadNativeFile, setSourcePath } from './bridge';

function kindOf(name: string): OrbitFile['kind'] {
  const suffix = ext(name);
  if (suffix === 'pdf') return 'pdf';
  if (['png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp', 'tiff', 'ico', 'qoi', 'tga'].includes(suffix)) return 'image';
  if (['mp4', 'mov', 'avi', 'webm', 'mkv', 'wmv'].includes(suffix)) return 'video';
  if (['mp3', 'wav', 'flac', 'ogg', 'opus', 'm4a'].includes(suffix)) return 'audio';
  return 'text';
}

export default function FloatWindow({ notify }: { notify: (title: string, message?: string, tone?: ToastMessage['tone']) => void }) {
  const [file, setFile] = useState<OrbitFile | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const context = await invoke<{ path: string; name: string; bytes: number } | null>('float_file_context');
        if (!context) throw new Error('No file was selected for HoveR.');
        const local = await loadNativeFile(context.path);
        const kind = kindOf(context.name);
        if (!live) return;
        setSourcePath(local);
        setFile({ id: uid(), name: context.name, size: context.bytes, path: context.path,
          kind, typeLabel: ext(context.name).toUpperCase() || kind, file: local,
          url: kind === 'image' && context.bytes < 12 * 1024 * 1024 ? URL.createObjectURL(local) : undefined });
      } catch(reason) { if (live) setError(String(reason)); }
    })();
    return () => { live = false; };
  }, []);
  if (error) return <div className="float-window-error"><p>{error}</p><button onClick={() => void getCurrentWindow().close()}>Close HoveR</button></div>;
  if (!file) return <div className="float-window-error"><p>Opening HoveR…</p></div>;
  return <div className="orbit-os native float-only">
    <OrbitDialogRouter kind="hover" file={file} onClose={() => void getCurrentWindow().close()} notify={notify} />
  </div>;
}
