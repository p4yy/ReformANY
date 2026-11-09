import {useEffect,useRef,useState,type DragEvent,type MouseEvent} from "react";
import {invoke} from "@tauri-apps/api/core";
import {GlobalWorkerOptions,getDocument} from "pdfjs-dist/legacy/build/pdf.mjs";
import worker from "pdfjs-dist/legacy/build/pdf.worker.min.mjs?url";
import {CornerUpLeft,RotateCcw,RotateCw,Trash2,X} from "lucide-react";
GlobalWorkerOptions.workerSrc=worker;
type PDFDoc=Awaited<ReturnType<typeof getDocument>["promise"]>;
export type PageEdit={sourcePage:number;rotation:number};
type Preview={kind:string;content:string};
function decode(source:string){
  const raw=atob(source),a=new Uint8Array(raw.length);
  for(let i=0;i<raw.length;i++)a[i]=raw.charCodeAt(i);
  return a;
}
function PageTile({doc,item,active,onClick,onDragStart,onDrop}:{
  doc:PDFDoc|null;item:PageEdit;active:boolean;onClick:(event:MouseEvent)=>void;
  onDragStart:(event:DragEvent)=>void;onDrop:(event:DragEvent)=>void
}){
  const canvas=useRef<HTMLCanvasElement>(null);
  const container=useRef<HTMLButtonElement>(null);
  const [visible,setVisible]=useState(false);
  useEffect(()=>{
    if(!container.current)return;
    const observer=new IntersectionObserver(entries=>{
      if(entries.some(e=>e.isIntersecting))setVisible(true);
    },{rootMargin:"160px"});
    observer.observe(container.current);
    return()=>observer.disconnect();
  },[]);
  useEffect(()=>{
    if(!doc||!visible||!canvas.current)return;
    let active=true;
    let task:ReturnType<Awaited<ReturnType<PDFDoc["getPage"]>>["render"]>|null=null;
    void doc.getPage(item.sourcePage).then(page=>{
      if(!active||!canvas.current)return;
      const natural=page.getViewport({scale:1});
      const viewport=page.getViewport({scale:Math.min(0.8,78/Math.max(1,natural.width))});
      const c=canvas.current;
      c.width=Math.ceil(viewport.width);c.height=Math.ceil(viewport.height);
      const ctx=c.getContext("2d",{alpha:false});
      if(!ctx)return;
      task=page.render({canvas:c,canvasContext:ctx,viewport,background:"#ffffff"});
      void task.promise.catch(()=>{});
    }).catch(()=>{});
    return()=>{active=false;task?.cancel();};
  },[doc,item.sourcePage,visible]);
  return <button type="button" className={"orbit-arrange-tile"+(active?" is-selected":"")}
      ref={container} draggable onClick={onClick} onDragStart={onDragStart}
      onDragOver={event=>event.preventDefault()} onDrop={onDrop}
      aria-pressed={active} title={"Original page "+item.sourcePage+"; rotate "+item.rotation+" degrees"}>
      <span className="orbit-arrange-thumb"><canvas ref={canvas}
        style={{transform:`rotate(${item.rotation}deg)`}}/></span>
      <small>Page {item.sourcePage}{item.rotation?" · "+item.rotation+"°":""}</small>
    </button>;
}
export default function PdfArrangeDialog({path,name,pageCount,working,error,onSave,onClose}:{
  path:string;name:string;pageCount:number;working:boolean;error:string|null;
  onSave:(edits:PageEdit[])=>void;onClose:()=>void;
}){
  const [items,setItems]=useState<PageEdit[]>(()=>Array.from({length:pageCount},
    (_,i)=>({sourcePage:i+1,rotation:0})));
  const [history,setHistory]=useState<PageEdit[][]>([]);
  const [selected,setSelected]=useState<number[]>([]);
  const [anchor,setAnchor]=useState<number|null>(null);
  const [doc,setDoc]=useState<PDFDoc|null>(null);
  const [warning,setWarning]=useState<string|null>(null);
  useEffect(()=>{
    let alive=true;let loading:ReturnType<typeof getDocument>|null=null;
    void invoke<Preview>("document_preview",{path}).then(async preview=>{
      if(!alive)return;
      if(preview.kind!=="pdf")throw Error("This is not a PDF");
      loading=getDocument({data:decode(preview.content),cMapUrl:"/pdfjs/cmaps/",
        standardFontDataUrl:"/pdfjs/standard_fonts/",wasmUrl:"/pdfjs/wasm/",cMapPacked:true});
      const pdf=await loading.promise;
      if(alive)setDoc(pdf);
    }).catch(e=>{if(alive)setWarning("Unable to render thumbnails: "+String(e));});
    return()=>{alive=false;void loading?.destroy();};
  },[path]);
  useEffect(()=>{
    const handler=(event:KeyboardEvent)=>{
      if(event.key==="Escape"&&!working){event.stopPropagation();event.preventDefault();onClose();}
    };
    window.addEventListener("keydown",handler,true);
    return()=>window.removeEventListener("keydown",handler,true);
  },[onClose,working]);
  const change=(next:PageEdit[])=>{
    if(working)return;
    setHistory(old=>[...old.slice(-29),items.map(x=>({...x}))]);
    setItems(next);setWarning(null);
  };
  const select=(index:number,event:MouseEvent)=>{
    const id=items[index]?.sourcePage;if(!id)return;
    if(event.shiftKey&&anchor!==null){
      const start=items.findIndex(i=>i.sourcePage===anchor);
      if(start>=0){setSelected(items.slice(Math.min(start,index),Math.max(start,index)+1)
        .map(p=>p.sourcePage));return;}
    }
    if(event.ctrlKey||event.metaKey){
      setSelected(old=>old.includes(id)?old.filter(x=>x!==id):[...old,id]);
    }else setSelected([id]);
    setAnchor(id);
  };
  const rotate=(degrees:number)=>{
    const chosen=selected.length?selected:[items[0]?.sourcePage];
    change(items.map(p=>chosen.includes(p.sourcePage)?{
      ...p,rotation:(p.rotation+degrees+360)%360,
    }:p));
  };
  const remove=()=>{
    if(!selected.length){setWarning("Select one or more pages to remove.");return;}
    if(selected.length>=items.length){setWarning("At least one PDF page must remain.");return;}
    change(items.filter(p=>!selected.includes(p.sourcePage)));
    setSelected([]);setAnchor(null);
  };
  const drop=(event:DragEvent,at:number)=>{
    event.preventDefault();
    const source=Number(event.dataTransfer.getData("text/plain"));
    const from=items.findIndex(p=>p.sourcePage===source);
    if(from<0||from===at)return;
    const reordered=[...items],moved=reordered.splice(from,1)[0];
    reordered.splice(at,0,moved);change(reordered);
  };
  const undo=()=>{
    const last=history.at(-1);if(!last)return;
    setHistory(h=>h.slice(0,-1));setItems(last);setSelected([]);
  };
  return <div className="orbit-action-dialog" data-orbit-dialog role="presentation">
    <section className="orbit-action-panel orbit-arrange-dialog" role="dialog"
      aria-label="Arrange PDF pages" aria-modal="true" aria-busy={working}>
      <button type="button" className="orbit-dialog-close" disabled={working}
        onClick={onClose} aria-label="Close page editor"><X size={19}/></button>
      <h2>Arrange pages</h2>
      <p>Drag thumbnails to reorder. Ctrl/Shift-select pages to rotate or remove. Undo before saving.</p>
      <div className="orbit-dialog-file"><span title={name}>{name}</span>
        <small>{items.length}/{pageCount} pages</small></div>
      <div className="orbit-arrange-toolbar">
        <button type="button" onClick={()=>rotate(-90)} disabled={working} title="Rotate left">
          <RotateCcw size={14}/> Left</button>
        <button type="button" onClick={()=>rotate(90)} disabled={working} title="Rotate right">
          <RotateCw size={14}/> Right</button>
        <button type="button" onClick={remove} disabled={working} title="Remove selected pages">
          <Trash2 size={14}/> Delete</button>
        <button type="button" onClick={undo} disabled={!history.length||working} title="Undo last edit">
          <CornerUpLeft size={14}/> Undo</button>
      </div>
      <div className="orbit-arrange-pages" role="group" aria-label="Drag to reorder PDF pages">
        {items.map((p,index)=><PageTile key={p.sourcePage} doc={doc} item={p}
          active={selected.includes(p.sourcePage)} onClick={e=>select(index,e)}
          onDragStart={e=>e.dataTransfer.setData("text/plain",String(p.sourcePage))}
          onDrop={e=>drop(e,index)}/>)}
      </div>
      <p className="orbit-dialog-hint">Adding pages from other documents requires the separate merge engine and is not available in this editor yet.</p>
      {warning&&<p className="orbit-dialog-error" role="status">{warning}</p>}
      {error&&<p className="orbit-dialog-error" role="alert">{error}</p>}
      <div className="orbit-dialog-footer">
        <button type="button" className="orbit-dialog-cancel" disabled={working} onClick={onClose}>Cancel</button>
        <button type="button" className="orbit-dialog-submit" disabled={working||!items.length}
          onClick={()=>onSave(items)}>{working?"Saving…":"Apply"}</button>
      </div>
    </section>
  </div>;
}
