// Real offline PDF page rendering, not extraction of embedded XObject images.
// The PDF.js worker and all font/wasm assets ship inside the ReformANY EXE.
import { invoke } from "@tauri-apps/api/core";
import { GlobalWorkerOptions, getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import localWorker from "pdfjs-dist/legacy/build/pdf.worker.min.mjs?url";

GlobalWorkerOptions.workerSrc = localWorker;
type PreviewResponse = {kind:string;content:string};

function bytesFromBase64(value:string):Uint8Array {
  const raw=atob(value);
  const bytes=new Uint8Array(raw.length);
  for(let i=0;i<raw.length;i++)bytes[i]=raw.charCodeAt(i);
  return bytes;
}
export async function convertPdfToPageImages(path:string,target:"png"|"jpg",destination:string|null)
  :Promise<string[]>
{
  const preview=await invoke<PreviewResponse>("document_preview",{path});
  if(preview.kind!=="pdf")throw new Error("Page rendering requires a PDF document");
  const loader=getDocument({
    data:bytesFromBase64(preview.content),
    cMapUrl:"/pdfjs/cmaps/",standardFontDataUrl:"/pdfjs/standard_fonts/",
    wasmUrl:"/pdfjs/wasm/",cMapPacked:true,useSystemFonts:true,
  });
  const encoded:string[]=[];
  try {
    const pdf=await loader.promise;
    if(pdf.numPages<1||pdf.numPages>60){
      throw new Error("PDF page-image export currently supports 1–60 pages per job");
    }
    for(let pageIndex=1;pageIndex<=pdf.numPages;pageIndex++){
      const page=await pdf.getPage(pageIndex);
      const natural=page.getViewport({scale:1});
      // 144 DPI nominally; bound peak canvas pixels for large-format pages.
      const maximum=18_000_000;
      const scale=Math.min(2,Math.sqrt(maximum/Math.max(1,natural.width*natural.height)));
      const viewport=page.getViewport({scale});
      const canvas=document.createElement("canvas");
      canvas.width=Math.floor(viewport.width);
      canvas.height=Math.floor(viewport.height);
      const context=canvas.getContext("2d",{alpha:false});
      if(!context)throw new Error("Windows WebView2 cannot allocate a PDF render canvas");
      await page.render({canvas,canvasContext:context,viewport,background:"rgb(255,255,255)"}).promise;
      const dataUrl=canvas.toDataURL(target==="png"?"image/png":"image/jpeg",.92);
      const marker="base64,";
      const offset=dataUrl.indexOf(marker);
      if(offset<0)throw new Error("PDF page "+pageIndex+" failed image encoding");
      const image=dataUrl.slice(offset+marker.length);
      if(image.length>24*1024*1024*4/3+16)
        throw new Error("PDF page "+pageIndex+" is too large to save");
      encoded.push(image);
      canvas.width=1;canvas.height=1;page.cleanup();
    }
    const files=await invoke<string[]>("pdf_save_rendered_pages",{path,target,images:encoded,destination});
    if(files.length!==pdf.numPages)throw new Error("PDF publisher returned an incomplete page set");
    return files;
  } finally {
    await loader.destroy();
  }
}
