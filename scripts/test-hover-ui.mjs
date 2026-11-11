// Windows CI regression test: a real, bundled ReformANY EXE must open HoveR
// with an image, render the React player, and load the explicitly scoped file.
// The debugging port is enabled only in the CI job via ephemeral WebView2 policy.
import { spawn, execFileSync } from "node:child_process";
import { PDFDocument } from "pdf-lib";
import { existsSync } from "node:fs";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join, dirname, delimiter } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

if (process.platform !== "win32") throw new Error("HoveR startup verification requires Windows");
const exe = resolve(process.argv[2] || "");
const picture = resolve(process.argv[3] || "");
const ffmpeg = resolve(process.argv[4] || "");
if (!exe.toLowerCase().endsWith(".exe") || !existsSync(exe) || !existsSync(picture) || !existsSync(ffmpeg)) {
  throw new Error("Pass the real ReformANY.exe followed by an existing test PNG");
}
const port = 19376;
const base = "http://127.0.0.1:" + port;
const temp = await mkdtemp(join(tmpdir(), "reformany-hover-smoke-"));
let child;
const sockets = [];
let cdpId = 0;
async function targets() {
  const r = await fetch(base + "/json/list", { signal: AbortSignal.timeout(1500) });
  if (!r.ok) throw new Error("CDP HTTP " + r.status);
  return r.json();
}
async function connect(target) {
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  sockets.push(socket);
  await Promise.race([
    new Promise((resolve, reject) => {
      socket.addEventListener("open", resolve, { once: true });
      socket.addEventListener("error", reject, { once: true });
    }),
    sleep(10000).then(() => { throw new Error("CDP socket connection timeout"); }),
  ]);
  return socket;
}
async function evaluate(socket, expression) {
  const id = ++cdpId;
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      socket.removeEventListener("message", handle);
      reject(new Error("CDP evaluation timed out: " + expression.slice(0, 90)));
    }, 7000);
    const handle = event => {
      let msg;
      try { msg = JSON.parse(String(event.data)); } catch { return; }
      if (msg.id !== id) return;
      clearTimeout(timeout);
      socket.removeEventListener("message", handle);
      if (msg.error || msg.result?.exceptionDetails) {
        reject(new Error("CDP execution failed " + JSON.stringify(msg).slice(0, 1000)));
      } else resolve(msg.result?.result?.value);
    };
    socket.addEventListener("message", handle);
    socket.send(JSON.stringify({
      id, method:"Runtime.evaluate",
      params:{ expression, returnByValue:true, awaitPromise:true },
    }));
  });
}
async function cdp(socket, method, params) {
  const id = ++cdpId;
  return new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>{socket.removeEventListener("message",listener);reject(Error(method+" timeout"))},8000);
    const listener=(event)=>{
      let value;try{value=JSON.parse(String(event.data))}catch{return}
      if(value.id!==id)return;
      clearTimeout(timer);socket.removeEventListener("message",listener);
      value.error?reject(Error(JSON.stringify(value.error))):resolve(value.result);
    };
    socket.addEventListener("message",listener);
    socket.send(JSON.stringify({id,method,params}));
  });
}
async function screenshot(socket, filename) {
  const id = ++cdpId;
  const result = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      socket.removeEventListener("message", handle);
      reject(new Error("Screenshot command timed out"));
    }, 7000);
    function handle(event) {
      let msg;
      try { msg = JSON.parse(String(event.data)); } catch { return; }
      if (msg.id !== id) return;
      clearTimeout(timeout);
      socket.removeEventListener("message", handle);
      if (msg.error) reject(new Error(JSON.stringify(msg.error)));
      else resolve(msg.result?.data);
    }
    socket.addEventListener("message", handle);
    socket.send(JSON.stringify({ id, method:"Page.captureScreenshot",
      params:{format:"png",captureBeyondViewport:false} }));
  });
  if (typeof result !== "string") throw new Error("CDP screenshot has no PNG bytes");
  const dir = join(process.cwd(), "test-screenshots");
  await mkdir(dir, { recursive:true });
  await writeFile(join(dir, filename), Buffer.from(result,"base64"));
}
try {
  const video = join(temp, "sample.mp4"), audio = join(temp, "sample.mp3"), mkv = join(temp, "sample.mkv");
  execFileSync(ffmpeg, ["-hide_banner","-loglevel","error","-y",
    "-f","lavfi","-i","testsrc2=size=160x90:rate=10",
    "-f","lavfi","-i","sine=frequency=440:sample_rate=44100",
    "-t","2","-c:v","libx264","-pix_fmt","yuv420p","-c:a","aac",video],
    {windowsHide:true,timeout:30000});
  execFileSync(ffmpeg, ["-hide_banner","-loglevel","error","-y","-i",video,
    "-map","0:a:0","-vn","-c:a","libmp3lame",audio],
    {windowsHide:true,timeout:30000});
  execFileSync(ffmpeg, ["-hide_banner","-loglevel","error","-y","-i",video,"-c","copy",mkv],
    {windowsHide:true,timeout:30000});
  child = spawn(exe, [], {
    windowsHide:false,
    stdio:"ignore",
    env:{
      ...process.env,
      PATH:dirname(ffmpeg)+delimiter+(process.env.PATH||""),
      WEBVIEW2_USER_DATA_FOLDER:join(temp,"webview"),
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS:
        "--remote-debugging-port=" + port + " --remote-allow-origins=*",
    },
  });
  let main, last = [];
  const deadline = Date.now() + 80000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error("ReformANY exited before HoveR test: " + child.exitCode);
    try {
      last = await targets();
      main = last.find(item => item.type === "page" &&
        (item.url.includes("tauri.localhost") || item.url.startsWith("tauri://")));
      if (main) break;
    } catch { /* WebView2 starting */ }
    await sleep(600);
  }
  if (!main) throw new Error("No bundled main WebView. Targets: " + JSON.stringify(last));
  const mainSocket = await connect(main);
  let ready = false;
  while (Date.now() < deadline) {
    ready = Boolean(await evaluate(mainSocket,
      'Boolean(window.__TAURI_INTERNALS__ && document.querySelector(".shell .titlebar .brand[aria-label=\\\"ReformANY\\\"]") && document.querySelector("#sidebar") && document.querySelector("#main"))'));
    if (ready) break;
    await sleep(650);
  }
  if (!ready) {
    // Get a useful browser error rather than hiding the true crash behind
    // "UI did not load". A second reload captures exceptions that occurred
    // before CDP attached to the first WebView.
    const exceptions=[];
    const monitor=event=>{
      try {
        const msg=JSON.parse(String(event.data));
        if(msg.method==="Runtime.exceptionThrown") exceptions.push(
          JSON.stringify(msg.params?.exceptionDetails).slice(0,1500));
        if(msg.method==="Log.entryAdded" && msg.params?.entry?.level==="error")
          exceptions.push(JSON.stringify(msg.params.entry).slice(0,1500));
      } catch { /* ignore devtools transport event */ }
    };
    mainSocket.addEventListener("message",monitor);
    const command=async(method,params={})=>{
      const id=++cdpId;
      return new Promise((resolve,reject)=>{
        const timeout=setTimeout(()=>{mainSocket.removeEventListener("message",handler);reject(new Error(method+" timed out"))},7000);
        const handler=event=>{let msg;try{msg=JSON.parse(String(event.data))}catch{return}
          if(msg.id!==id)return;clearTimeout(timeout);mainSocket.removeEventListener("message",handler);
          msg.error?reject(new Error(JSON.stringify(msg.error))):resolve(msg.result);
        };
        mainSocket.addEventListener("message",handler);
        mainSocket.send(JSON.stringify({id,method,params}));
      });
    };
    try {
      await command("Runtime.enable");
      await command("Log.enable");
      await command("Page.enable");
      await command("Page.reload",{ignoreCache:true});
      await sleep(3000);
    } catch(e) { exceptions.push("Diagnostic reload: "+String(e)); }
    let debug=null;
    try {debug=await evaluate(mainSocket,`(() => ({
      href:location.href,state:document.readyState,hasTauri:!!window.__TAURI_INTERNALS__,
      root:document.getElementById("root")?.outerHTML?.slice(0,2800),
      bodyText:document.body?.innerText?.slice(0,700),
      scripts:[...document.scripts].map(x=>x.src),
      shell:!!document.querySelector(".shell"),
      exceptions:[...window.__reformanyStartupErrors||[]]
    }))()`)}catch(e){exceptions.push("DOM query: "+String(e))}
    throw new Error("ZIP app failed to start. Browser errors: "+JSON.stringify(exceptions)+
      " DOM: "+JSON.stringify(debug));
  }
  // The supplied redesign replaces the original sidebar classes, welcome
  // wizard and settings selectors. Validate the ACTUAL new shell, not a ghost
  // selector from the earlier stable frontend.
  const layout = await evaluate(mainSocket, `(() => {
    const shell=document.querySelector(".shell");
    const body=document.querySelector(".body");
    const sidebar=document.querySelector("#sidebar");
    const main=document.querySelector("#main");
    const pages=document.querySelectorAll("#sidebar .nav button[aria-label]");
    const left=sidebar?.getBoundingClientRect(),right=main?.getBoundingClientRect();
    return {shell:!!shell,oldShell:!!document.querySelector(".app-shell"),
      sidebar:!!sidebar,width:left?.width||0,pages:pages.length,
      main:!!main,nonoverlap:!!left&&!!right&&left.right<=right.left+2,
      brand:!!document.querySelector(".titlebar .brand"),
      rail:body?.dataset.collapsed==="true",viewport:innerWidth};
  })()`);
  const isCompactLayout = layout.rail && Math.abs(layout.width-64)<=5;
  const isWideLayout = !layout.rail && layout.width>=180;
  if(!layout.shell||layout.oldShell||!layout.sidebar||!layout.main||!layout.brand||
     !(isCompactLayout||isWideLayout)||layout.pages<12||!layout.nonoverlap)
    throw Error("ZIP desktop navigation is missing, overlaps or kept old shell: "+JSON.stringify(layout));

  // P0 visual acceptance: check the *rendered* selected sage control and
  // wordmark text boxes instead of trusting class names or source CSS alone.
  const visualP0=await evaluate(mainSocket,`(() => {
    const brand=document.querySelector(".shell .titlebar .brand");
    const suffix=brand?.querySelector("b");
    const selected=document.querySelector('.page:not([hidden]) .chip[aria-checked="true"]');
    const range=document.createRange();
    if(brand?.firstChild?.nodeType===3)range.selectNodeContents(brand.firstChild);
    const word=brand?.firstChild?.nodeType===3?range.getBoundingClientRect():null;
    const any=suffix?.getBoundingClientRect();
    const style=selected?getComputedStyle(selected):null;
    const rgb=s=>(s.match(/[\\d.]+/g)||[]).slice(0,3).map(Number);
    const lum=s=>{const parts=rgb(s).map(v=>v/255).map(v=>v<=.04045?v/12.92:Math.pow((v+.055)/1.055,2.4));return .2126*parts[0]+.7152*parts[1]+.0722*parts[2];};
    const contrast=style?(Math.max(lum(style.color),lum(style.backgroundColor))+.05)/(Math.min(lum(style.color),lum(style.backgroundColor))+.05):0;
    return {wordmarkGap:word&&any?any.left-word.right:null,
      selected:!!selected,foreground:style?.color,background:style?.backgroundColor,
      contrast:Math.round(contrast*100)/100};
  })()`);
  if(visualP0.wordmarkGap===null||visualP0.wordmarkGap<-1||
     !visualP0.selected||visualP0.contrast<4.5)
    throw Error("ReformANY wordmark or active sage-chip readability regressed: "+JSON.stringify(visualP0));
  console.log("PASS: native header wordmark separated; selected format chip contrast "+
    visualP0.contrast+":1.");
  await screenshot(mainSocket,"01-images-workspace.png").catch(error=>console.warn("Images screenshot unavailable",String(error)));
  if(isWideLayout) {
    await evaluate(mainSocket,'document.querySelector("#sidebar button[aria-label=\\\"Collapse sidebar\\\"]").click();true');
    let collapsed=null;
    // Layout transitions and GPU rasterisation can take longer on a CI VM.
    // Await the actual final 64px geometry; never substitute state-only checks.
    for(let attempt=0;attempt<14;attempt++){
      await sleep(100);
      collapsed=await evaluate(mainSocket,`(() => ({
        rail:document.querySelector(".body")?.dataset.collapsed==="true",
        width:document.querySelector("#sidebar")?.getBoundingClientRect().width||0,
        computedTrack:getComputedStyle(document.querySelector(".body")).gridTemplateColumns,
        iconCount:document.querySelectorAll("#sidebar .nav button[aria-label] svg").length
      }))()`);
      if(collapsed.rail&&Math.abs(collapsed.width-64)<=5)break;
    }
    if(!collapsed.rail||Math.abs(collapsed.width-64)>5||collapsed.iconCount<12)
      throw Error("ZIP sidebar collapse failed: "+JSON.stringify(collapsed));
    await evaluate(mainSocket,'document.querySelector("#sidebar button[aria-label=\\\"Expand sidebar\\\"]").click();true');
    await sleep(350);
  } else {
    const narrow=await evaluate(mainSocket,`(() => ({
      rail:document.querySelector(".body")?.dataset.collapsed==="true",
      iconCount:document.querySelectorAll("#sidebar .nav button[aria-label] svg").length,
      available:document.querySelector("#main")?.getBoundingClientRect().width||0
    }))()`);
    if(!narrow.rail||narrow.iconCount<12||narrow.available<250)
      throw Error("ZIP auto-compact navigation failed: "+JSON.stringify(narrow));
  }
  console.log("PASS: full ZIP UI replaces original shell, responsive navigation verified.");
  await evaluate(mainSocket,'document.querySelector("#sidebar button[aria-label=\\\"Guide\\\"]").click();true');
  await sleep(300);
  const guide=await evaluate(mainSocket,`(() => ({
    active:!!document.querySelector('#sidebar button[aria-label="Guide"][aria-current="page"]'),
    content:document.querySelector(".page:not([hidden]) .page-inner")?.textContent?.length||0
  }))()`);
  if(!guide.active||guide.content<150)throw Error("ZIP Guide did not render: "+JSON.stringify(guide));
  await screenshot(mainSocket,"02-guide.png").catch(error=>console.warn("Guide screenshot unavailable",String(error)));
  await evaluate(mainSocket,'document.querySelector("#sidebar button[aria-label=\\\"Audio & Video\\\"]").click();true');
  await sleep(300);
  const media=await evaluate(mainSocket,`(() => ({
    active:!!document.querySelector('#sidebar button[aria-label="Audio & Video"][aria-current="page"]'),
    content:document.querySelector(".page:not([hidden]) .page-inner")?.textContent?.length||0
  }))()`);
  if(!media.active||media.content<120)throw Error("ZIP media converter did not render: "+JSON.stringify(media));
  await screenshot(mainSocket,"03-audio-video.png").catch(error=>console.warn("Media screenshot unavailable",String(error)));
  await evaluate(mainSocket,'document.querySelector("#sidebar button[aria-label=\\\"Settings\\\"]").click();true');
  await sleep(300);
  const audioUI=await evaluate(mainSocket,`(() => {
    const content=document.querySelector(".page:not([hidden]) .page-inner")?.textContent||"";
    return {sound:content.includes("Play sounds"),volume:content.includes("Volume"),
      shake:content.includes("Hold and shake to open Orbit"),shortcut:content.includes("Section shortcuts")};
  })()`);
  if(!audioUI.sound||!audioUI.volume||!audioUI.shake||!audioUI.shortcut)
    throw Error("ZIP Orbit audio/Shake controls missing: "+JSON.stringify(audioUI));

  // P0: native dropdowns must not inherit the legacy .field flex-column
  // wrapper, which vertically displaced chevrons and their text.
  const selectGeometry=await evaluate(mainSocket,`(() => {
    const list=[...document.querySelectorAll('.page:not([hidden]) select.field')]
      .filter(el=>el.getBoundingClientRect().width>10);
    return {count:list.length,controls:list.map(el=>({
      label:el.getAttribute("aria-label")||el.value,
      height:Math.round(el.getBoundingClientRect().height*10)/10,
      display:getComputedStyle(el).display,
      align:getComputedStyle(el).alignItems,
      lineHeight:getComputedStyle(el).lineHeight,
      marginBottom:getComputedStyle(el).marginBottom
    })).slice(0,12)};
  })()`);
  if(selectGeometry.count<2||selectGeometry.controls.some(x=>
       x.height<28||x.height>42||x.align!=="center"||x.marginBottom!=="0px"))
    throw Error("Settings selects are clipped/misaligned by legacy field rules: "+JSON.stringify(selectGeometry));
  console.log("PASS: native Settings select alignment and intrinsic heights verified.");
  const audioBridge=await evaluate(mainSocket,`(async()=>({
    cue:await window.__TAURI_INTERNALS__.invoke("orbit_play_sound",{kind:"hover"}).then(()=>true,()=>false),
    shake:await window.__TAURI_INTERNALS__.invoke("get_shake_settings").then(v=>v&&v.sensitivity>=1&&v.sensitivity<=5,false)
  }))()`);
  if(!audioBridge.cue||!audioBridge.shake)throw Error("Native sound/Shake integration failed: "+JSON.stringify(audioBridge));
  await screenshot(mainSocket,"03a-orbit-audio-preferences.png").catch(error=>console.warn("Appearance screenshot unavailable",String(error)));
  // Launch the real Explorer-route Orbit in a separate process. The native
  // window must show a circular wheel only, no preview File Explorer rectangle.
  await evaluate(mainSocket,'window.__TAURI_INTERNALS__.invoke("orbit_launch_file",{path:'+
    JSON.stringify(picture)+'})');
  let orbitTarget=null;
  for(let attempt=0;attempt<65;attempt++){
    const list=await targets().catch(()=>[]);
    orbitTarget=list.find(page=>page.type==="page"&&page.id!==main.id&&
      (page.url.includes("tauri.localhost")||page.url.startsWith("tauri://")));
    if(orbitTarget)break;
    await sleep(220);
  }
  if(!orbitTarget)throw Error("Native Explorer-file Orbit did not launch.");
  const orbitSocket=await connect(orbitTarget);
  let wheel;
  for(let attempt=0;attempt<45;attempt++){
    wheel=await evaluate(orbitSocket,`(() => {
      const disc=document.querySelector(".orbit-disc");
      const bar=document.querySelector(".orbit-bar");
      const root=document.querySelector(".orbit-root");
      const box=bar?.getBoundingClientRect();
      return {
        zip:!!document.querySelector(".orbit-stage")&&!document.querySelector(".orbit-os.native"),
        disc:!!disc,width:disc?.getBoundingClientRect().width||0,
        sectors:document.querySelectorAll(".orbit-wedge[role=button]").length,
        source:root?.getAttribute("aria-label")||"",
        rootTransparent:getComputedStyle(document.body).backgroundColor==="rgba(0, 0, 0, 0)",
        actionsVisible:!!bar&&getComputedStyle(bar).display!=="none",
        actionButtons:bar?.querySelectorAll("button[role=radio]").length||0,
        actionsInsideViewport:!!box&&box.left>=0&&box.right<=innerWidth&&box.bottom<=innerHeight,
      };
    })()`);
    if(wheel.zip&&wheel.disc&&wheel.sectors>=4&&wheel.source.includes("icon"))break;
    await sleep(230);
  }
  if(!wheel.zip||!wheel.disc||wheel.sectors<4||!wheel.source.includes("icon")||
    !wheel.rootTransparent||wheel.width<345||wheel.width>510||
    !wheel.actionsVisible||wheel.actionButtons!==3||!wheel.actionsInsideViewport)
    throw Error("ZIP-native Orbit is not a clean source-aware floating circle: "+JSON.stringify(wheel));

  const centeredHub=await evaluate(orbitSocket,`(() => {
    const disc=document.querySelector(".orbit-root .orbit-disc");
    const hub=document.querySelector(".orbit-root .orbit-disc svg.orbit-svg .hub-bg");
    const d=disc?.getBoundingClientRect(), h=hub?.getBoundingClientRect();
    return {disc:!!d,hub:!!h,centerDx:d&&h?Math.round((h.left+h.width/2)-(d.left+d.width/2)):null,
      centerDy:d&&h?Math.round((h.top+h.height/2)-(d.top+d.height/2)):null,
      hubPos:hub?.parentElement?getComputedStyle(hub.parentElement).position:null};
  })()`);
  if(!centeredHub.disc||!centeredHub.hub||
     Math.abs(centeredHub.centerDx)>6||Math.abs(centeredHub.centerDy)>6)
    throw Error("SVG Orbit center is detached from the radial wheel: "+JSON.stringify(centeredHub));
  console.log("PASS: native Orbit SVG hub centered within 6px of disc.");
  await screenshot(orbitSocket,"04-circular-orbit.png").catch(error=>console.warn("Orbit screenshot unavailable",String(error)));
  // Orbit tools run in their own opaque Tauri windows, not a transparent
  // backing WebView that renders a ghost rectangle around the panel.
  await evaluate(orbitSocket,'window.__TAURI_INTERNALS__.invoke("orbit_open_panel",{kind:"rename"})');
  let panelTarget=null;
  for(let attempt=0;attempt<55;attempt++){
    const list=await targets().catch(()=>[]);
    panelTarget=list.find(item=>item.type==="page"&&item.id!==main.id&&item.id!==orbitTarget.id&&
      (item.url.includes("tauri.localhost")||item.url.startsWith("tauri://")));
    if(panelTarget)break;
    await sleep(200);
  }
  if(!panelTarget)throw Error("Orbit rename tool did not open an independent WebView.");
  const panelSocket=await connect(panelTarget);
  let panelState;
  for(let attempt=0;attempt<35;attempt++){
    panelState=await evaluate(panelSocket,`(() => ({
      native:document.documentElement.classList.contains("reformany-panel-window"),
      count:document.querySelectorAll(".orbit-dialog[role=dialog]").length,
      title:document.querySelector(".orbit-dialog h2")?.textContent||"",
      draggable:!!document.querySelector(".orbit-dialog-titlebar"),
      fullscreen:!!document.querySelector('button[aria-label="Fullscreen"]'),
      backdrop:getComputedStyle(document.querySelector(".orbit-dialog-backdrop")||document.body).backgroundColor,
      panelBackground:getComputedStyle(document.querySelector(".orbit-dialog")||document.body).backgroundColor,
      shadow:getComputedStyle(document.querySelector(".orbit-dialog")||document.body).boxShadow
    }))()`);
    if(panelState.native&&panelState.count===1&&panelState.title==="Rename")break;
    await sleep(150);
  }
  if(!panelState.native||panelState.count!==1||panelState.title!=="Rename"||
      !panelState.draggable||!panelState.fullscreen||
      panelState.backdrop!=="rgb(26, 30, 21)"||
      panelState.panelBackground!=="rgb(26, 30, 21)"||
      panelState.shadow!=="none")
    throw Error("Orbit tool has a duplicate backdrop, missing drag handle or is not a separate panel: "+JSON.stringify(panelState));
  await screenshot(panelSocket,"05-independent-orbit-panel.png").catch(error=>console.warn("Orbit panel screenshot unavailable",String(error)));
  await evaluate(panelSocket,'document.querySelector("button[aria-label=\\\"Close\\\"]").click();true');
  let panelClosed=false;
  for(let attempt=0;attempt<40;attempt++){
    await sleep(160);
    if(!(await targets().catch(()=>[])).some(item=>item.id===panelTarget.id)){panelClosed=true;break;}
  }
  if(!panelClosed)throw Error("Closing an Orbit tool left an invisible secondary native window.");
  // Real Windows acceptance: open a full 269-page PDF in an actual native
  // Orbit Arrange window and physically scroll with CDP input events.
  const pdfPath=join(temp,"reformany-scroll-269.pdf");
  const pdf=await PDFDocument.create();
  for(let n=1;n<=269;n++){
    const p=pdf.addPage([300,420]);
    if(n===1||n===269)p.drawText("ReformANY page "+n,{x:25,y:380,size:18});
  }
  await writeFile(pdfPath,await pdf.save());
  await evaluate(orbitSocket,'window.__TAURI_INTERNALS__.invoke("orbit_set_context",{path:'+JSON.stringify(pdfPath)+'})');
  await evaluate(orbitSocket,'window.__TAURI_INTERNALS__.invoke("orbit_open_panel",{kind:"arrange"})');
  let arrangeTarget=null;
  for(let i=0;i<65;i++){
    arrangeTarget=(await targets().catch(()=>[])).find(t=>t.type==="page"&&
      t.id!==main.id&&t.id!==orbitTarget.id&&
      (t.url.includes("tauri.localhost")||t.url.startsWith("tauri://")));
    if(arrangeTarget)break;
    await sleep(300);
  }
  if(!arrangeTarget)throw Error("Arrange PDF native window never opened");
  const arrangeSocket=await connect(arrangeTarget);
  const state=()=>evaluate(arrangeSocket,`(()=>{
    const s=document.querySelector(".orbit-dialog-scroll-region");
    const rail=document.querySelector(".orbit-panel-scroll-track");
    const thumb=document.querySelector(".orbit-panel-scroll-thumb");
    const footer=document.querySelector(".orbit-dialog-footer");
    const rect=e=>{const r=e?.getBoundingClientRect();return r&&{x:r.x,y:r.y,width:r.width,height:r.height,bottom:r.bottom}};
    return {pages:document.querySelectorAll(".arrange-page").length,
      top:s?.scrollTop||0,total:s?.scrollHeight||0,client:s?.clientHeight||0,
      rect:rect(s),track:rect(rail),thumb:rect(thumb),
      footerVisible:!!footer&&rect(footer).bottom<=innerHeight+2};
  })()`);
  let initial=null;
  for(let i=0;i<85;i++){
    initial=await state();
    if(initial.pages===269&&initial.total>initial.client+1500&&initial.track&&initial.thumb)break;
    await sleep(260);
  }
  if(!initial||initial.pages!==269||initial.total<=initial.client+1500||
     !initial.track||!initial.thumb||!initial.footerVisible)
    throw Error("No working scroll geometry for 269-page Arrange PDF: "+JSON.stringify(initial));
  await cdp(arrangeSocket,"Input.dispatchMouseEvent",{
    type:"mouseWheel",x:Math.round(initial.rect.x+140),
    y:Math.round(initial.rect.y+140),deltaX:0,deltaY:550});
  await sleep(350);
  const wheeled=await state();
  if(wheeled.top<100)throw Error("Mouse wheel did not scroll Orbit: "+JSON.stringify({initial,wheeled}));
  const x=Math.round(initial.track.x+initial.track.width/2);
  const y=Math.round(initial.track.y+initial.track.height*.7);
  await cdp(arrangeSocket,"Input.dispatchMouseEvent",{
    type:"mousePressed",x,y,button:"left",clickCount:1});
  await cdp(arrangeSocket,"Input.dispatchMouseEvent",{
    type:"mouseReleased",x,y,button:"left",clickCount:1});
  await sleep(350);
  const clicked=await state();
  if(clicked.top<wheeled.top+100)throw Error("Right-edge track click did not scroll Orbit: "+JSON.stringify({wheeled,clicked}));
  const tx=Math.round(clicked.thumb.x+clicked.thumb.width/2);
  const ty=Math.round(clicked.thumb.y+clicked.thumb.height/2);
  const dest=Math.min(Math.round(initial.track.y+initial.track.height-24),ty+85);
  await cdp(arrangeSocket,"Input.dispatchMouseEvent",{type:"mousePressed",x:tx,y:ty,button:"left",clickCount:1});
  await cdp(arrangeSocket,"Input.dispatchMouseEvent",{type:"mouseMoved",x:tx,y:dest,button:"left",buttons:1});
  await cdp(arrangeSocket,"Input.dispatchMouseEvent",{type:"mouseReleased",x:tx,y:dest,button:"left",clickCount:1});
  await sleep(350);
  const dragged=await state();
  if(dragged.top<clicked.top+100)throw Error("Thumb drag did not scroll Orbit: "+JSON.stringify({clicked,dragged}));
  const final=await evaluate(arrangeSocket,`(()=>{
    const pane=document.querySelector(".orbit-dialog-scroll-region");
    pane.scrollTop=pane.scrollHeight;
    const last=document.querySelector(".arrange-page:last-child").getBoundingClientRect();
    const box=pane.getBoundingClientRect();
    return {atEnd:Math.abs(pane.scrollTop+pane.clientHeight-pane.scrollHeight)<4,
      lastVisible:last.bottom<=box.bottom+4&&last.bottom>=box.top};
  })()`);
  if(!final.atEnd||!final.lastVisible)throw Error("Page 269 remains unreachable: "+JSON.stringify(final));
  await screenshot(arrangeSocket,"05b-arrange-last-page.png").catch(()=>{});
  console.log("PASS: 269-page native Orbit scrollbar moves with mouse wheel, click and thumb drag.");
  await evaluate(arrangeSocket,'document.querySelector("button[aria-label="Close"]")?.click();true');
  await evaluate(orbitSocket,'window.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true}));true');
  let closed=false;
  for(let attempt=0;attempt<40;attempt++){
    await sleep(180);
    const list=await targets().catch(()=>[]);
    if(!list.some(x=>x.id===orbitTarget.id)){closed=true;break;}
  }
  if(!closed)throw Error("Native Orbit did not close on Escape.");
  console.log("PASS: redesigned navigation, native preferences, circular Orbit and keyboard dismissal.");
  const promise = 'window.__TAURI_INTERNALS__.invoke("hover_file", { path:' + JSON.stringify(picture) + '})';
  await evaluate(mainSocket, promise);
  let hover;
  while (Date.now() < deadline) {
    last = await targets().catch(() => []);
    hover = last.find(item => item.type === "page" && item.id !== main.id &&
      (item.url.includes("tauri.localhost") || item.url.startsWith("tauri://")));
    if (hover) break;
    await sleep(500);
  }
  if (!hover) throw new Error("HoveR did not navigate to bundled UI: " + JSON.stringify(last));
  let socket = await connect(hover);
  let result;
  while (Date.now() < deadline) {
    result = await evaluate(socket, `(() => ({
      text:document.body?.innerText?.slice(0,300) || "",
      mediaLoaded:Boolean(document.querySelector(".hover-preview img[alt='Selected image preview']")?.naturalWidth),
      mode:document.querySelector(".hover-shell")?"hover":"missing"
    }))()`);
    if (result?.mode === "hover" && result.text.includes("ReformANY HoveR") && result.mediaLoaded) break;
    await sleep(650);
  }
  if (result?.mode !== "hover" || !result.text.includes("ReformANY HoveR") || !result.mediaLoaded) {
    throw new Error("HoveR failed to render an actual image player: " + JSON.stringify(result));
  }
  // Pin is not decorative: it must change actual Tauri topmost state.
  let pinned = await evaluate(socket,
    'Boolean(document.querySelector(".hover-topbar button[aria-label=\\\"Unpin HoveR\\\"]"))');
  if (!pinned) throw new Error("HoveR did not start in pinned state");
  await evaluate(socket,
    'document.querySelector(".hover-topbar button[aria-label=\\\"Unpin HoveR\\\"]").click(); true');
  let unpinned = false;
  for (let attempt = 0; attempt < 25; attempt++) {
    unpinned = await evaluate(socket,
      'Boolean(document.querySelector(".hover-topbar button[aria-label=\\\"Keep HoveR on top\\\"][aria-pressed=\\\"false\\\"]"))');
    if (unpinned) break;
    await sleep(220);
  }
  if (!unpinned) throw new Error("HoveR pin button did not update native always-on-top state");
  await evaluate(socket,
    'document.querySelector(".hover-topbar button[aria-label=\\\"Keep HoveR on top\\\"]").click(); true');

  // QR must render its actual offline SVG without covering helper text.
  await evaluate(socket,
    'document.querySelectorAll(".hover-tabs button")[1].click(); true');
  let qrReady = false;
  for (let attempt = 0; attempt < 30; attempt++) {
    qrReady = await evaluate(socket, 'Boolean(document.querySelector(".hover-qr-actions button"))');
    if (qrReady) break;
    await sleep(150);
  }
  if (!qrReady) throw new Error("HoveR QR tab did not render");
  await evaluate(socket,
    'document.querySelector(".hover-qr-actions button").click(); true');
  let qrStatus;
  for (let attempt = 0; attempt < 35; attempt++) {
    qrStatus = await evaluate(socket, `(() => {
      const image = document.querySelector(".hover-qr-image img");
      const hint = document.querySelector(".hover-qr-content small");
      if (!image || !hint) return null;
      const a = image.getBoundingClientRect(), b = hint.getBoundingClientRect();
      return { hasImage: image.complete && image.naturalWidth > 0, overlap: a.bottom > b.top + 1,
        error: document.querySelector(".hover-error")?.innerText || "" };
    })()`);
    if (qrStatus?.hasImage) break;
    await sleep(220);
  }
  if (!qrStatus?.hasImage || qrStatus.overlap || qrStatus.error) {
    throw new Error("HoveR QR image did not render cleanly: " + JSON.stringify(qrStatus));
  }
  // Verify the actual installed Windows media stack, not just presence
  // of <video>/<audio> tags. HTMLMediaElement must load metadata and advance.
  async function checkMedia(path, kind) {
    await evaluate(mainSocket,
      'window.__TAURI_INTERNALS__.invoke("hover_file", {path:' + JSON.stringify(path) + '})');
    // HoveR is intentionally one reusable WebView. A second native window
    // risks "webview with label hover already exists" during async close.
    // Its React view must replace the previously selected media in place.
    // WebView2 may suspend an existing debugger socket briefly when HoveR
    // replaces an image/QR with its first hardware-decoded audio/video stream.
    // Reconnect ONCE on a CDP transport timeout, but do not skip actual media
    // readiness or playback checks. A hung renderer still fails on the retry.
    let mediaSocket = socket;
    let retriedCdp = false;
    let state = null;
    for (let attempt = 0; attempt < 45; attempt++) {
      try {
        state = await evaluate(mediaSocket, `(() => {
          const element=document.querySelector("${kind}");
          return {present:!!element,ready:element?.readyState||0,
            duration:element?.duration||0,error:element?.error?.message||null};
        })()`);
      } catch (error) {
        if (retriedCdp || !String(error).includes("CDP evaluation timed out")) throw error;
        const live = (await targets()).find(target => target.id === hover.id);
        if (!live) throw new Error("HoveR closed or changed WebView while loading "+kind);
        retriedCdp = true;
        console.warn("WebView2 debugger timed out during "+kind+" startup; reconnecting once.");
        mediaSocket = await connect(live);
        socket = mediaSocket;
        continue;
      }
      if (state?.ready>=2 || state?.error) break;
      await sleep(350);
    }
    if (!state?.present || state.ready<2 || !(state.duration>0) || state.error) {
      throw new Error("HoveR failed real "+kind+" decoding: "+JSON.stringify(state));
    }
    const playState=await evaluate(mediaSocket, `(async () => {
      const element=document.querySelector("${kind}");
      element.muted=true;
      try {await element.play();} catch(e){return {error:String(e)};}
      return {playing:!element.paused,ready:element.readyState};
    })()`);
    if (!playState?.playing) throw new Error("HoveR "+kind+" did not start playback: "+JSON.stringify(playState));
    await sleep(650);
    const position=await evaluate(mediaSocket,
      `document.querySelector("${kind}")?.currentTime||0`);
    if (!(position>0)) throw new Error("HoveR "+kind+" never advanced playback time");
    await evaluate(mediaSocket,`document.querySelector("${kind}").pause()`);
    const all = await targets();
    const liveHoveRs = all.filter(target => target.type==="page" && target.id!==main.id &&
      (target.url.includes("tauri.localhost") || target.url.startsWith("tauri://")));
    if (liveHoveRs.length !== 1 || liveHoveRs[0].id !== hover.id) {
      throw new Error("HoveR should reuse exactly one WebView: " + JSON.stringify(liveHoveRs));
    }
  }
  await checkMedia(audio,"audio");
  await checkMedia(video,"video");
  // WebView2 does not play every desktop codec/container. Verify the real
  // bundled FFmpeg can decode an MKV first frame into HoveR's still preview.
  await evaluate(mainSocket,
    'window.__TAURI_INTERNALS__.invoke("hover_file",{path:' + JSON.stringify(mkv) + '})');
  let mkvReady=false;
  for(let attempt=0;attempt<50;attempt++){
    const preview=await evaluate(socket,`(() => ({
      found:!!document.querySelector('img[alt="Decoded video frame preview"]'),
      width:document.querySelector('img[alt="Decoded video frame preview"]')?.naturalWidth||0,
      message:document.querySelector('.hover-note')?.textContent||''
    }))()`);
    if(preview.found&&preview.width>0){mkvReady=true;break;}
    await sleep(270);
  }
  if(!mkvReady) throw Error("MKV image preview did not decode using the bundled FFmpeg engine.");
  console.log("PASS: real MKV thumbnail decoded in HoveR using FFmpeg.");
  // Regression: users reported that the custom X did nothing. This must
  // destroy the native WebView, not merely hide React content.
  await evaluate(socket,
    'document.querySelector("button[aria-label=\\\"Close hovering preview\\\"]").click(); true');
  let hoverClosed = false;
  for (let attempt = 0; attempt < 35; attempt++) {
    await sleep(180);
    const live = await targets().catch(() => []);
    hoverClosed = !live.some(target => target.id === hover.id);
    if (hoverClosed) break;
  }
  if (!hoverClosed) throw new Error("HoveR close button left the native preview window running");
  await evaluate(mainSocket,
    'window.__TAURI_INTERNALS__.invoke("hover_file", {path:' + JSON.stringify(picture) + '})');
  let reopened = null;
  for (let attempt = 0; attempt < 50; attempt++) {
    const live = await targets().catch(() => []);
    reopened = live.find(target => target.type==="page" && target.id!==main.id &&
      (target.url.includes("tauri.localhost") || target.url.startsWith("tauri://")));
    if (reopened && reopened.id !== hover.id) break;
    await sleep(180);
  }
  if (!reopened || reopened.id === hover.id) {
    throw new Error("HoveR could not reopen after its X button destroyed the original window");
  }
  const reopenedSocket = await connect(reopened);
  let imageRendered = false;
  for (let attempt=0; attempt<25; attempt++) {
    imageRendered = Boolean(await evaluate(reopenedSocket,
      'document.querySelector(".hover-preview img")?.naturalWidth > 0'));
    if (imageRendered) break;
    await sleep(200);
  }
  if (!imageRendered) throw new Error("Reopened HoveR did not display its selected picture");
  console.log("PASS: offline HoveR image/MP3/MP4 playback, native pin, QR, close X and reopen.");
} finally {
  for (const socket of sockets) try { socket.close(); } catch {}
  if (child?.pid) {
    const killer = spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], { windowsHide:true, stdio:"ignore" });
    await Promise.race([new Promise(done => killer.once("exit", done)), sleep(3000)]);
  }
  await rm(temp, {force:true,recursive:true,maxRetries:5,retryDelay:300}).catch(()=>{});
}
