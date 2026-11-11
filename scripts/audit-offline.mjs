// First-party runtime network API guard; dynamic VM inspection still required.
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join, extname } from "node:path";
const folders = ["src", "src-tauri/src"];
const extensions = new Set([".ts", ".tsx", ".js", ".rs"]);
const forbidden = [
  /\bfetch\s*\(/g, /\bXMLHttpRequest\b/g, /\bWebSocket\s*\(/g,
  /\bEventSource\s*\(/g, /\bnavigator\.sendBeacon\s*\(/g,
  /\bwindow\.open\s*\(/g, /\blocation\.(?:assign|replace)\s*\(/g,
  /\b(reqwest|ureq|hyper)::/g,
];
const violations = [];
let checked = 0;
function visit(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const file = join(dir, entry.name);
    if (entry.isDirectory()) visit(file);
    else if (extensions.has(extname(file))) {
      const source = readFileSync(file, "utf8"); checked++;
      for (const rule of forbidden) for (const hit of source.matchAll(rule)) {
        const line = source.slice(0, hit.index).split("\n").length;
        violations.push(file + ":" + line + ": " + rule.source);
      }
    }
  }
}
for (const dir of folders) visit(dir);
for (const dir of ["public/pdfjs/cmaps", "public/pdfjs/standard_fonts", "public/pdfjs/wasm"]) {
  if (!existsSync(dir)) violations.push("Missing PDF.js offline resource: " + dir);
}
if (violations.length) {
  console.error("Offline guard failed:\n" + violations.join("\n"));
  process.exitCode = 1;
} else {
  console.log("Offline source guard passed: " + checked + " source files and bundled PDF assets.");
}
