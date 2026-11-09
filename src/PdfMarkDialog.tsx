import {useEffect,useRef,useState,type FormEvent,type PointerEvent} from "react";
import {invoke} from "@tauri-apps/api/core";
import {GlobalWorkerOptions,getDocument} from "pdfjs-dist/legacy/build/pdf.mjs";
import worker from "pdfjs-dist/legacy/build/pdf.worker.min.mjs?url";
import {ChevronLeft,ChevronRight,FileSignature,RotateCcw,Stamp,ZoomIn,ZoomOut,X} from "lucide-react";
GlobalWorkerOptions.workerSrc=worker;
type PDFDoc=Awaited<ReturnType<typeof getDocument>["promise"]>;

export type PdfMark={text:string;color:string;size:number;opacity:number;rotation:number;
  x:number;y:number;pages:string|null};
type Info={kind:string;content:string};
function bytes(base64:string):Uint8Array {
  const raw=atob(base64),buffer=new Uint8Array(raw.length);
  for(let i=0;i<raw.length;i++)buffer[i]=raw.charCodeAt(i);
  return buffer;
}
function clamp(n:number,low:number,high:number){return Math.max(low,Math.min(high,n));}

export default function PdfMarkDialog({path,name,signature,working,error,onSave,onClose}:{
  path:string;name:string;signature:boolean;working:boolean;error:string|null;
  onSave:(mark:PdfMark)=>void;onClose:()=>void
}){
  const canvas=useRef<HTMLCanvasElement>(null);
  const paper=useRef<HTMLDivElement>(null);
  const documentRef=useRef<PDFDoc|null>(null);
  const dragging=useRef(false);
  const [text,setText]=useState(signature?"Approved by":"DRAFT");
  const [color,setColor]=useState(signature?"#263A24":"#C8D4A2");
  const [size,setSize]=useState(signature?28:36);
  const [opacity,setOpacity]=useState(signature?100:25);
  const [rotation,setRotation]=useState(signature?0:-35);
  const [x,setX]=useState(50),[y,setY]=useState(50);
  const [scope,setScope]=useState<"all"|"single">(signature?"single":"all");
  const [page,setPage]=useState("1");
  const [previewPage,setPreviewPage]=useState(1);
  const [zoom,setZoom]=useState(100);
  const [total,setTotal]=useState<number|null>(null);
  const [viewportScale,setViewportScale]=useState(.7);
  const [previewError,setPreviewError]=useState<string|null>(null);

  useEffect(()=>{
    let alive=true;
    let loader:ReturnType<typeof getDocument>|null=null;
    documentRef.current=null;
    setTotal(null);
    setPreviewError(null);
    void invoke<Info>("document_preview",{path}).then(async file=>{
      if(!alive)return;
      if(file.kind!=="pdf")throw new Error("The selected file is not a readable PDF");
      loader=getDocument({data:bytes(file.content),cMapUrl:"/pdfjs/cmaps/",
        standardFontDataUrl:"/pdfjs/standard_fonts/",wasmUrl:"/pdfjs/wasm/",
        cMapPacked:true,useSystemFonts:true});
      const pdf=await loader.promise;
      if(!alive)return;
      documentRef.current=pdf;
      setTotal(pdf.numPages);
      setPreviewPage(1);
    }).catch(cause=>{if(alive)setPreviewError("Cannot load PDF preview: "+String(cause));});
    return ()=>{alive=false;documentRef.current=null;void loader?.destroy();};
  },[path]);

  useEffect(()=>{
    const pdf=documentRef.current;
    const screen=canvas.current;
    if(!pdf||!screen||!total)return;
    let alive=true;
    let rendering:ReturnType<Awaited<ReturnType<PDFDoc["getPage"]>>["render"]>|null=null;
    void pdf.getPage(previewPage).then(async current=>{
      if(!alive)return;
      const base=current.getViewport({scale:1});
      const scale=clamp(440/Math.max(1,base.width),.20,1.2)*zoom/100;
      const view=current.getViewport({scale});
      const context=screen.getContext("2d",{alpha:false});
      if(!context)return;
      screen.width=Math.ceil(view.width);
      screen.height=Math.ceil(view.height);
      setViewportScale(scale);
      rendering=current.render({canvas:screen,canvasContext:context,viewport:view,background:"#ffffff"});
      await rendering.promise;
    }).catch(cause=>{if(alive&&String(cause).indexOf("RenderingCancelledException")<0)
      setPreviewError("Cannot render PDF page: "+String(cause));});
    return ()=>{alive=false;rendering?.cancel();};
  },[previewPage,zoom,total]);

  useEffect(()=>{
    const close=(event:KeyboardEvent)=>{
      if(event.key==="Escape"&&!working){event.stopPropagation();event.preventDefault();onClose();}
    };
    document.addEventListener("keydown",close,true);
    return()=>document.removeEventListener("keydown",close,true);
  },[onClose,working]);

  const invalid=!text.trim()||text.length>96||!(/^[\x20-\x7E]+$/.test(text))||
    (scope==="single"&&(!total||!Number.isInteger(Number(page))||
      Number(page)<1||Number(page)>total));
  function reset(){setSize(signature?28:36);setOpacity(signature?100:25);
    setRotation(signature?0:-35);setX(50);setY(50);}
  function moveMark(event:PointerEvent<HTMLDivElement>){
    const rect=paper.current?.getBoundingClientRect();
    if(!rect||!rect.width||!rect.height)return;
    setX(clamp(Math.round((event.clientX-rect.left)/rect.width*100),10,90));
    setY(clamp(Math.round((1-(event.clientY-rect.top)/rect.height)*100),10,90));
  }
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
      <div className="orbit-dialog-icon">{signature?<FileSignature size={22}/>:<Stamp size={22}/>}</div>
      <h2>{signature?"Visual signature":"Watermark PDF"}</h2>
      <p>{signature?"Place a visible text mark. This is not a verified digital signature.":
        "Adjust the watermark on the real PDF page. The original remains unchanged."}</p>
      <div className="orbit-dialog-file"><span title={name}>{name}</span>
        <small>{total===null?"Reading…":total+" pages"}</small></div>
      <div className="orbit-mark-scroll">
        <div className="orbit-mark-preview-column">
          <div className="orbit-mark-preview-toolbar">
            <strong>Live preview</strong>
            <span>Page {previewPage}{total?" of "+total:""}</span>
            <button type="button" aria-label="Previous preview page" title="Previous page"
              disabled={previewPage<=1} onClick={()=>setPreviewPage(v=>v-1)}><ChevronLeft size={17}/></button>
            <button type="button" aria-label="Next preview page" title="Next page"
              disabled={total===null||previewPage>=total} onClick={()=>setPreviewPage(v=>v+1)}><ChevronRight size={17}/></button>
            <button type="button" aria-label="Zoom out" title="Zoom out"
              disabled={zoom<=50} onClick={()=>setZoom(v=>clamp(v-25,50,200))}><ZoomOut size={16}/></button>
            <span aria-label={"Zoom "+zoom+"%"}>{zoom}%</span>
            <button type="button" aria-label="Zoom in" title="Zoom in"
              disabled={zoom>=200} onClick={()=>setZoom(v=>clamp(v+25,50,200))}><ZoomIn size={16}/></button>
          </div>
          <div className="orbit-pdf-mark-preview" aria-label={"PDF page "+previewPage+" with live watermark overlay"}>
            <div className="orbit-mark-paper" ref={paper}
              onPointerDown={event=>{if(working)return;dragging.current=true;
                event.currentTarget.setPointerCapture(event.pointerId);moveMark(event);}}
              onPointerMove={event=>{if(dragging.current)moveMark(event);}}
              onPointerUp={event=>{dragging.current=false;
                if(event.currentTarget.hasPointerCapture(event.pointerId))
                  event.currentTarget.releasePointerCapture(event.pointerId);}}
              onPointerCancel={()=>{dragging.current=false;}}
              aria-label="Drag inside the document to move the watermark">
              <canvas ref={canvas} aria-label={"Rendered PDF page "+previewPage}/>
              <span className="orbit-mark-text" style={{
                position:"absolute",left:x+"%",top:(100-y)+"%",color,
                fontFamily:"Arial, Helvetica, sans-serif",
                fontSize:Math.max(5,size*viewportScale)+"px",
                opacity:opacity/100,
                transform:`translate(-50%,-50%) rotate(${-rotation}deg)`,
                whiteSpace:"nowrap",fontStyle:signature?"italic":"normal",
                fontWeight:500,pointerEvents:"none",userSelect:"none",
              }}>{text}</span>
            </div>
          </div>
          {previewError&&<p className="orbit-dialog-error" role="alert">{previewError}</p>}
          <p className="orbit-dialog-hint">Drag the mark on the page, or adjust its horizontal and vertical position on the right.</p>
        </div>
        <form id="pdf-mark-form" className="orbit-mark-settings" onSubmit={submit}>
          <label htmlFor="mark-content">{signature?"Signature / initials":"Watermark text"}</label>
          <input id="mark-content" value={text} maxLength={96}
            onChange={e=>setText(e.target.value)}/>
          <label htmlFor="mark-color">Color</label>
          <input id="mark-color" type="color" value={color} onChange={e=>setColor(e.target.value)}/>
          <div className="orbit-range-label"><label htmlFor="mark-size">Size</label><output htmlFor="mark-size">{size} pt</output></div>
          <input id="mark-size" type="range" min={8} max={108} step={1} value={size}
            onChange={e=>setSize(Number(e.target.value))}/>
          <div className="orbit-range-label"><label htmlFor="mark-angle">Rotation</label><output htmlFor="mark-angle">{rotation}°</output></div>
          <input id="mark-angle" type="range" min={-180} max={180} step={5} value={rotation}
            onChange={e=>setRotation(Number(e.target.value))}/>
          <div className="orbit-range-label"><label htmlFor="mark-opacity">Opacity</label><output htmlFor="mark-opacity">{opacity}%</output></div>
          <input id="mark-opacity" type="range" min={5} max={100} step={5} value={opacity}
            onChange={e=>setOpacity(Number(e.target.value))}/>
          <div className="orbit-range-label"><label htmlFor="mark-x">Horizontal position</label><output htmlFor="mark-x">{x}%</output></div>
          <input id="mark-x" type="range" min={10} max={90} step={1} value={x}
            onChange={e=>setX(Number(e.target.value))}/>
          <div className="orbit-range-label"><label htmlFor="mark-y">Vertical position</label><output htmlFor="mark-y">{y}%</output></div>
          <input id="mark-y" type="range" min={10} max={90} step={1} value={y}
            onChange={e=>setY(Number(e.target.value))}/>
          <button type="button" className="orbit-mark-reset" onClick={reset}>
            <RotateCcw size={14}/> Reset size and placement
          </button>
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
          disabled={working||invalid||total===null}>{working?"Applying…":"Save as new PDF"}</button>
      </div>
    </section>
  </div>;
}
