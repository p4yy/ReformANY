// Build-time only: package a pinned, hash-verified Windows FFmpeg distribution.
// The installed application never downloads conversion engines.
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { createReadStream, createWriteStream, copyFileSync, existsSync, mkdirSync,
  mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir, platform } from "node:os";
import { join, resolve } from "node:path";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";

const VERSION = "9.0.2";
const ARCHIVE_SHA256 = "60f467265b1e312373dbcd92200c2618a74850f98d3d078e94296bb3fa2047ba";
const ARCHIVE_URL = `https://www.gyan.dev/ffmpeg/builds/packages/ffmpeg-${VERSION}-essentials_build.zip`;
const DEST = resolve("src-tauri", "engines");
const MANIFEST = join(DEST, "source.json");

async function sha256(path) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

function ready() {
  if (!["ffmpeg.exe", "ffprobe.exe", "LICENSE", "source.json"]
      .every(name => existsSync(join(DEST, name)))) return false;
  try {
    const meta = JSON.parse(readFileSync(MANIFEST, "utf8"));
    return meta.version === VERSION && meta.archiveSha256 === ARCHIVE_SHA256;
  } catch {
    return false;
  }
}

function powershellQuote(value) {
  return "'" + value.replaceAll("'", "''") + "'";
}

async function main() {
  if (platform() !== "win32") return;
  if (ready()) {
    console.log("Pinned FFmpeg and FFprobe engines are already staged.");
    return;
  }
  const temp = mkdtempSync(join(tmpdir(), "reformany-ffmpeg-"));
  try {
    const archive = join(temp, "ffmpeg.zip");
    const extract = join(temp, "unpacked");
    mkdirSync(extract, { recursive: true });
    console.log(`Fetching pinned FFmpeg ${VERSION} at build time...`);
    const response = await fetch(ARCHIVE_URL, { signal: AbortSignal.timeout(300_000) });
    if (!response.ok || !response.body) throw new Error(`FFmpeg download failed: HTTP ${response.status}`);
    await pipeline(Readable.fromWeb(response.body), createWriteStream(archive));
    const actual = await sha256(archive);
    if (actual.toLowerCase() !== ARCHIVE_SHA256) {
      throw new Error("FFmpeg checksum mismatch. Refusing unverified binaries.");
    }
    const command = `$ErrorActionPreference = 'Stop'; Expand-Archive -LiteralPath ${powershellQuote(archive)} -DestinationPath ${powershellQuote(extract)} -Force`;
    const result = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", command],
      { stdio: "inherit", windowsHide: true });
    if (result.error || result.status !== 0) {
      throw new Error(`FFmpeg extraction failed: ${result.error || result.status}`);
    }
    const roots = readdirSync(extract, { withFileTypes: true })
      .filter(entry => entry.isDirectory() && entry.name.startsWith("ffmpeg-"));
    if (roots.length !== 1) throw new Error("Unexpected FFmpeg archive layout");
    const source = join(extract, roots[0].name);
    for (const name of ["ffmpeg.exe", "ffprobe.exe"]) {
      if (!existsSync(join(source, "bin", name))) throw new Error(`Missing engine: ${name}`);
    }
    if (!existsSync(join(source, "LICENSE"))) {
      throw new Error("FFmpeg license notice missing; refusing to bundle");
    }
    mkdirSync(DEST, { recursive: true });
    for (const name of ["ffmpeg.exe", "ffprobe.exe"]) {
      copyFileSync(join(source, "bin", name), join(DEST, name));
    }
    copyFileSync(join(source, "LICENSE"), join(DEST, "LICENSE"));
    writeFileSync(MANIFEST, JSON.stringify({
      version: VERSION, archiveUrl: ARCHIVE_URL, archiveSha256: ARCHIVE_SHA256,
      distributor: "Gyan Doshi", license: "GPL-3.0", sourceUrl: "https://ffmpeg.org/download.html",
    }, null, 2) + "\n");
    console.log("FFmpeg and FFprobe prepared for offline installer packaging.");
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
