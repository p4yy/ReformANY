import {useEffect,useState,type FormEvent} from "react";
import {invoke} from "@tauri-apps/api/core";
import {listen} from "@tauri-apps/api/event";
import {AlertTriangle,Trash2,X} from "lucide-react";
type Preview={fileCount:number;totalBytes:number;directories:number};
type Progress={processed:number;total:number;filesRemoved:number};
const bytes=(n:number)=>n<1024?n+" bytes":n<1048576?(n/1024).toFixed(1)+" KB":
  (n/1048576).toFixed(1)+" MB";
export default function ShredDialog({path,name,busy,error,onDelete,onClose}:{
  path:string;name:string;busy:boolean;error:string|null;
  onDelete:()=>void;onClose:()=>void;
}){
  const [details,setDetails]=useState<Preview|null>(null);
  const [previewError,setPreviewError]=useState<string|null>(null);
  const [typed,setTyped]=useState("");
  const [progress,setProgress]=useState<Progress|null>(null);
  useEffect(()=>{
    let alive=true;
    void invoke<Preview>("shred_preview",{path})
      .then(value=>{if(alive)setDetails(value);})
      .catch(e=>{if(alive)setPreviewError(String(e));});
    const listener=listen<Progress>("reformany:shred-progress",event=>{
      if(alive)setProgress(event.payload);
    });
    return()=>{alive=false;void listener.then(fn=>fn());};
  },[path]);
  useEffect(()=>{
    const handler=(event:KeyboardEvent)=>{
      if(event.key==="Escape"&&!busy){event.preventDefault();event.stopPropagation();onClose();}
    };
    document.addEventListener("keydown",handler,true);
    return()=>document.removeEventListener("keydown",handler,true);
  },[busy,onClose]);
  const submit=(event:FormEvent)=>{
    event.preventDefault();
    if(typed==="SHRED"&&details&&!busy)onDelete();
  };
  return <div className="orbit-action-dialog" data-orbit-dialog role="presentation">
    <section className="orbit-action-panel" role="alertdialog" aria-modal="true"
      aria-label="Confirm permanent Shred" aria-busy={busy}>
      <button className="orbit-dialog-close" type="button" aria-label="Close Shred dialog"
        disabled={busy} onClick={onClose}><X size={20}/></button>
      <div className="orbit-dialog-icon"><AlertTriangle size={25}/></div>
      <h2>Shred permanently?</h2>
      <p>This action attempts one overwrite before permanent deletion.
        It is NOT guaranteed secure erasure on SSDs, USB, cloud-sync or backup systems.
        There is no Undo.</p>
      <div className="orbit-dialog-file"><Trash2 size={17}/><span title={name}>{name}</span>
        <small>{details?bytes(details.totalBytes):"Inspecting…"}</small>
      </div>
      {details&&<p className="orbit-dialog-hint">{details.fileCount} files · {details.directories} folders.
        The entire selected file or folder will be deleted.</p>}
      {previewError&&<p className="orbit-dialog-error" role="alert">{previewError}</p>}
      {busy&&<div role="progressbar" aria-label="Permanent deletion progress"
        aria-valuenow={progress?.processed??0} aria-valuemin={0}
        aria-valuemax={progress?.total??1}>
        <div className="orbit-shred-meter">
          <span style={{width:Math.round(100*(progress?.processed??0)/Math.max(1,progress?.total??1))+"%"}}/>
        </div>
        <small>{progress?.processed??0}/{progress?.total??details?.fileCount??0} items processed</small>
      </div>}
      <form onSubmit={submit}>
        <label htmlFor="orbit-shred-confirm">Type SHRED to confirm</label>
        <input id="orbit-shred-confirm" value={typed} autoFocus disabled={busy}
          onChange={e=>setTyped(e.target.value)} autoComplete="off" maxLength={10}
          placeholder="SHRED"/>
        {typed&&typed!=="SHRED"&&<p className="orbit-dialog-error" role="status">Confirmation must match SHRED exactly.</p>}
        {error&&<p className="orbit-dialog-error" role="alert">{error}</p>}
        <div className="orbit-dialog-footer">
          <button type="button" className="orbit-dialog-cancel" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="submit" className="orbit-dialog-submit" disabled={!details||busy||typed!=="SHRED"}>
            {busy?"Deleting…":"Shred permanently"}
          </button>
        </div>
      </form>
    </section>
  </div>;
}
