import { useEffect, useState } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { ArrowRight, CircleAlert, Clapperboard, Folder, FolderOpen, LoaderCircle, Plus, CheckCircle2 } from "lucide-react";

type Tool = { value:string; title:string; note:string; multiple?:boolean };
const actions:Tool[] = [
  { value:"compress-video", title:"Compress video", note:"Re-encode MP4 at smaller quality" },
  { value:"compress-audio", title:"Compress audio", note:"Convert to compact 96 kb/s MP3" },
  { value:"normalize-audio", title:"Normalize loudness", note:"EBU R128 loudness processing to WAV" },
  { value:"merge-audio", title:"Merge audio", note:"Join 2–12 clips in the chosen order", multiple:true },
  { value:"merge-video", title:"Merge video", note:"Join 2–12 clips; outputs 720p and requires audio tracks", multiple:true },
  { value:"rotate-video", title:"Rotate video", note:"Turn video 90° clockwise" },
  { value:"flip-video", title:"Flip horizontally", note:"Mirror the video image" },
  { value:"flip-vertical", title:"Flip vertically", note:"Invert the video image" },
  { value:"strip-metadata", title:"Remove media metadata", note:"Create a copy without container tags/chapters" },
];
function fileName(s:string){return s.split(/[\\/]/).pop()||s;}

export default function MediaToolsPanel() {
  const [action,setAction]=useState("compress-video");
  const [paths,setPaths]=useState<string[]>([]);
  const [directory,setDirectory]=useState<string|null>(null);
  const [ready,setReady]=useState(false);
  const [working,setWorking]=useState(false);
  const [output,setOutput]=useState<string|null>(null);
  const [error,setError]=useState<string|null>(null);
  const selected=actions.find(item=>item.value===action)||actions[0];
  useEffect(()=>{
    if(!isTauri())return;
    void invoke<{ffmpeg:boolean;ffprobe:boolean}>("engine_status").then(x=>setReady(x.ffmpeg&&x.ffprobe))
      .catch(()=>setReady(false));
  },[]);
  async function selectFiles() {
    try {
      const response:unknown=await open({multiple:selected.multiple||false,directory:false});
      const chosen:string[]=Array.isArray(response)
        ? response.filter((v):v is string=>typeof v==="string")
        : typeof response==="string" ? [response] : [];
      if(chosen.length) {setPaths(chosen.slice(0,12));setError(null);setOutput(null);}
    }catch(cause){setError(String(cause));}
  }
  async function chooseDir(){
    try {const dir=await open({directory:true,multiple:false});if(typeof dir==="string")setDirectory(dir);}
    catch(cause){setError(String(cause));}
  }
  async function run(){
    if(!ready||working||paths.length===0||selected.multiple&&paths.length<2)return;
    setWorking(true);setOutput(null);setError(null);
    try{const value=await invoke<string>("media_edit",{
      job:{paths,action,destination:directory}
    });setOutput(value);}
    catch(cause){setError(String(cause));}
    finally{setWorking(false);}
  }
  return <div className="content engine-page">
    <h1>Media tools</h1>
    <p>Practical, local FFmpeg operations. Each tool produces a new file without changing the source.</p>
    <div className="engine-card">
      <div className="engine-card-title"><Clapperboard size={19}/><h2>Select a tool</h2></div>
      <div className="media-action-list">
        {actions.map(item=><button key={item.value} className={item.value===action?"selected":""}
          onClick={()=>{setAction(item.value);setPaths([]);setError(null);setOutput(null);}} disabled={working}>
          <strong>{item.title}</strong><small>{item.note}</small>
        </button>)}
      </div>
      <div className="engine-card-title media-tool-title"><Clapperboard size={19}/><h2>Source{selected.multiple?" clips":""}</h2></div>
      <button className="engine-input" disabled={working} onClick={()=>void selectFiles()}>
        <Clapperboard size={22}/><span>{paths.length? paths.length===1?fileName(paths[0]):paths.length+" clips selected":"Select "+(selected.multiple?"2–12 clips":"a file")}
          <small>{paths.length?paths.map(fileName).join(" • "):"Local video or audio only"}</small></span><Plus size={17}/>
      </button>
      <div className="engine-directory">
        <div><strong>Output location</strong><small>{directory||"Alongside the first source"}</small></div>
        <button className="button secondary" disabled={working} onClick={()=>void chooseDir()}><Folder size={16}/> Choose folder</button>
      </div>
    </div>
    <div className="engine-action-row">
      <div><strong>{ready?"FFmpeg ready":"FFmpeg and FFprobe required"}</strong>
        <small>{selected.note}. Processing speed depends on file size and CPU.</small></div>
      <button className="button primary" onClick={()=>void run()}
        disabled={working||!ready||!paths.length||(selected.multiple&&paths.length<2)}>
        {working?<><LoaderCircle size={17} className="engine-spin"/> Processing…</>:<>Apply tool <ArrowRight size={16}/></>}
      </button>
    </div>
    {error&&<p className="engine-error" role="alert"><CircleAlert size={16}/>{error}</p>}
    {output&&<div className="engine-success"><div><CheckCircle2 size={18}/> Done<small>{output}</small></div>
      <button className="button secondary" onClick={()=>void invoke("reveal_output",{path:output})}><FolderOpen size={16}/> Show file</button>
    </div>}
    <p className="engine-footnote">For merging, output is re-encoded; mixed clips may require compatible streams and can fail with an informative error. FFmpeg filters and codecs depend on the installed build. No hidden uploads.</p>
  </div>;
}
