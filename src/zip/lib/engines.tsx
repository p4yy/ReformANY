import { useCallback, useEffect, useState } from "react";
import { engineStatus, isTauri, type EngineId, type EngineState } from "./bridge";

export interface EngineMeta {
  id: EngineId;
  name: string;
  use: string;
  /** winget command, when the engine is a separate install */
  install?: string;
}

export const ENGINES: EngineMeta[] = [
  { id: "builtin", name: "Image / PDF tools", use: "Raster images, PDF preview and text extraction. Ships inside ReformANY." },
  { id: "ffmpeg", name: "FFmpeg + FFprobe", use: "Audio & Video conversion and every Media Tool.", install: "winget install --id Gyan.FFmpeg -e" },
  { id: "sevenzip", name: "7-Zip", use: "Create and extract ZIP, 7Z and TAR archives.", install: "winget install --id 7zip.7zip -e" },
  { id: "winrar", name: "WinRAR", use: "Create RAR archives. Extraction works without it.", install: "winget install --id RARLab.WinRAR -e" },
  { id: "calibre", name: "Calibre", use: "E-book conversion to EPUB.", install: "winget install --id calibre.calibre -e" },
  { id: "libreoffice", name: "LibreOffice", use: "Office documents to PDF.", install: "winget install --id TheDocumentFoundation.LibreOffice -e" },
];

export function useEngines() {
  const [list, setList] = useState<EngineState[] | null>(null);
  const refresh = useCallback(async () => {
    setList(null);
    setList(await engineStatus());
  }, []);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  const get = useCallback((id: EngineId) => list?.find((e) => e.id === id), [list]);
  return { list, refresh, get };
}

export function EnginePill({ state, name }: { state: EngineState | undefined; name: string }) {
  if (!state) {
    return <span className="pill">Checking {name}…</span>;
  }
  if (state.state === "ready") {
    return (
      <span className="pill" data-tone="ok">
        {name} ready{state.version && state.id !== "builtin" ? ` · ${state.version}` : ""}
      </span>
    );
  }
  if (state.state === "missing") {
    return (
      <span className="pill" data-tone="warn">
        {name} not installed
      </span>
    );
  }
  return (
    <span className="pill" title="A browser cannot see programs installed on this computer.">
      {name}: {isTauri ? "status unknown" : "not detectable in a browser"}
    </span>
  );
}
