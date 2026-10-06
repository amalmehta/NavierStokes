// Settings (saved in this browser), the scene picker, equations card, settings and feedback panels.
(function () {
  const NS = (window.NS = window.NS || {});
  const $ = (id) => document.getElementById(id);

  const DEFAULTS = {
    quality: 'high', view: '0', speed: 1, viscosity: 1, vorticity: 1, cycles: 2,
    rain: true, equations: window.innerWidth >= 640, stats: false, autohide: true, scene: 0,
  };
  const KEY = 'navier-stokes.settings';
  const FB_KEY = 'navier-stokes.feedback';

  function storageGet(key) { try { return localStorage.getItem(key); } catch { return null; } }
  function storageSet(key, value) { try { localStorage.setItem(key, value); } catch { /* private mode: keep in memory */ } }

  function loadSettings() {
    let saved = {};
    try { saved = JSON.parse(storageGet(KEY) || '{}'); } catch { saved = {}; }
    return { ...DEFAULTS, ...saved };
  }

  const FORMAT = {
    speed: (v) => v.toFixed(2) + '×', viscosity: (v) => v.toFixed(1) + '×', vorticity: (v) => v.toFixed(1) + '×', cycles: (v) => String(v),
  };

  // onChange(key, value) lets the app react (rebuild on quality change, etc).
  function initUI(settings, scenes, handlers) {
    const save = () => storageSet(KEY, JSON.stringify(settings));

    // --- scene picker ---
    const nav = $('scenes');
    scenes.forEach((s, i) => {
      const b = document.createElement('button');
      b.innerHTML = `<kbd>${i + 1}</kbd>${s.name}`;
      b.title = `${s.name} (${i + 1})`;
      b.addEventListener('click', () => handlers.scene(i));
      nav.appendChild(b);
    });

    function showScene(i) {
      const s = scenes[i];
      [...nav.children].forEach((b, j) => b.setAttribute('aria-current', String(i === j)));
      $('scene-name').textContent = `${i + 1} / ${scenes.length} · ${s.name}`;
      $('eq-lines').innerHTML = s.eq.lines.map((l) => `<div>${l}</div>`).join('');
      $('eq-terms').innerHTML = s.eq.terms.map(([t, d]) => `<dt>${t}</dt><dd>${d}</dd>`).join('');
      $('eq-note').textContent = s.eqNote;
      $('scene-blurb').textContent = s.blurb;
      document.title = `${s.name} · Navier–Stokes`;
    }

    // --- settings panel ---
    const panel = $('settings');
    function syncControls() {
      panel.querySelectorAll('[data-key]').forEach((el) => {
        const k = el.dataset.key;
        if (el.type === 'checkbox') el.checked = !!settings[k]; else el.value = settings[k];
      });
      panel.querySelectorAll('output[data-for]').forEach((o) => { o.textContent = FORMAT[o.dataset.for](Number(settings[o.dataset.for])); });
      $('eq-card').hidden = !settings.equations;
      $('btn-eq').setAttribute('aria-pressed', String(!!settings.equations));
      $('hud').hidden = !settings.stats;
    }
    panel.querySelectorAll('[data-key]').forEach((el) => {
      const evt = el.type === 'range' ? 'input' : 'change';
      el.addEventListener(evt, () => {
        const k = el.dataset.key;
        settings[k] = el.type === 'checkbox' ? el.checked : el.type === 'range' ? Number(el.value) : el.value;
        save(); syncControls(); handlers.change(k, settings[k]);
      });
    });
    $('s-defaults').addEventListener('click', () => {
      const quality = settings.quality;
      Object.assign(settings, DEFAULTS, { scene: settings.scene });
      save(); syncControls();
      if (quality !== settings.quality) handlers.change('quality', settings.quality);
    });

    // --- panels open/close ---
    const fb = $('feedback');
    function toggle(el, open) {
      const show = open ?? el.hidden;
      [panel, fb].forEach((p) => { if (p !== el) p.hidden = true; });
      el.hidden = !show;
      if (show) (el.querySelector('select, textarea') || el).focus();
    }
    document.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => { b.closest('.panel').hidden = true; }));
    $('btn-settings').addEventListener('click', () => toggle(panel));
    $('feedback-tab').addEventListener('click', () => toggle(fb));
    $('btn-eq').addEventListener('click', () => setSetting('equations', !settings.equations));

    function setSetting(k, v) { settings[k] = v; save(); syncControls(); handlers.change(k, v); }

    // --- feedback (kept locally) ---
    const notes = () => { try { return JSON.parse(storageGet(FB_KEY) || '[]'); } catch { return []; } };
    const status = (t) => { $('fb-status').textContent = t; setTimeout(() => { $('fb-status').textContent = ''; }, 2000); };
    function renderNotes() {
      $('fb-list').innerHTML = '';
      notes().forEach((n) => { const li = document.createElement('li'); li.textContent = `${n.at.slice(0, 16).replace('T', ' ')} · ${n.scene} — ${n.text}`; $('fb-list').appendChild(li); });
    }
    const asText = () => notes().map((n) => `[${n.at}] (${n.scene}) ${n.text}`).join('\n');
    $('fb-save').addEventListener('click', () => {
      const text = $('fb-text').value.trim();
      if (!text) return;
      storageSet(FB_KEY, JSON.stringify([...notes(), { at: new Date().toISOString(), scene: scenes[settings.scene].name, text }]));
      $('fb-text').value = ''; renderNotes(); status('Saved');
    });
    $('fb-copy').addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(asText()); status('Copied'); } catch { status('Copy not allowed here'); }
    });
    $('fb-download').addEventListener('click', () => {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([asText()], { type: 'text/plain' }));
      a.download = 'Navier-Stokes feedback.txt'; a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    });
    renderNotes();

    // --- buttons + keyboard ---
    $('btn-pause').addEventListener('click', handlers.pause);
    $('btn-reset').addEventListener('click', handlers.reset);
    $('btn-full').addEventListener('click', handlers.fullscreen);
    window.addEventListener('keydown', (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === ',') { e.preventDefault(); toggle(panel); return; }
      if (e.key === 'Escape') { panel.hidden = true; fb.hidden = true; return; }
      if (e.target.closest('input, textarea, select') || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key >= '1' && e.key <= String(scenes.length)) handlers.scene(Number(e.key) - 1);
      else if (e.key === ' ') { e.preventDefault(); handlers.pause(); }
      else if (e.key === 'r' || e.key === 'R') handlers.reset();
      else if (e.key === 'f' || e.key === 'F') handlers.fullscreen();
      else if (e.key === 'e' || e.key === 'E') setSetting('equations', !settings.equations);
      else if (e.key === 'v' || e.key === 'V') setSetting('view', String((Number(settings.view) + 1) % 4));
    });

    // --- hide controls when idle ---
    let idleTimer = 0;
    function wake() {
      document.body.classList.remove('idle');
      clearTimeout(idleTimer);
      idleTimer = setTimeout(() => {
        const busy = !panel.hidden || !fb.hidden || document.querySelector('#ui:hover, #feedback-tab:hover');
        if (settings.autohide && !busy) document.body.classList.add('idle');
      }, 3500);
    }
    ['pointermove', 'pointerdown', 'keydown'].forEach((e) => window.addEventListener(e, wake, { passive: true }));
    wake();

    syncControls();
    return {
      showScene,
      setPaused(p) { $('btn-pause').classList.toggle('paused', p); $('btn-pause').title = p ? 'Play (Space)' : 'Pause (Space)'; },
      setHud(text) { if (settings.stats) $('hud').textContent = text; },
      save,
    };
  }

  NS.ui = { loadSettings, initUI, DEFAULTS };
})();
