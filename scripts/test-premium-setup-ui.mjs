// End-to-end Windows WebView2 startup smoke test for the actual premium EXE.
// This catches the specific regression where cargo release builds open devUrl
// (localhost) instead of embedding the built React frontend.
// Chrome DevTools Protocol is enabled only for this CI test process, NEVER in
// ReformANY's normal installer or on an end-user's machine.
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

if (process.platform !== "win32") throw new Error("Premium UI smoke must run on Windows");
const exe = resolve(process.argv[2] || "");
if (!exe.toLowerCase().endsWith(".exe") || !existsSync(exe)) {
  throw new Error("Pass the real premium setup EXE as the first argument");
}

const port = 19375;
const base = "http://127.0.0.1:" + port;
const tmp = await mkdtemp(join(tmpdir(), "reformany-setup-ui-"));
let child;
let socket;
let passed = false;
try {
  try {
    const active = await fetch(base + "/json/list", { signal: AbortSignal.timeout(750) });
    if (active.ok) throw new Error("WebView2 smoke debugging port is already occupied");
  } catch (cause) {
    if (String(cause).includes("already occupied")) throw cause;
  }

  child = spawn(exe, [], {
    windowsHide: false,
    stdio: "ignore",
    env: {
      ...process.env,
      WEBVIEW2_USER_DATA_FOLDER: join(tmp, "webview"),
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS:
        "--remote-debugging-port=" + port + " --remote-allow-origins=*",
    },
  });

  let page;
  const end = Date.now() + 55000;
  while (Date.now() < end) {
    if (child.exitCode !== null) {
      throw new Error("Premium setup exited before opening its WebView2 page: " + child.exitCode);
    }
    try {
      const response = await fetch(base + "/json/list", {
        signal: AbortSignal.timeout(1250),
      });
      if (response.ok) {
        const targets = await response.json();
        page = targets.find(target => target.type === "page" && (
          target.url.includes("tauri.localhost") ||
          target.url.includes("localhost:1421") ||
          target.url.startsWith("tauri://")
        ));
        if (page) break;
      }
    } catch { /* WebView2 not initialized yet */ }
    await sleep(500);
  }
  if (!page) throw new Error("Could not inspect live premium setup WebView2 page");

  if (page.url.includes("localhost:1421") || page.url.includes("127.0.0.1:1421")) {
    throw new Error("REGRESSION: setup is loading the development localhost URL: " + page.url);
  }
  if (!page.url.includes("tauri.localhost") && !page.url.startsWith("tauri://")) {
    throw new Error("Unexpected premium setup origin, expected bundled Tauri assets: " + page.url);
  }
  if (!page.webSocketDebuggerUrl) {
    throw new Error("WebView2 page has no test CDP WebSocket endpoint");
  }

  socket = new WebSocket(page.webSocketDebuggerUrl);
  await Promise.race([
    new Promise((ok, fail) => {
      socket.addEventListener("open", ok, { once: true });
      socket.addEventListener("error", () => fail(new Error("WebView2 test CDP connection failed")), { once: true });
    }),
    sleep(12000).then(() => { throw new Error("WebView2 test CDP connection timeout"); }),
  ]);

  let nextId = 0;
  async function readText() {
    const id = ++nextId;
    return await new Promise((ok, fail) => {
      const timer = setTimeout(() => {
        socket.removeEventListener("message", receive);
        fail(new Error("Timed out evaluating actual installer DOM"));
      }, 3500);
      function receive(event) {
        let message;
        try { message = JSON.parse(String(event.data)); } catch { return; }
        if (message.id !== id) return;
        clearTimeout(timer);
        socket.removeEventListener("message", receive);
        if (message.error || message.result?.exceptionDetails) {
          fail(new Error("Installer DOM script failed: " + JSON.stringify(message)));
        } else {
          ok(String(message.result?.result?.value ?? ""));
        }
      }
      socket.addEventListener("message", receive);
      socket.send(JSON.stringify({
        id, method: "Runtime.evaluate",
        params: { expression: "document.body ? document.body.innerText : ''", returnByValue: true },
      }));
    });
  }
  let lastText = "";
  while (Date.now() < end) {
    lastText = await readText();
    if (lastText.includes("Welcome to ReformANY") && lastText.includes("Get Started")) {
      passed = true;
      break;
    }
    await sleep(600);
  }
  if (!passed) throw new Error(
    "Premium setup WebView2 did not render the real React welcome page: " +
    lastText.slice(0, 500)
  );
  console.log("PASS: premium setup opened embedded " + page.url +
    " and rendered Welcome to ReformANY / Get Started, with NO localhost dev server.");
} finally {
  try { socket?.close(); } catch { /* no-op */ }
  if (child?.pid) {
    const killer = spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
      windowsHide: true, stdio: "ignore",
    });
    await Promise.race([
      new Promise(done => killer.once("exit", done)),
      sleep(3000),
    ]);
  }
  await rm(tmp, { force: true, recursive: true, maxRetries: 5, retryDelay: 300 })
    .catch(() => {});
}
