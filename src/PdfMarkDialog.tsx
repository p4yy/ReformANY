import {useEffect,useRef,useState,type FormEvent} from "react";
import {invoke} from "@tauri-apps/api/core";
import {GlobalWorkerOptions,getDocument} from "pdfjs-dist/legacy/build/pdf.mjs";
import worker from "pdfjs-dist/legacy/build/pdf.worker.min.mjs?url";
import {FileSignature,Stamp,X} from "lucide-react";
GlobalWorkerOptions.workerSrc=worker;

export type PdfMark={text:string;color:string;size:number;opacity:number;rotation:number;
  x:number;y:number;pages:string|null};
type Info={kind:string;content:string};
function bytes(base64:string):Uint8Array {
  const raw=atob(base64),buffer=new Uint8Array(raw.length);
  for(let i=0;i<raw.length;i++)buffer[i]=raw.charCodeAt(i);
  return buffer;
}
export default function PdfMarkDialog({path,name,signature,working,error,onSave,onClose}:{
  path:string;name:string;signature:boolean;working:boolean;error:string|null;
  onSave:(mark:PdfMark)=>void;onClose:()=>void
}){
  const canvas=useRef<HTMLCanvasElement>(null);
  const [text,setText]=useState(signature?"Approved by":"DRAFT");
  const [color,setColor]=useState(signature?"#263A24":"#C8D4A2");
  const [size,setSize]=useState(signature?28:36);
  const [opacity,setOpacity]=useState(signature?100:25);
  const [rotation,setRotation]=useState(signature?0:-35);
  const [x,setX]=useState(50),[y,setY]=useState(50);
  const [scope,setScope]=useState<"all"|"single">(signature?"single":"all");
  const [page,setPage]=useState("1");
  const [total,setTotal]=useState<number|null>(null);
  const [previewError,setPreviewError]=useState<string|null>(null);
  useEffect(()=>{
    let active=true;
    let loader:ReturnType<typeof getDocument>|undefined;
    const render=async()=>{
      try{
        const file=await invoke<Info>("document_preview",{path});
        if(!active)return;
        if(file.kind!=="pdf")throw new Error("Not a PDF");
        loader=getDocument({data:bytes(file.content),cMapUrl:"/pdfjs/cmaps/",
          standardFontDataUrl:"/pdfjs/standard_fonts/",wasmUrl:"/pdfjs/wasm/",cMapPacked:true,useSystemFonts:true});
        const document=await loader.promise;
        if(!active)return;
        setTotal(document.numPages);
        const first=await document.getPage(1);
        const viewport=first.getViewport({scale:Math.min(0.55,220/first.getViewport({scale:1}).width)});
        const screen=canvas.current;
        if(!active||!screen)return;
        screen.width=Math.ceil(viewport.width);screen.height=Math.ceil(viewport.height);
        const context=screen.getContext("2d",{alpha:false});
        if(!context)throw new Error("Cannot draw the PDF preview");
        await first.render({canvas:screen,canvasContext:context,viewport,background:"#ffffff"}).promise;
      }catch(e){if(active)setPreviewError(String(e));}
    };
    void render();
    return ()=>{active=false;void loader?.destroy();};
  },[path]);
  useEffect(()=>{
    const fn=(event:KeyboardEvent)=>{
      if(event.key==="Escape"&&!working){event.stopPropagation();event.preventDefault();onClose();}
    };
    document.addEventListener("keydown",fn,true);
    return()=>document.removeEventListener("keydown",fn,true);
  },[onClose,working]);
  const invalid=!text.trim()||text.length>96||!(/^[\x20-\x7E]+$/.test(text))||
    (scope==="single"&&(!total||!Number.isInteger(Number(page))||
      Number(page)<1||Number(page)>total));
  const submit=(event:FormEvent)=>{
    event.preventDefault();
    if(invalid||working)return;
    onSave({text,color,size,opacity:opacity/100,rotation,x:x/100,y:y/100,
      pages:scope==="all"?null:page});
  };
  return <div className="orbit-action-dialog" data-orbit-dialog role="presentation">
    <section className="orbit-action-panel orbit-pdf-mark-dialog" role="dialog" aria-modal="true"
      aria-label={signature?"Add visible PDF signature":"Watermark PDF"} aria-busy={working}>
      <button type="button" className="orbit-dialog-close" aria-label="Close PDF mark editor"
        disabled={working} onClick={onClose}><X size={19}/></button>
      <div className="orbit-dialog-icon">{signature?<FileSignature size={24}/>:<Stamp size={24}/>}</div>
      <h2>{signature?"Visual signature":"Watermark"}</h2>
      <p>{signature?"Places visible text on a PDF page. This is not a cryptographic digital signature.":
        "Add a real text watermark to the selected document without changing the original."}</p>
      <div className="orbit-dialog-file"><span title={name}>{name}</span><small>{total??"…"} pages</small></div>
      <div className="orbit-mark-scroll">
        <div className="orbit-pdf-mark-preview" aria-label="Live overlay preview for first PDF page">
          <div className="orbit-mark-paper" style={{width:220,maxWidth:"100%"}}>
            <canvas ref={canvas} aria-label="First PDF page"/>
            <span style={{
              position:"absolute",left:x+"%",top:(100-y)+"%",color,
              fontSize:Math.max(8,Math.min(42,size*.45))+"px",
              opacity:opacity/100,transform:`translate(-50%,-50%) rotate(${-rotation}deg)`,
              whiteSpace:"nowrap",fontStyle:signature?"italic":"normal",
              fontWeight:600,pointerEvents:"none",
            }}>{text}</span>
          </div>
        </div>
        {previewError&&<p className="orbit-dialog-error" role="alert">{previewError}</p>}
        <form id="pdf-mark-form" onSubmit={submit}>
          <label htmlFor="mark-content">{signature?"Signature or initials":"Watermark text"}</label>
          <input id="mark-content" value={text} maxLength={96} autoFocus
            onChange={e=>setText(e.target.value)}/>
          <div className="orbit-mark-controls">
            <label>Color <input type="color" value={color} onChange={e=>setColor(e.target.value)}/></label>
            <label>Size <input type="number" min={8} max={108} value={size}
              onChange={e=>setSize(Math.min(108,Math.max(8,Number(e.target.value))))}/></label>
          </div>
          <label htmlFor="mark-angle">Direction / Rotation · {rotation}°</label>
          <input id="mark-angle" type="range" min={-180} max={180} step={5} value={rotation}
            onChange={e=>setRotation(Number(e.target.value))}/>
          <label htmlFor="mark-opacity">Opacity · {opacity}%</label>
          <input id="mark-opacity" type="range" min={5} max={100} step={5} value={opacity}
            onChange={e=>setOpacity(Number(e.target.value))}/>
          <div className="orbit-mark-controls">
            <label>Horizontal · {x}% <input type="range" min={10} max={90} value={x}
              onChange={e=>setX(Number(e.target.value))}/></label>
            <label>Vertical · {y}% <input type="range" min={10} max={90} value={y}
              onChange={e=>setY(Number(e.target.value))}/></label>
          </div>
          <label htmlFor="mark-scope">Apply to</label>
          <select id="mark-scope" value={scope} onChange={e=>setScope(e.target.value as "all"|"single")}>
            {!signature&&<option value="all">All PDF pages</option>}
            <option value="single">One page</option>
          </select>
          {scope==="single"&&<label>Page number <input type="number" min={1}
            max={total??500} value={page} onChange={e=>setPage(e.target.value)}/></label>}
          {invalid&&<p className="orbit-dialog-error" role="status">Enter printable text and a valid page number.</p>}
          {error&&<p className="orbit-dialog-error" role="alert">{error}</p>}
        </form>
      </div>
      <div className="orbit-dialog-footer">
        <button type="button" className="orbit-dialog-cancel" disabled={working} onClick={onClose}>Cancel</button>
        <button type="submit" className="orbit-dialog-submit" form="pdf-mark-form"
          disabled={working||invalid||total===null}>{working?"Applying…":"Apply to PDF"}</button>
      </div>
    </section>
  </div>;
}
