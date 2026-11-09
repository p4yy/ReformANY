// Offline PDF.js renderer. Full-page PNG/JPG exports and layout DOCX share
// the same validated page render, without leaving stray temporary PNG files.
import {invoke} from "@tauri-apps/api/core";
import {GlobalWorkerOptions,getDocument} from "pdfjs-dist/legacy/build/pdf.mjs";
import localWorker from "pdfjs-dist/legacy/build/pdf.worker.min.mjs?url";
GlobalWorkerOptions.workerSrc=localWorker;

type PreviewResponse={kind:string;content:string};
function decode(base64:string):Uint8Array{
  const source=atob(base64);
  const data=new Uint8Array(source.length);
  for(let i=0;i<source.length;i++)data[i]=source.charCodeAt(i);
  return data;
}
async function renderPages(path:string,target:"png"|"jpg"):Promise<string[]>{
  const file=await invoke<PreviewResponse>("document_preview",{path});
  if(file.kind!=="pdf")throw Error("Choose a valid PDF");
  const loading=getDocument({data:decode(file.content),
    cMapUrl:"/pdfjs/cmaps/",standardFontDataUrl:"/pdfjs/standard_fonts/",
    wasmUrl:"/pdfjs/wasm/",cMapPacked:true,useSystemFonts:true,
  });
  const images:string[]=[];
  try{
    const pdf=await loading.promise;
    if(pdf.numPages<1||pdf.numPages>60)
      throw Error("Full-page PDF exports support 1–60 pages per job");
    let total=0;
    for(let index=1;index<=pdf.numPages;index++){
      const page=await pdf.getPage(index);
      const original=page.getViewport({scale:1});
      const scale=Math.min(2,Math.sqrt(18_000_000/Math.max(1,original.width*original.height)));
      const viewport=page.getViewport({scale});
      const canvas=document.createElement("canvas");
      canvas.width=Math.max(1,Math.ceil(viewport.width));
      canvas.height=Math.max(1,Math.ceil(viewport.height));
      const ctx=canvas.getContext("2d",{alpha:false});
      if(!ctx)throw Error("Windows WebView2 could not allocate a PDF render canvas");
      await page.render({canvas,canvasContext:ctx,viewport,background:"rgb(255,255,255)"}).promise;
      const url=canvas.toDataURL(target==="png"?"image/png":"image/jpeg",.92);
      const offset=url.indexOf("base64,");
      if(offset<0)throw Error("Page "+index+" failed image encoding");
      const encoded=url.slice(offset+7);
      if(encoded.length>24*1024*1024*4/3+16)
        throw Error("Page "+index+" exceeds the safe image limit");
      total+=encoded.length;
      if(total>128*1024*1024*4/3)
        throw Error("This document requires more than 128MB of page image memory");
      images.push(encoded);
      canvas.width=0;canvas.height=0;page.cleanup();
    }
    return images;
  }finally{await loading.destroy();}
}
export async function convertPdfToPageImages(path:string,target:"png"|"jpg",destination:string|null)
  :Promise<string[]>{
  const images=await renderPages(path,target);
  const paths=await invoke<string[]>("pdf_save_rendered_pages",{path,target,images,destination});
  if(paths.length!==images.length)throw Error("PDF page publisher returned an incomplete result");
  return paths;
}
export async function convertPdfToLayoutDocx(path:string,destination:string|null):Promise<string>{
  const images=await renderPages(path,"png");
  const output=await invoke<string>("pdf_docx_layout",{path,images,destination});
  if(!output)throw Error("PDF DOCX layout builder did not create an output");
  return output;
}
