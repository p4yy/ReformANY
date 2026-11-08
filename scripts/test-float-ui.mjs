// Windows CI regression test: a real, bundled ReformANY EXE must open Float
// with an image, render the React player, and load the explicitly scoped file.
// The debugging port is enabled only in the CI job via ephemeral WebView2 policy.
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

if (process.platform !== "win32") throw new Error("Float startup verification requires Windows");
const exe = resolve(process.argv[2] || "");
const picture = resolve(process.argv[3] || "");
if (!exe.toLowerCase().endsWith(".exe") || !existsSync(exe) || !existsSync(picture)) {
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
  console.log("PASS: bundled ReformANY launched Float and WebView2 displayed selected image without a blank screen.");
} finally {
  for (const socket of sockets) try { socket.close(); } catch {}
  if (child?.pid) {
    const killer = spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], { windowsHide:true, stdio:"ignore" });
    await Promise.race([new Promise(done => killer.once("exit", done)), sleep(3000)]);
  }
  await rm(temp, {force:true,recursive:true,maxRetries:5,retryDelay:300}).catch(()=>{});
}
