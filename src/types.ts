export type ModuleId =
  | 'workspace' | 'images' | 'media' | 'media-tools' | 'archives' | 'documents'
  | 'subtitles' | 'spreadsheets' | 'preview' | 'ebooks'
  | 'activity' | 'guide' | 'appearance' | 'files-jobs' | 'engines';

export type JobStatus = 'queued' | 'working' | 'done' | 'error' | 'blocked';

export interface QueueItem {
  id: string;
  file: File;
  name: string;
  size: number;
  kind: string;
  status: JobStatus;
  progress: number;
  output?: string;
  message?: string;
  previewUrl?: string;
}

export interface ActivityItem {
  id: string;
  action: string;
  detail: string;
  module: string;
  time: number;
  status: 'done' | 'error' | 'info';
}

export interface WatchRule {
  id: string;
  folder: string;
  incoming: string;
  output: string;
  enabled: boolean;
}

export interface Preferences {
  theme: 'system' | 'light' | 'dark';
  language: string;
  orbitSounds: boolean;
  orbitVolume: number;
  orbitStart: 'convert' | 'tools' | 'actions';
  orbitScroll: boolean;
  orbitModifiers: { convert: string; tools: string; actions: string };
  holdShake: boolean;
  shakeSensitivity: number;
  pointerRing: boolean;
  showIntroduction: boolean;
  destination: string;
  scheduling: 'sequential' | 'balanced';
  watchRules: WatchRule[];
  recentFormats: Record<string, string>;
}

export const defaultPreferences: Preferences = {
  theme: 'dark', language: 'English (United States)', orbitSounds: true,
  orbitVolume: 65, orbitStart: 'convert', orbitScroll: true,
  orbitModifiers: { convert: 'Shift', tools: 'Ctrl', actions: 'Alt' },
  holdShake: true, shakeSensitivity: 58, pointerRing: true,
  showIntroduction: true, destination: 'Next to original', scheduling: 'balanced',
  watchRules: [], recentFormats: {},
};

export type OrbitFileKind = 'image' | 'video' | 'audio' | 'pdf' | 'folder' | 'text';
export type OrbitSection = 'convert' | 'tools' | 'actions';

export interface OrbitFile {
  id: string;
  name: string;
  kind: OrbitFileKind;
  size: number;
  path: string;
  pages?: number;
  typeLabel?: string;
  file?: File;
  url?: string;
}

export interface ToastMessage {
  id: string;
  title: string;
  message?: string;
  tone?: 'default' | 'danger' | 'success';
}