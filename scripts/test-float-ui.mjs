// Windows CI regression test: a real, bundled ReformANY EXE must open Float
// with an image, render the React player, and load the explicitly scoped file.
// The debugging port is enabled only in the CI job via ephemeral WebView2 policy.
import { spawn, execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

if (process.platform !== "win32") throw new Error("Float startup verification requires Windows");
const exe = resolve(process.argv[2] || "");
const picture = resolve(process.argv[3] || "");
const ffmpeg = resolve(process.argv[4] || "");
if (!exe.toLowerCase().endsWith(".exe") || !existsSync(exe) || !existsSync(picture) || !existsSync(ffmpeg)) {
  throw new Error("Pass the real ReformANY.exe followed by an existing test PNG");
}
const port = 19376;
const base = "http://127.0.0.1:" + port;
const temp = await mkdtemp(join(tmpdir(), "reformany-float-smoke-"));
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
    if (child.exitCode !== null) throw new Error("ReformANY exited before Float test: " + child.exitCode);
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
  const promise = 'window.__TAURI_INTERNALS__.invoke("float_file", { path:' + JSON.stringify(picture) + '})';
  await evaluate(mainSocket, promise);
  let float;
  while (Date.now() < deadline) {
    last = await targets().catch(() => []);
    float = last.find(item => item.type === "page" && item.id !== main.id &&
      (item.url.includes("tauri.localhost") || item.url.startsWith("tauri://")));
    if (float) break;
    await sleep(500);
  }
  if (!float) throw new Error("Float did not navigate to bundled UI: " + JSON.stringify(last));
  const socket = await connect(float);
  let result;
  while (Date.now() < deadline) {
    result = await evaluate(socket, `(() => ({
      text:document.body?.innerText?.slice(0,300) || "",
      mediaLoaded:Boolean(document.querySelector(".float-preview img[alt='Selected image preview']")?.naturalWidth),
      mode:document.documentElement.dataset.mode
    }))()`);
    if (result?.mode === "float" && result.text.includes("ReformANY Float") && result.mediaLoaded) break;
    await sleep(650);
  }
  if (result?.mode !== "float" || !result.text.includes("ReformANY Float") || !result.mediaLoaded) {
    throw new Error("Float failed to render an actual image player: " + JSON.stringify(result));
  }
  // Pin is not decorative: it must change actual Tauri topmost state.
  let pinned = await evaluate(socket,
    'Boolean(document.querySelector(".float-topbar button[aria-label=\\\"Unpin Float\\\"]"))');
  if (!pinned) throw new Error("Float did not start in pinned state");
  await evaluate(socket,
    'document.querySelector(".float-topbar button[aria-label=\\\"Unpin Float\\\"]").click(); true');
  let unpinned = false;
  for (let attempt = 0; attempt < 25; attempt++) {
    unpinned = await evaluate(socket,
      'Boolean(document.querySelector(".float-topbar button[aria-label=\\\"Keep Float on top\\\"][aria-pressed=\\\"false\\\"]"))');
    if (unpinned) break;
    await sleep(220);
  }
  if (!unpinned) throw new Error("Float pin button did not update native always-on-top state");
  await evaluate(socket,
    'document.querySelector(".float-topbar button[aria-label=\\\"Keep Float on top\\\"]").click(); true');

  // QR must render its actual offline SVG without covering helper text.
  await evaluate(socket,
    'document.querySelectorAll(".float-tabs button")[1].click(); true');
  let qrReady = false;
  for (let attempt = 0; attempt < 30; attempt++) {
    qrReady = await evaluate(socket, 'Boolean(document.querySelector(".float-qr-actions button"))');
    if (qrReady) break;
    await sleep(150);
  }
  if (!qrReady) throw new Error("Float QR tab did not render");
  await evaluate(socket,
    'document.querySelector(".float-qr-actions button").click(); true');
  let qrStatus;
  for (let attempt = 0; attempt < 35; attempt++) {
    qrStatus = await evaluate(socket, `(() => {
      const image = document.querySelector(".float-qr-image img");
      const hint = document.querySelector(".float-qr-content small");
      if (!image || !hint) return null;
      const a = image.getBoundingClientRect(), b = hint.getBoundingClientRect();
      return { hasImage: image.complete && image.naturalWidth > 0, overlap: a.bottom > b.top + 1,
        error: document.querySelector(".float-error")?.innerText || "" };
    })()`);
    if (qrStatus?.hasImage) break;
    await sleep(220);
  }
  if (!qrStatus?.hasImage || qrStatus.overlap || qrStatus.error) {
    throw new Error("Float QR image did not render cleanly: " + JSON.stringify(qrStatus));
  }
  // Verify the actual installed Windows media stack, not just presence
  // of <video>/<audio> tags. HTMLMediaElement must load metadata and advance.
  async function checkMedia(path, kind) {
    await evaluate(mainSocket,
      'window.__TAURI_INTERNALS__.invoke("float_file", {path:' + JSON.stringify(path) + '})');
    // Float is intentionally one reusable WebView. A second native window
    // risks "webview with label float already exists" during async close.
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
      throw new Error("Float failed real "+kind+" decoding: "+JSON.stringify(state));
    }
    const playState=await evaluate(mediaSocket, `(async () => {
      const element=document.querySelector("${kind}");
      element.muted=true;
      try {await element.play();} catch(e){return {error:String(e)};}
      return {playing:!element.paused,ready:element.readyState};
    })()`);
    if (!playState?.playing) throw new Error("Float "+kind+" did not start playback: "+JSON.stringify(playState));
    await sleep(650);
    const position=await evaluate(mediaSocket,
      `document.querySelector("${kind}")?.currentTime||0`);
    if (!(position>0)) throw new Error("Float "+kind+" never advanced playback time");
    await evaluate(mediaSocket,`document.querySelector("${kind}").pause()`);
    const all = await targets();
    const liveFloats = all.filter(target => target.type==="page" && target.id!==main.id &&
      (target.url.includes("tauri.localhost") || target.url.startsWith("tauri://")));
    if (liveFloats.length !== 1 || liveFloats[0].id !== float.id) {
      throw new Error("Float should reuse exactly one WebView: " + JSON.stringify(liveFloats));
    }
  }
  await checkMedia(audio,"audio");
  await checkMedia(video,"video");
  console.log("PASS: offline Float image/MP3/MP4 playback, native pin and QR layout.");
} finally {
  for (const socket of sockets) try { socket.close(); } catch {}
  if (child?.pid) {
    const killer = spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], { windowsHide:true, stdio:"ignore" });
    await Promise.race([new Promise(done => killer.once("exit", done)), sleep(3000)]);
  }
  await rm(temp, {force:true,recursive:true,maxRetries:5,retryDelay:300}).catch(()=>{});
}
