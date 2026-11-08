// CI check for completeness of the curated 14-language core UI dictionary.
import { readFileSync } from "node:fs";

const source = readFileSync("src/localization.ts", "utf8");
const options = source.match(/export const LANGUAGE_OPTIONS = (\[[\s\S]*?\]) as const;/);
const keysMatch = source.match(/export const LANG_KEYS = (\[[^\n]+\]) as const;/);
const dictionaries = source.match(/const messages: Record<LanguageCode, readonly string\[\]> = (\{[\s\S]*?\n\});/);
if (!options || !keysMatch || !dictionaries) {
  throw new Error("Cannot read translation definitions");
}
const languages = JSON.parse(options[1]);
const keys = JSON.parse(keysMatch[1]);
const messages = JSON.parse(dictionaries[1]);
const failures = [];
const codes = new Set(languages.map(x => x.code));
if (languages.length !== 14 || codes.size !== 14) failures.push("Expected 14 distinct languages");
if (keys.length !== new Set(keys).size) failures.push("Duplicate translation keys");
for (const { code, label } of languages) {
  if (!label?.trim()) failures.push("Unnamed language: " + code);
  const entries = messages[code];
  if (!Array.isArray(entries) || entries.length !== keys.length) {
    failures.push(code + ": expected " + keys.length + " translated entries");
    continue;
  }
  entries.forEach((value, index) => {
    if (typeof value !== "string" || !value.trim()) {
      failures.push(code + ": empty translation for " + keys[index]);
    }
  });
}
const rtl = source.match(/export const RTL_LANGUAGES = new Set<string>\((\[[^\n]+\])\);/);
if (!rtl || JSON.stringify(JSON.parse(rtl[1]).sort()) !== JSON.stringify(["ar","fa","ur"].sort())) {
  failures.push("Arabic, Persian and Urdu must be declared RTL");
}
const app = readFileSync("src/App.tsx", "utf8");
const referenced = [...app.matchAll(/\btx\("([^"]+)"\)/g)].map(m => m[1]);
for (const key of referenced) {
  if (!keys.includes(key)) failures.push("App.tsx refers to missing translation: " + key);
}
const css = readFileSync("src/styles.css", "utf8");
for (const selector of ['html[dir="rtl"] .shell', ':focus-visible']) {
  if (!css.includes(selector)) failures.push("Missing RTL or focus style: " + selector);
}
if (failures.length) {
  console.error("Localization/accessibility audit:\n" + failures.join("\n"));
  process.exitCode = 1;
} else {
  console.log("Verified " + languages.length + " UI languages and " + keys.length + " keys; RTL selectors and focus styles.");
}
