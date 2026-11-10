// Windows CI regression test: a real, bundled ReformANY EXE must open HoveR
// with an image, render the React player, and load the explicitly scoped file.
// The debugging port is enabled only in the CI job via ephemeral WebView2 policy.
import { spawn, execFileSync } from "node:child_process";
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
      'Boolean(window.__TAURI_INTERNALS__ && document.body && document.body.innerText.includes("ReformANY"))'));
    if (ready) break;
    await sleep(650);
  }
  if (!ready) throw new Error("Main app did not load its bundled UI");
  // The supplied redesign replaces the original sidebar classes, welcome
  // wizard and settings selectors. Validate the ACTUAL new shell, not a ghost
  // selector from the earlier stable frontend.
  const layout = await evaluate(mainSocket, `(() => {
    const shell=document.querySelector(".app-shell");
    const sidebar=document.querySelector(".sidebar");
    const main=document.querySelector(".app-main");
    const pages=document.querySelectorAll(".sidebar-nav button[data-module]");
    const left=sidebar?.getBoundingClientRect();
    const right=main?.getBoundingClientRect();
    return {shell:!!shell,sidebar:!!sidebar,width:left?.width||0,
      pages:pages.length,main:!!main,nonoverlap:!!left&&!!right&&left.right<=right.left+2,
      brand:!!document.querySelector(".brand-symbol img"),
      rail:!!shell?.classList.contains("rail"),viewport:innerWidth};
  })()`);
  const isCompactLayout = layout.rail && Math.abs(layout.width - 64) <= 5;
  const isWideLayout = !layout.rail && layout.width >= 180;
  if (!layout.shell || !layout.sidebar || !layout.main || !layout.brand ||
      !(isCompactLayout || isWideLayout) || layout.pages < 12 || !layout.nonoverlap) {
    throw Error("Redesigned desktop navigation is missing or overlaps content: "+JSON.stringify(layout));
  }
  await screenshot(mainSocket,"01-images-workspace.png").catch(error=>console.warn("Images screenshot unavailable",String(error)));
  // Auto-compact at narrow available screen widths is intentional and should
  // not be rejected as a bug. On a wide viewport, assert manual collapse and
  // re-expansion too; the narrow layout must remain non-overlapping.
  if (isWideLayout) {
    await evaluate(mainSocket,'document.querySelector("button[aria-label=\\\"Collapse sidebar\\\"]").click();true');
    await sleep(280);
    const collapsed = await evaluate(mainSocket, `(() => ({
      rail:document.querySelector(".app-shell")?.classList.contains("rail"),
      width:document.querySelector(".sidebar")?.getBoundingClientRect().width||0,
      iconCount:document.querySelectorAll(".sidebar-nav button[data-module] svg").length
    }))()`);
    if (!collapsed.rail || Math.abs(collapsed.width-64)>5 || collapsed.iconCount<12)
      throw Error("Redesigned compact navigation failed: "+JSON.stringify(collapsed));
    await evaluate(mainSocket,'document.querySelector("button[aria-label=\\\"Expand sidebar\\\"]").click();true');
    await sleep(280);
  } else {
    const narrow = await evaluate(mainSocket, `(() => ({
      rail:document.querySelector(".app-shell")?.classList.contains("rail"),
      iconCount:document.querySelectorAll(".sidebar-nav button[data-module] svg").length,
      available:document.querySelector(".app-main")?.getBoundingClientRect().width||0
    }))()`);
    if (!narrow.rail || narrow.iconCount<12 || narrow.available<250)
      throw Error("Auto-compact navigation failed usability check: "+JSON.stringify(narrow));
  }
  console.log("PASS: responsive sidebar in "+(isCompactLayout?"compact":"expanded")+" desktop mode.");
  await evaluate(mainSocket,'document.querySelector("button[data-module=\\\"guide\\\"]").click();true');
  await sleep(250);
  const guide = await evaluate(mainSocket,`(() => ({
    active:!!document.querySelector('button[data-module="guide"].active'),
    content:document.querySelector(".content-inner")?.textContent?.length||0
  }))()`);
  if (!guide.active || guide.content<150) throw Error("Redesigned guide did not render: "+JSON.stringify(guide));
  await screenshot(mainSocket,"02-guide.png").catch(error=>console.warn("Guide screenshot unavailable",String(error)));
  await evaluate(mainSocket,'document.querySelector("button[data-module=\\\"media\\\"]").click();true');
  await sleep(240);
  const media=await evaluate(mainSocket,`(() => ({
    active:!!document.querySelector('button[data-module="media"].active'),
    content:document.querySelector(".content-inner")?.textContent?.length||0
  }))()`);
  if(!media.active||media.content<120)throw Error("Native media converter workspace not rendered: "+JSON.stringify(media));
  await screenshot(mainSocket,"03-audio-video.png").catch(error=>console.warn("Media screenshot unavailable",String(error)));
  await evaluate(mainSocket,'document.querySelector("button[data-module=\\\"appearance\\\"]").click();true');
  await sleep(240);
  const audioUI=await evaluate(mainSocket,`(() => {
    const content=document.querySelector(".content-inner")?.textContent||"";
    return {open:content.includes("Opening sound"),close:content.includes("Closing sound"),
      hover:content.includes("Wedge hover sound"),shake:content.includes("Hold-and-shake")};
  })()`);
  if(!audioUI.open||!audioUI.close||!audioUI.hover||!audioUI.shake)
    throw Error("Native Orbit audio/Shake controls missing: "+JSON.stringify(audioUI));
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
      const demo=document.querySelector(".explorer-mock");
      return {native:!!document.querySelector(".orbit-os.native"),disc:!!disc,
        width:disc?.getBoundingClientRect().width||0,
        sectors:document.querySelectorAll(".orbit-wedge[role=button]").length,
        source:document.querySelector(".orbit-hub strong")?.textContent||"",
        demoHidden:!demo||getComputedStyle(demo).display==="none",
        rootTransparent:getComputedStyle(document.body).backgroundColor==="rgba(0, 0, 0, 0)"};
    })()`);
    if(wheel.native&&wheel.disc&&wheel.sectors>=4&&wheel.source.includes("icon"))break;
    await sleep(230);
  }
  if(!wheel.native||!wheel.disc||wheel.sectors<4||!wheel.source.includes("icon")||
    !wheel.demoHidden||!wheel.rootTransparent||Math.abs(wheel.width-520)>8)
    throw Error("Native Orbit is not a clean source-aware floating circle: "+JSON.stringify(wheel));
  await screenshot(orbitSocket,"04-circular-orbit.png").catch(error=>console.warn("Orbit screenshot unavailable",String(error)));
  // Orbit tools run in their own Tauri windows, not React overlays behind
  // the wheel. Verify one panel has exactly one frame and a transparent host.
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
      clear: getComputedStyle(document.querySelector(".orbit-dialog-backdrop")||document.body).backgroundColor==="rgba(0, 0, 0, 0)"
    }))()`);
    if(panelState.native&&panelState.count===1&&panelState.title==="Rename")break;
    await sleep(150);
  }
  if(!panelState.native||panelState.count!==1||panelState.title!=="Rename"||
      !panelState.draggable||!panelState.clear)
    throw Error("Orbit tool has a duplicate backdrop, missing drag handle or is not a separate panel: "+JSON.stringify(panelState));
  await screenshot(panelSocket,"05-independent-orbit-panel.png").catch(error=>console.warn("Orbit panel screenshot unavailable",String(error)));
  await evaluate(panelSocket,'document.querySelector("button[aria-label=\\\"Close\\\"]").click();true');
  let panelClosed=false;
  for(let attempt=0;attempt<40;attempt++){
    await sleep(160);
    if(!(await targets().catch(()=>[])).some(item=>item.id===panelTarget.id)){panelClosed=true;break;}
  }
  if(!panelClosed)throw Error("Closing an Orbit tool left an invisible secondary native window.");
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
  const socket = await connect(hover);
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
    const mediaSocket = socket;
    let state = null;
    for (let attempt = 0; attempt < 45; attempt++) {
      state = await evaluate(mediaSocket, `(() => {
        const element=document.querySelector("${kind}");
        return {present:!!element,ready:element?.readyState||0,
          duration:element?.duration||0,error:element?.error?.message||null};
      })()`);
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
