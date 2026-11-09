import {execFileSync} from "node:child_process";
import {readFileSync} from "node:fs";

// Permanently reject obsolete HoveR naming in the active source tree.
// Splitting the retired word prevents this guard from matching itself.
const oldName = ["flo", "at"].join("");
const checkedExtensions=new Set([
  ".ts",".tsx",".js",".jsx",".mjs",".cjs",".rs",".cpp",".h",".css",".html",
  ".md",".json",".toml",".yaml",".yml",".nsi",".nsh",".ps1",".txt",".xml"
]);
const paths=execFileSync("git",["ls-files","-z"],{encoding:"utf8"})
  .split("\0").filter(Boolean);
const found=[];
for(const path of paths){
  const matched=[...checkedExtensions].some(extension=>path.toLowerCase().endsWith(extension));
  if(!matched)continue;
  const source=readFileSync(path,"utf8");
  const regex=new RegExp(oldName,"ig");
  const lines=source.split(/\r?\n/);
  for(let i=0;i<lines.length;i++){
    if(regex.test(lines[i]))found.push(path+":"+(i+1)+": "+lines[i].trim().slice(0,180));
    regex.lastIndex=0;
  }
  if(path.toLowerCase().includes(oldName))found.push("Legacy filename: "+path);
}
if(found.length){
  console.error("The obsolete preview name remains in tracked files:\n"+found.join("\n"));
  process.exit(1);
}
console.log("PASS: All tracked source, documentation, settings and CI use the HoveR name.");
