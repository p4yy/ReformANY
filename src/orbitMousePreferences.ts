/** Preferences are shared across main ReformANY and its Orbit WebView.
 * Explorer hold/shake is NOT exposed as a functioning toggle until there is
 * a verified, installed Windows OLE drag integration.
 */
export type OrbitSection = "convert" | "tools" | "actions";
export type OrbitShortcutMap = Record<OrbitSection,string>;
export type OrbitMousePreferences = {
  firstSection: OrbitSection;
  scrollSections: boolean;
  pointerSpinner: boolean;
  shortcuts: OrbitShortcutMap;
};
export const DEFAULT_SHORTCUTS:OrbitShortcutMap={
  convert:"Shift",tools:"Ctrl",actions:"Alt",
};
const KEY="reformany.orbit.mouse.v1";
const DEFAULTS:OrbitMousePreferences={
  firstSection:"convert",scrollSections:true,pointerSpinner:true,
  shortcuts:{...DEFAULT_SHORTCUTS},
};
const RESERVED=new Set(["Ctrl+R","Ctrl+W","Ctrl+S","Ctrl+O","Ctrl+P","Ctrl+L",
  "Ctrl+Tab","Alt+F4","Alt+Tab","Ctrl+Shift+Escape"]);
const ORDER:OrbitSection[]=["convert","tools","actions"];
export function shortcutFromKeyboard(event:KeyboardEvent):string|null{
  if(event.metaKey||event.key==="Meta"||event.key==="AltGraph")return null;
  if(event.key==="Shift")return "Shift";
  if(event.key==="Control")return "Ctrl";
  if(event.key==="Alt")return "Alt";
  if(event.key==="Escape"||event.key==="Tab")return null;
  const key=event.key.length===1?event.key.toUpperCase():event.key;
  if(!/^[A-Z0-9]$/.test(key)&&!/^F([1-9]|1[0-2])$/.test(key))return null;
  if(!event.ctrlKey&&!event.altKey&&!event.shiftKey)return null;
  return [...(event.ctrlKey?["Ctrl"]:[]),...(event.altKey?["Alt"]:[]),
    ...(event.shiftKey?["Shift"]:[]),key].join("+");
}
export function validateShortcut(next:string,current:OrbitShortcutMap,section:OrbitSection):string|null{
  if(!next)return "Press a modifier key or a modified letter/number.";
  if(RESERVED.has(next))return "That shortcut belongs to Windows or a standard application command.";
  for(const other of ORDER){
    if(other!==section&&current[other]===next)
      return `Already assigned to ${other[0].toUpperCase()+other.slice(1)}.`;
  }
  return null;
}
export function readOrbitMousePreferences():OrbitMousePreferences{
  try{
    const candidate:unknown=JSON.parse(localStorage.getItem(KEY)||"null");
    if(!candidate||typeof candidate!=="object")return {...DEFAULTS,shortcuts:{...DEFAULT_SHORTCUTS}};
    const data=candidate as Record<string,unknown>;
    const raw=data.shortcuts&&typeof data.shortcuts==="object"?data.shortcuts as Record<string,unknown>:{};
    const shortcuts:OrbitShortcutMap={...DEFAULT_SHORTCUTS};
    const used=new Set<string>();
    for(const section of ORDER){
      const key=typeof raw[section]==="string"?raw[section] as string:DEFAULT_SHORTCUTS[section];
      const valid=key.length<=24&&key.length>0&&!RESERVED.has(key)&&!used.has(key);
      shortcuts[section]=valid?key:DEFAULT_SHORTCUTS[section];
      used.add(shortcuts[section]);
    }
    return {
      firstSection:ORDER.includes(data.firstSection as OrbitSection)?
        data.firstSection as OrbitSection:"convert",
      scrollSections:typeof data.scrollSections==="boolean"?data.scrollSections:true,
      pointerSpinner:typeof data.pointerSpinner==="boolean"?data.pointerSpinner:true,
      shortcuts,
    };
  }catch{return {...DEFAULTS,shortcuts:{...DEFAULT_SHORTCUTS}};}
}
export function saveOrbitMousePreferences(value:OrbitMousePreferences):void{
  try{localStorage.setItem(KEY,JSON.stringify(value));}
  catch{/* Storage denial must never block Orbit */}
}
