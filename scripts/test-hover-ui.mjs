// Windows CI regression test: a real, bundled ReformANY EXE must open HoveR
// with an image, render the React player, and load the explicitly scoped file.
// The debugging port is enabled only in the CI job via ephemeral WebView2 policy.
import { spawn, execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
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
  const video = join(temp, "sample.mp4"), audio = join(temp, "sample.mp3");
  execFileSync(ffmpeg, ["-hide_banner","-loglevel","error","-y",
    "-f","lavfi","-i","testsrc2=size=160x90:rate=10",
    "-f","lavfi","-i","sine=frequency=440:sample_rate=44100",
    "-t","2","-c:v","libx264","-pix_fmt","yuv420p","-c:a","aac",video],
    {windowsHide:true,timeout:30000});
  execFileSync(ffmpeg, ["-hide_banner","-loglevel","error","-y","-i",video,
    "-map","0:a:0","-vn","-c:a","libmp3lame",audio],
    {windowsHide:true,timeout:30000});
  child = spawn(exe, [], {
    windowsHide:false,
    stdio:"ignore",
    env:{
      ...process.env,
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
  // Verify the installed desktop UI, not just Vite compilation. This catches
  // the screenshot-reported double navigation and broken sidebar collapse.
  if (await evaluate(mainSocket, 'Boolean(document.querySelector(".welcome-primary"))')) {
    const initial = await evaluate(mainSocket, `(() => {
      const wheel=document.querySelector(".welcome-orbit").getBoundingClientRect();
      const tabs=document.querySelector(".welcome-orbit-tabs").getBoundingClientRect();
      const sectors=document.querySelectorAll(".welcome-radial-sector[role=button]");
      return {wheelBottom:wheel.bottom,tabsTop:tabs.top,sectorCount:sectors.length,
        withinWheel:tabs.top<wheel.bottom-1};
    })()`);
    if (initial.withinWheel || initial.sectorCount < 10)
      throw new Error("Welcome Orbit tabs overlap the wheel or slices are not interactive: "+
        JSON.stringify(initial));
    await evaluate(mainSocket,
      'document.querySelector("#welcome-orbit-tab-tools").click(); true');
    await sleep(110);
    const toolsEnabled = await evaluate(mainSocket,
      'Boolean(document.querySelector("#welcome-orbit-tab-tools[aria-selected=true]") && document.querySelectorAll(".welcome-radial-sector[role=button]").length >= 5)');
    if (!toolsEnabled) throw new Error("Welcome Tools section did not switch wheel segments");
    await evaluate(mainSocket, `(() => {
      const zip=[...document.querySelectorAll(".welcome-radial-sector")]
        .find(node=>node.querySelector("title")?.textContent==="ZIP");
      if(!zip)throw Error("ZIP sector missing");
      zip.dispatchEvent(new MouseEvent("click",{bubbles:true}));
      return true;
    })()`);
    await sleep(110);
    const zipSelected = await evaluate(mainSocket, `(() => ({
      title:document.querySelector(".welcome-orbit-action-copy strong")?.textContent,
      chosen:document.querySelector(".welcome-radial-sector.is-selected title")?.textContent
    }))()`);
    if (zipSelected.title!=="ZIP"||zipSelected.chosen!=="ZIP")
      throw new Error("Welcome Orbit sector click did not select the correct action: "+JSON.stringify(zipSelected));
    await evaluate(mainSocket,
      'document.querySelector(".welcome-orbit-demo-controls button").click(); true');
    await sleep(80);
    const demoWorked = await evaluate(mainSocket,
      'Boolean(document.querySelector(".welcome-orbit-done")?.textContent.includes("no files were changed"))');
    if (!demoWorked) throw new Error("Welcome Orbit sample action has no interactive feedback");
    await evaluate(mainSocket,`(() => {
      document.querySelector("#welcome-orbit-tab-tools").dispatchEvent(
        new KeyboardEvent("keydown",{key:"ArrowRight",bubbles:true}));
      return true;
    })()`);
    await sleep(120);
    const actionsEnabled = await evaluate(mainSocket,
      'Boolean(document.querySelector("#welcome-orbit-tab-actions[aria-selected=true]"))');
    if (!actionsEnabled) throw new Error("Welcome Orbit keyboard section switch did not work");
    await screenshot(mainSocket,"00-welcome-interactive-orbit.png").catch(error =>
      console.warn("Welcome screenshot unavailable:",String(error)));
    // Clicking Use my file routes through this exact same command. The
    // native process must launch Orbit on the chosen file, not a fake overlay.
    await evaluate(mainSocket,
      'window.__TAURI_INTERNALS__.invoke("orbit_launch_file",{path:' + JSON.stringify(picture) + '})');
    let realOrbit=null;
    for(let attempt=0;attempt<55;attempt++){
      const pages=await targets().catch(()=>[]);
      realOrbit=pages.find(page=>page.type==="page"&&page.id!==main.id&&
        (page.url.includes("tauri.localhost")||page.url.startsWith("tauri://")));
      if(realOrbit)break;
      await sleep(210);
    }
    if(!realOrbit)throw Error("Welcome cannot launch actual Orbit for a selected file");
    const orbitSocket=await connect(realOrbit);
    let actualSource=false;
    for(let attempt=0;attempt<25;attempt++){
      actualSource=Boolean(await evaluate(orbitSocket,
        'document.body.innerText.includes('+JSON.stringify(picture.split(/[\\/]/).pop())+')'));
      if(actualSource)break;
      await sleep(120);
    }
    if(!actualSource)throw Error("Welcome launched Orbit without the chosen file");
    await evaluate(orbitSocket,'window.__TAURI_INTERNALS__.invoke("orbit_open_workspace")');
    await sleep(250);
    console.log("PASS: Welcome wheel layout, keyboard/click controls, sample feedback and real picked-file Orbit launch.");
    await evaluate(mainSocket,
      'document.querySelector(".welcome-primary").click(); true');
    await sleep(400);
  }
  const sidebar = await evaluate(mainSocket, `(() => {
    const aside=document.querySelector(".reformany-sidebar");
    const main=document.querySelector(".main");
    const categories=document.querySelectorAll('nav[aria-label="Workspace tools"] button');
    return {found:!!aside, width:aside?.getBoundingClientRect().width||0,
      categories:categories.length, main:!!main,
      horizontalNav:!!document.querySelector(".workspace-scroll")};
  })()`);
  if (!sidebar.found || !sidebar.main || sidebar.categories !== 9 ||
      sidebar.horizontalNav || sidebar.width < 210) {
    throw new Error("Desktop sidebar layout invalid: " + JSON.stringify(sidebar));
  }
  await screenshot(mainSocket, "01-images-workspace.png").catch(error =>
    console.warn("Images screenshot unavailable:",String(error)));
  await evaluate(mainSocket,
    'document.querySelector("button[aria-label=\\\"Collapse navigation sidebar\\\"]").click(); true');
  await sleep(300);
  const compact = await evaluate(mainSocket, `(() => ({
    width:document.querySelector(".reformany-sidebar")?.getBoundingClientRect().width,
    saved:localStorage.getItem("reformany:sidebar-collapsed"),
    iconCount:document.querySelectorAll('nav[aria-label="Workspace tools"] button svg').length
  }))()`);
  if (Math.abs((compact.width||0)-74)>4 || compact.saved!=="true" || compact.iconCount!==9) {
    throw new Error("Sidebar collapse or persistence failed: "+JSON.stringify(compact));
  }
  await evaluate(mainSocket,
    'document.querySelector("button[aria-label=\\\"Expand navigation sidebar\\\"]").click(); true');
  await sleep(250);
  await evaluate(mainSocket,
    'document.querySelector("button[aria-label=\\\"Guide\\\"]").click(); true');
  await sleep(250);
  const guide = await evaluate(mainSocket, `(() => ({
    heading:document.querySelector(".guide-page h1")?.innerText,
    steps:document.querySelectorAll(".guide-steps section").length
  }))()`);
  if (guide.heading!=="Guide" || guide.steps<8) {
    throw new Error("Guide navigation or workflow help failed: "+JSON.stringify(guide));
  }
  await screenshot(mainSocket, "02-guide.png").catch(error =>
    console.warn("Guide screenshot unavailable:",String(error)));
  await evaluate(mainSocket,
    'document.querySelectorAll(\'nav[aria-label="Workspace tools"] button\')[1].click(); true');
  await sleep(250);
  const media = await evaluate(mainSocket,
    'Boolean(document.body.innerText.includes("Convert to") && document.body.innerText.includes("Quality"))');
  if (!media) throw new Error("Audio/video workspace did not render from sidebar navigation");
  await screenshot(mainSocket, "03-audio-video.png").catch(error =>
    console.warn("Media screenshot unavailable:",String(error)));
  console.log("PASS: sidebar layout, collapse persistence, Guide and media navigation.");
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
      mode:document.documentElement.dataset.mode
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
  // Regression: users reported that the custom X did nothing. This must
  // destroy the native WebView, not merely hide React content.
  await evaluate(socket,
    'document.querySelector("button[aria-label=\\\"Close hovering preview\\\"]").click(); true');
  let closed = false;
  for (let attempt = 0; attempt < 35; attempt++) {
    await sleep(180);
    const live = await targets().catch(() => []);
    closed = !live.some(target => target.id === hover.id);
    if (closed) break;
  }
  if (!closed) throw new Error("HoveR close button left the native preview window running");
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
