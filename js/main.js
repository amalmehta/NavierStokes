// App: canvas sizing, pointer input, the frame loop, scene switching, and the ?selftest run.
(function () {
  const NS = window.NS;
  const canvas = document.getElementById('view');
  const params = new URLSearchParams(location.search);

  let gl;
  try { gl = NS.gl.createGL(canvas); } catch (e) { return fail(e); }

  const settings = NS.ui.loadSettings();
  if (params.has('quality')) settings.quality = params.get('quality');
  if (params.has('view')) settings.view = params.get('view');
  if (params.has('scene')) settings.scene = clampScene(Number(params.get('scene')) - 1);
  if (params.has('bare')) document.body.classList.add('bare');

  let sim = null, sceneIndex = -1, paused = false;

  const ui = NS.ui.initUI(settings, NS.scenes, {
    scene: (i) => loadScene(i),
    pause: () => { paused = !paused; ui.setPaused(paused); },
    reset: () => sim && sim.reset(),
    fullscreen: toggleFullscreen,
    change: (key) => { if (key === 'quality') sim.resize(canvas.width, canvas.height); },
  });

  function clampScene(i) { return Number.isFinite(i) ? Math.max(0, Math.min(NS.scenes.length - 1, i)) : 0; }

  function fail(e) {
    console.error(e);
    const el = document.getElementById('error');
    el.hidden = false;
    el.textContent = 'The simulation could not start: ' + (e.message || e) + ' Try a recent Chrome, Safari, Edge or Firefox with hardware acceleration on.';
  }

  function sizeCanvas() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(window.innerWidth * dpr);
    canvas.height = Math.round(window.innerHeight * dpr);
  }

  function loadScene(i) {
    i = clampScene(i);
    if (sim) sim.dispose();
    const scene = NS.scenes[i];
    try {
      sim = scene.kind === 'pool' ? new NS.Pool(gl, scene, settings) : new NS.Fluid(gl, scene, settings);
      sim.resize(canvas.width, canvas.height);
    } catch (e) { return fail(e); }
    sceneIndex = i; settings.scene = i; ui.save();
    ui.showScene(i);
  }

  let resizeTimer = 0;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => { sizeCanvas(); if (sim) sim.resize(canvas.width, canvas.height); }, 150);
  });

  function toggleFullscreen() {
    const d = document;
    if (!d.fullscreenElement && !d.webkitFullscreenElement) {
      const el = d.documentElement;
      (el.requestFullscreen || el.webkitRequestFullscreen).call(el)?.catch?.(() => {});
    } else {
      (d.exitFullscreen || d.webkitExitFullscreen).call(d);
    }
  }

  // ---- pointer input: drags become force + dye splats in scene units ----
  const pointers = new Map();
  const toScene = (e) => ({ x: (e.clientX / window.innerWidth) * (window.innerWidth / window.innerHeight), y: 1 - e.clientY / window.innerHeight });
  canvas.addEventListener('pointerdown', (e) => {
    canvas.setPointerCapture(e.pointerId);
    const p = toScene(e);
    pointers.set(e.pointerId, { ...p, px: p.x, py: p.y, moved: false, down: true });
  });
  canvas.addEventListener('pointermove', (e) => {
    const ptr = pointers.get(e.pointerId);
    if (!ptr) return;
    const p = toScene(e);
    ptr.x = p.x; ptr.y = p.y; ptr.moved = true;
  });
  const lift = (e) => pointers.delete(e.pointerId);
  canvas.addEventListener('pointerup', lift);
  canvas.addEventListener('pointercancel', lift);

  function collectSplats(dt) {
    const out = [], scene = NS.scenes[sceneIndex];
    for (const ptr of pointers.values()) {
      if (!ptr.moved && !ptr.down) continue;
      const k = 1 / Math.max(dt, 1 / 120);
      let dx = (ptr.x - ptr.px) * k, dy = (ptr.y - ptr.py) * k;
      const m = Math.hypot(dx, dy), cap = 3;
      if (m > cap) { dx *= cap / m; dy *= cap / m; }
      out.push({ x: ptr.x, y: ptr.y, dx, dy, radius: 0.0009, down: ptr.down, color: scene.splat ? scene.splat() : [0, 0, 0, 0] });
      ptr.px = ptr.x; ptr.py = ptr.y; ptr.moved = false; ptr.down = false;
    }
    return out;
  }

  // ---- frame loop ----
  let last = performance.now(), fpsFrames = 0, fpsTime = 0, fps = 0;
  function frame(now) {
    const realDt = Math.min((now - last) / 1000, 1 / 30);
    last = now;
    const splats = collectSplats(realDt);
    if (!paused) sim.step(realDt * settings.speed, splats);
    sim.render(Number(settings.view));

    fpsFrames++; fpsTime += realDt;
    if (fpsTime > 0.5) { fps = fpsFrames / fpsTime; fpsFrames = 0; fpsTime = 0; }
    const re = sim.reynolds ? sim.reynolds() : null;
    ui.setHud(`${fps.toFixed(0)} fps · grid ${sim.simW}×${sim.simH}` + (re ? `\nRe ≈ ${Math.round(re)} (nominal)` : ''));
    requestAnimationFrame(frame);
  }

  // ---- self-test: ?selftest runs every scene headlessly and reports pass/fail ----
  function selftest() {
    const report = [], out = document.getElementById('selftest');
    let pass = true;
    NS.scenes.forEach((scene, i) => {
      loadScene(i);
      for (let f = 0; f < 150; f++) sim.step(1 / 60, []);
      const m = sim.measure();
      const checks = [];
      checks.push(['no NaN / Inf', m.nan === 0]);
      if (scene.kind === 'pool') {
        checks.push(['water volume conserved (<1% drift)', m.volumeDrift < 0.01]);
      } else {
        checks.push(['projection cuts divergence >10×', m.divAfter < m.divBefore / 10 || m.divAfter < 1e-3]);
        checks.push(['solids stay still', m.solidMaxSpeed < 1e-3]);
        checks.push(['fluid is moving', m.meanSpeed > 0.01]);
        if (scene.edges[0] === 2) checks.push(['net flow left → right', m.meanU > 0.05]);
      }
      const ok = checks.every((c) => c[1]);
      pass = pass && ok;
      report.push({ scene: scene.name, ok, checks: Object.fromEntries(checks), metrics: m });
    });
    window.__selftest = { pass, report };
    out.hidden = false;
    out.textContent = (pass ? 'SELF-TEST PASSED' : 'SELF-TEST FAILED') + '\n\n' + report.map((r) =>
      `${r.ok ? '✓' : '✗'} ${r.scene}\n` + Object.entries(r.checks).map(([k, v]) => `    ${v ? 'ok  ' : 'FAIL'} ${k}`).join('\n') +
      '\n    ' + Object.entries(r.metrics).map(([k, v]) => `${k}=${typeof v === 'number' ? v.toPrecision(3) : v}`).join(' ')).join('\n');
    console.log('SELFTEST', JSON.stringify(window.__selftest));
  }

  window.NSApp = { get sim() { return sim; }, settings, loadScene }; // for tests and the console

  sizeCanvas();
  if (params.has('selftest')) { const start = settings.scene; selftest(); loadScene(start); }
  else loadScene(settings.scene);

  const warm = Number(params.get('warm') || 0);
  for (let f = 0; f < warm; f++) sim.step(1 / 60, []);
  if (params.has('paused')) { paused = true; ui.setPaused(true); }
  requestAnimationFrame((t) => { last = t; frame(t); });
})();
