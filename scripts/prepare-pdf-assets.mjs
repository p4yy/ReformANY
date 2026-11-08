import { cpSync, existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";

const packageRoot = resolve("node_modules/pdfjs-dist");
const target = resolve("public/pdfjs");
if (!existsSync(packageRoot)) {
  throw new Error("pdfjs-dist is missing. Install dependencies before building.");
}
mkdirSync(target, { recursive: true });
for (const folder of ["cmaps", "standard_fonts", "wasm"]) {
  const source = resolve(packageRoot, folder);
  if (!existsSync(source)) {
    throw new Error("PDF.js package is missing required offline resource folder: " + folder);
  }
  cpSync(source, resolve(target, folder), { recursive: true, force: true });
}
console.log("Bundled local PDF.js fonts, character maps and image decoders.");
