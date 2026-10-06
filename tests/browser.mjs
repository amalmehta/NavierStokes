// Drives headless Chrome over the DevTools protocol (no npm packages needed, Node 22+).
//   node tests/browser.mjs selftest            → runs ?selftest, prints the report, exit 1 on failure
//   node tests/browser.mjs screenshots         → writes docs/images/scene-1.png … scene-5.png (SCENES=3,4 for some)
// Serve the site first:  python3 -m http.server 8765
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BASE = process.env.BASE_URL || 'http://localhost:8765/';
const CHROME = process.env.CHROME || {
  darwin: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  linux: 'google-chrome', win32: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
}[process.platform];
const PORT = 9333;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function launch(width, height) {
  const profile = mkdtempSync(join(tmpdir(), 'ns-chrome-'));
  const proc = spawn(CHROME, [
    '--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, `--window-size=${width},${height}`,
    '--enable-gpu', '--use-angle=metal', '--ignore-gpu-blocklist', '--hide-scrollbars', '--no-first-run', 'about:blank',
  ], { stdio: 'ignore' });
  let targets;
  for (let i = 0; i < 50 && !targets; i++) {
    try { targets = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json(); } catch { await sleep(200); }
  }
  const page = targets.find((t) => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener('open', r, { once: true }));
  let id = 0;
  const pending = new Map();
  ws.addEventListener('message', (e) => {
    const msg = JSON.parse(e.data);
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
    if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') console.error('[page]', msg.params.args.map((a) => a.value).join(' '));
    if (msg.method === 'Runtime.exceptionThrown') console.error('[page exception]', msg.params.exceptionDetails.exception?.description);
  });
  const send = (method, params = {}) => new Promise((r) => { const n = ++id; pending.set(n, r); ws.send(JSON.stringify({ id: n, method, params })); });
  await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
  const evaluate = async (expr) => (await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })).result?.result?.value;
  const goto = async (url) => { await send('Page.enable'); await send('Page.navigate', { url }); await sleep(500); };
  const close = () => { ws.close(); proc.kill(); setTimeout(() => rmSync(profile, { recursive: true, force: true }), 500); };
  return { send, evaluate, goto, close };
}

async function selftest() {
  const b = await launch(1280, 720);
  await b.goto(BASE + '?selftest&quality=' + (process.env.QUALITY || 'high'));
  let result;
  for (let i = 0; i < 300 && !result; i++) { result = await b.evaluate('window.__selftest && JSON.stringify(window.__selftest)'); if (!result) await sleep(200); }
  const text = await b.evaluate("document.getElementById('selftest').textContent || document.getElementById('error').textContent");
  b.close();
  console.log(text);
  process.exit(result && JSON.parse(result).pass ? 0 : 1);
}

async function screenshots() {
  const out = process.env.OUT || join(ROOT, 'docs', 'images');
  mkdirSync(out, { recursive: true });
  const [W, H] = (process.env.SIZE || '1600x900').split('x').map(Number);
  const b = await launch(W, H);
  const warm = [420, 600, 480, 600, 240];
  const only = (process.env.SCENES || '1,2,3,4,5').split(',').map(Number);
  for (const i of only) {
    await b.goto(`${BASE}?scene=${i}&warm=${warm[i - 1]}&paused&quality=high` + (process.env.UI ? '' : '&bare'));
    await sleep(1500);
    const shot = await b.send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(join(out, `scene-${i}.png`), Buffer.from(shot.result.data, 'base64'));
    console.log('wrote', join(out, `scene-${i}.png`));
  }
  b.close();
}

const cmd = process.argv[2];
if (cmd === 'selftest') await selftest();
else if (cmd === 'screenshots') await screenshots();
else { console.log('usage: node tests/browser.mjs selftest|screenshots'); process.exit(2); }
