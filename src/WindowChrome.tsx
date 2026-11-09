import {useCallback, useEffect, useMemo, useState, type MouseEvent} from "react";
import {getCurrentWindow} from "@tauri-apps/api/window";
import {Minus, Square, Copy, X} from "lucide-react";
import {appIcon} from "./brand";

/**
 * One shared, keyboard-accessible titlebar for native, undecorated ReformANY
 * windows. Only noninteractive header space starts a native window drag.
 */
export default function WindowChrome({title, maximizable=true, compact=false}:{
  title:string; maximizable?:boolean; compact?:boolean;
}) {
  const win=useMemo(()=>getCurrentWindow(),[]);
  const [maximized,setMaximized]=useState(false);
  const [failure,setFailure]=useState<string|null>(null);
  const refresh=useCallback(async()=>{
    try {setMaximized(await win.isMaximized());}catch{ /* Windows state unavailable */ }
  },[win]);
  useEffect(()=>{
    void refresh();
    let alive=true;
    const unsubscribe=win.onResized(()=>{if(alive)void refresh()});
    return ()=>{alive=false;void unsubscribe.then(stop=>stop()).catch(()=>{});};
  },[win,refresh]);
  async function run(operation:()=>Promise<void>){
    try {setFailure(null);await operation();await refresh();}
    catch(error){setFailure("Window action failed: "+String(error));}
  }
  function beginDrag(event:MouseEvent<HTMLElement>){
    if(event.button!==0 || (event.target as HTMLElement).closest("button"))return;
    if(event.detail>=2){
      if(maximizable)void run(()=>win.toggleMaximize());
      return;
    }
    void run(()=>win.startDragging());
  }
  return <header className={"reformany-window-chrome"+(compact?" is-compact":"")}
    aria-label={title+" window controls"}>
    <div className="window-chrome-grip"
      onMouseDown={beginDrag} onDoubleClick={event=>event.preventDefault()}>
      <img src={appIcon} alt="" width={19} height={19} draggable={false}/>
      <span className="window-chrome-title">{title}</span>
    </div>
    <div className="window-chrome-actions">
      <button type="button" aria-label="Minimize" title="Minimize"
        onClick={()=>void run(()=>win.minimize())}><Minus size={16}/></button>
      {maximizable&&<button type="button" aria-label={maximized?"Restore":"Maximize"}
        title={maximized?"Restore":"Maximize"}
        onClick={()=>void run(()=>win.toggleMaximize())}>
        {maximized?<Copy size={14}/>:<Square size={13}/>}
      </button>}
      <button type="button" className="window-chrome-close" aria-label="Close"
        title="Close" onClick={()=>void run(()=>win.close())}><X size={18}/></button>
    </div>
    {failure&&<span className="window-chrome-error" role="alert">{failure}</span>}
  </header>;
}
