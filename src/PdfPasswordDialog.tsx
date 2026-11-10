import {useEffect,useState,type FormEvent} from "react";
import {Eye,EyeOff,LockKeyhole,ShieldCheck,UnlockKeyhole,X} from "lucide-react";
export type PdfPasswordRequest={mode:"protect"|"unlock";password:string};
export default function PdfPasswordDialog({name,working,error,onSave,onClose}:{
  name:string;working:boolean;error:string|null;
  onSave:(request:PdfPasswordRequest)=>void;onClose:()=>void;
}){
  const [mode,setMode]=useState<"protect"|"unlock">("protect");
  const [password,setPassword]=useState("");
  const [confirm,setConfirm]=useState("");
  const [visible,setVisible]=useState(false);
  const valid=mode==="protect"
    ? password.length>=8&&password.length<=127&&password===confirm
    : password.length>0;
  useEffect(()=>{
    const handler=(event:KeyboardEvent)=>{
      if(event.key==="Escape"&&!working){
        event.preventDefault();event.stopPropagation();onClose();
      }
    };
    document.addEventListener("keydown",handler,true);
    return()=>document.removeEventListener("keydown",handler,true);
  },[onClose,working]);
  const submit=(event:FormEvent)=>{
    event.preventDefault();
    if(valid&&!working)onSave({mode,password});
  };
  return <div className="orbit-action-dialog" data-orbit-dialog role="presentation">
    <section className="orbit-action-panel" role="dialog" aria-modal="true"
      aria-label="PDF password protection" aria-busy={working}>
      <button type="button" className="orbit-dialog-close" aria-label="Close PDF password"
        onClick={onClose} disabled={working}><X size={20}/></button>
      <div className="orbit-dialog-icon">{mode==="protect"?<ShieldCheck size={22}/>:<UnlockKeyhole size={22}/>}</div>
      <h2>PDF password</h2>
      <p>{mode==="protect"?"Create a new PDF with AES-256 open-password encryption.":
        "Remove protection only when you know the current PDF owner password."}</p>
      <div className="orbit-dialog-file"><LockKeyhole size={17}/><span title={name}>{name}</span></div>
      <div className="orbit-dialog-presets">
        <button type="button" aria-pressed={mode==="protect"} disabled={working}
          onClick={()=>{setMode("protect");setPassword("");setConfirm("");}}>Protect</button>
        <button type="button" aria-pressed={mode==="unlock"} disabled={working}
          onClick={()=>{setMode("unlock");setPassword("");setConfirm("");}}>Remove protection</button>
      </div>
      <form onSubmit={submit}>
        <label htmlFor="pdf-password">{mode==="protect"?"New PDF password":"Existing owner password"}</label>
        <div className="orbit-dialog-field">
          <input id="pdf-password" type={visible?"text":"password"} autoFocus
            value={password} maxLength={127}
            onChange={event=>setPassword(event.target.value)}
            autoComplete="new-password" required/>
          <button className="orbit-dialog-eye" type="button" onClick={()=>setVisible(!visible)}
            aria-label={visible?"Hide password":"Show password"}>{visible?<EyeOff size={17}/>:<Eye size={17}/>}</button>
        </div>
        {mode==="protect"&&<>
          <label htmlFor="pdf-confirm-password">Confirm new password</label>
          <input type={visible?"text":"password"} id="pdf-confirm-password" value={confirm}
            maxLength={127} autoComplete="new-password" required
            onChange={event=>setConfirm(event.target.value)}/>
          {password.length>0&&password.length<8&&<p className="orbit-dialog-error" role="status">
            At least 8 characters are required.
          </p>}
          {confirm&&confirm!==password&&<p className="orbit-dialog-error" role="status">Passwords do not match.</p>}
          {password.length>=8&&confirm===password&&<p className="orbit-dialog-hint" role="status">
            Ready to encrypt with AES-256.
          </p>}
        </>}
        <p className="orbit-dialog-hint">The original remains unchanged. Passwords are never saved. Keep the password somewhere safe.</p>
        {error&&<p className="orbit-dialog-error" role="alert">{error}</p>}
        <div className="orbit-dialog-footer">
          <button type="button" className="orbit-dialog-cancel" disabled={working} onClick={onClose}>Cancel</button>
          <button type="submit" className="orbit-dialog-submit" disabled={!valid||working}>
            {working?"Processing…":mode==="protect"?"Protect PDF":"Remove password"}
          </button>
        </div>
      </form>
    </section>
  </div>;
}
