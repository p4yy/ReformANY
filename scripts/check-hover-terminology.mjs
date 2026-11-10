// Target the application-facing legacy preview entrypoints without rejecting
// ordinary words like floating or Rust floating-point arithmetic.
import { readFileSync } from "node:fs";
const active = ["src/App.tsx", "src/orbit/OrbitHUD.tsx", "src/lib/desktop.ts"];
const blocked = [/\\bFloatWindow\\b/g, /\\bFloatView\\b/g, /\\bfloat_file_context\\b/g, /\\bfloat_file\\b/g, /ReformANY Float/g];
const found = [];
for (const path of active) {
  const source = readFileSync(path, "utf8");
  for (const pattern of blocked) {
    for (const hit of source.matchAll(pattern)) found.push(path + ": " + hit[0]);
  }
}
if (found.length) { console.error("Obsolete active preview entrypoints:\\n" + found.join("\\n")); process.exitCode = 1; }
else console.log("PASS: HoveR is the only active preview entrypoint.");
