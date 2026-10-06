// Incompressible 2D Navier–Stokes on the GPU ("stable fluids", Stam 1999):
// forces + viscosity → vorticity confinement → pressure projection → advection.
(function () {
  const NS = (window.NS = window.NS || {});
  const { Program, createTarget, createDouble, freeTarget, pass, readTarget } = NS.gl;

  const QUALITY = {
    low: { sim: 128, dye: 512 }, medium: { sim: 192, dye: 768 },
    high: { sim: 256, dye: 1024 }, ultra: { sim: 384, dye: 1536 },
  };

  const programCache = new Map(); // scene id -> compiled programs

  function programsFor(gl, scene) {
    if (programCache.has(scene.id)) return programCache.get(scene.id);
    const S = NS.shaders, progs = {};
    for (const [name, body] of Object.entries(S.fluid)) progs[name] = new Program(gl, S.VERT, S.frag(scene, body));
    programCache.set(scene.id, progs);
    return progs;
  }

  class Fluid {
    constructor(gl, scene, settings) {
      this.gl = gl; this.scene = scene; this.settings = settings;
      this.p = programsFor(gl, scene);
      this.time = 0; this.init = 1;
    }

    resize(width, height) {
      const gl = this.gl;
      this.dispose();
      this.size = [width, height];
      const q = QUALITY[this.settings.quality] || QUALITY.high;
      this.aspect = width / height;
      const simH = q.sim, dyeH = Math.min(q.dye, Math.max(256, height));
      const simW = Math.round(simH * this.aspect), dyeW = Math.round(dyeH * this.aspect);
      this.simH = simH; this.simW = simW;
      this.vel = createDouble(gl, simW, simH, gl.LINEAR, true);
      this.pres = createDouble(gl, simW, simH, gl.NEAREST, true);
      this.div = createTarget(gl, simW, simH, gl.NEAREST, true);
      this.curl = createTarget(gl, simW, simH, gl.NEAREST);
      this.obs = createTarget(gl, simW, simH, gl.LINEAR);
      this.dye = createDouble(gl, dyeW, dyeH, gl.LINEAR);
      this.time = 0; this.init = 1;
      pass(gl, this.p.OBSTACLE, this.common(this.obs.texel), this.obs);

      // Multigrid hierarchy for the pressure solve: each level halves the grid down to ~8 cells.
      this.levels = [{ w: simW, h: simH, texel: this.pres.texel, p: this.pres, b: this.div, r: createTarget(gl, simW, simH, gl.LINEAR, true), obs: this.obs }];
      for (let w = simW, h = simH; Math.min(w, h) > 8;) {
        w = Math.ceil(w / 2); h = Math.ceil(h / 2);
        const L = { w, h, texel: [1 / w, 1 / h], p: createDouble(gl, w, h, gl.LINEAR, true), b: createTarget(gl, w, h, gl.NEAREST, true),
          r: createTarget(gl, w, h, gl.LINEAR, true), obs: createTarget(gl, w, h, gl.LINEAR) };
        pass(gl, this.p.OBS_DOWN, { ...this.common(L.texel), uSrc: this.levels[this.levels.length - 1].obs }, L.obs);
        this.levels.push(L);
      }
    }

    reset() { this.resize(...this.size); }

    common(texel) {
      return { texel, uAspect: this.aspect, uTime: this.time, uCPU: this.simH, uInit: this.init, uEdge: this.scene.edges, uSimTexel: this.vel.texel };
    }

    // Scene and settings combined into the numbers the shaders use.
    params() {
      const s = this.scene, st = this.settings, cpu = this.simH;
      return {
        nu: s.viscosity * st.viscosity * cpu * cpu,
        curl: s.vorticity * st.vorticity * (cpu / 256),
      };
    }

    reynolds() {
      if (!this.scene.cylinder) return null;
      const nu = this.scene.viscosity * this.settings.viscosity;
      return nu > 0 ? (this.scene.speed * 2 * this.scene.cylinder.r) / nu : Infinity;
    }

    step(dt, splats) {
      const gl = this.gl, P = this.p, prm = this.params();
      const simTexel = this.vel.texel, base = this.common(simTexel);
      const vel = this.vel, dye = this.dye;

      pass(gl, P.FORCE, { ...base, uVel: vel.read, uDye: dye.read, uObs: this.obs, dt, uNu: prm.nu }, vel.write); vel.swap();
      pass(gl, P.CURL, { ...base, uVel: vel.read }, this.curl);
      pass(gl, P.VORTICITY, { ...base, uVel: vel.read, uCurl: this.curl, uObs: this.obs, uCurlStrength: prm.curl, dt }, vel.write); vel.swap();

      for (const s of splats) {
        pass(gl, P.SPLAT, { ...base, uTarget: vel.read, uPoint: [s.x, s.y], uColor: [s.dx * this.simH, s.dy * this.simH, 0, 0], uRadius: s.radius }, vel.write); vel.swap();
        pass(gl, P.SPLAT, { ...this.common(dye.texel), uTarget: dye.read, uPoint: [s.x, s.y], uColor: s.color, uRadius: s.radius }, dye.write); dye.swap();
      }

      this.project(base, prm);

      pass(gl, P.ADVECT_VEL, { ...base, uVel: vel.read, uObs: this.obs, dt, uDiss: this.scene.velDiss }, vel.write); vel.swap();
      const dyeBase = this.common(dye.texel);
      pass(gl, P.DYE_SOURCE, { ...dyeBase, uDye: dye.read, dt }, dye.write); dye.swap();
      pass(gl, P.ADVECT, { ...dyeBase, uVel: vel.read, uSrc: dye.read, uObs: this.obs, dt, uDiss: this.scene.dyeDiss }, dye.write); dye.swap();

      this.time += dt; this.init = 0;
    }

    // Make the velocity divergence-free (or match the scene's sources): solve ∇²p = ∇·u, then u −= ∇p.
    project(base, prm) {
      const gl = this.gl, P = this.p, vel = this.vel, pres = this.pres;
      pass(gl, P.DIVERGENCE, { ...base, uVel: vel.read, uObs: this.obs }, this.div);
      // last frame's pressure is a good first guess
      for (let i = 0; i < this.settings.cycles; i++) this.vcycle(0);
      pass(gl, P.GRADIENT, { ...base, uP: pres.read, uVel: vel.read, uObs: this.obs }, vel.write); vel.swap();
    }

    // One multigrid V-cycle: smooth, hand the leftover error to a coarser grid, add its correction back, smooth.
    vcycle(l) {
      const gl = this.gl, P = this.p, L = this.levels[l];
      const at = (extra) => ({ ...this.common(L.texel), uObs: L.obs, ...extra });
      const smooth = (n) => {
        for (let i = 0; i < n; i++) { pass(gl, P.PRESSURE, at({ uP: L.p.read, uDiv: L.b, uOmega: 0.8 }), L.p.write); L.p.swap(); }
      };
      if (l === this.levels.length - 1) { smooth(24); return; }
      smooth(3);
      pass(gl, P.RESIDUAL, at({ uP: L.p.read, uDiv: L.b }), L.r);
      const C = this.levels[l + 1];
      pass(gl, P.RESTRICT, { ...this.common(C.texel), uSrc: L.r }, C.b);
      pass(gl, P.SCALE, { ...this.common(C.texel), uSrc: C.p.read, uS: 0 }, C.p.write); C.p.swap();
      this.vcycle(l + 1);
      pass(gl, P.PROLONG, at({ uP: L.p.read, uE: C.p.read }), L.p.write); L.p.swap();
      smooth(3);
    }

    render(mode) {
      const s = this.scene, U = s.speed * this.simH;
      pass(this.gl, this.p.DISPLAY, {
        ...this.common(this.dye.texel), uDye: this.dye.read, uVel: this.vel.read, uP: this.pres.read, uCurl: this.curl,
        uMode: mode, uDyeTexel: this.dye.texel, uScales: [U * 1.4, s.speed / 0.03, U * 0.04 * this.simH],
      }, null);
    }

    // Self-test: residual divergence before vs after one projection, plus sanity stats.
    measure() {
      const gl = this.gl, base = this.common(this.vel.texel), prm = this.params();
      const meanAbsDiv = () => {
        pass(gl, this.p.DIVERGENCE, { ...base, uVel: this.vel.read, uObs: this.obs }, this.div);
        const d = readTarget(gl, this.div), o = readTarget(gl, this.obs);
        let sum = 0, n = 0;
        for (let y = 2; y < this.simH - 2; y++) for (let x = 2; x < this.simW - 2; x++) {
          const i = (y * this.simW + x) * 4;
          if (o[i] > 0.5) continue;
          sum += Math.abs(d[i]); n++;
        }
        return sum / Math.max(1, n);
      };
      const before = meanAbsDiv();
      this.project(base, prm);
      const after = meanAbsDiv();
      const v = readTarget(gl, this.vel.read), o = readTarget(gl, this.obs);
      let nan = 0, speed = 0, n = 0, solidMax = 0, meanU = 0;
      for (let i = 0; i < v.length; i += 4) {
        if (!Number.isFinite(v[i]) || !Number.isFinite(v[i + 1])) { nan++; continue; }
        const s = Math.hypot(v[i], v[i + 1]);
        if (o[i] > 0.5) { solidMax = Math.max(solidMax, s); continue; }
        speed += s; meanU += v[i]; n++;
      }
      const dyeData = readTarget(gl, this.dye.read);
      let dyeNan = 0, dyeSum = 0;
      for (let i = 0; i < dyeData.length; i += 4) {
        if (!Number.isFinite(dyeData[i])) dyeNan++; else dyeSum += dyeData[i] + dyeData[i + 1] + dyeData[i + 2];
      }
      const cells = this.simH;
      return {
        divBefore: before, divAfter: after, nan: nan + dyeNan,
        meanSpeed: speed / n / cells, meanU: meanU / n / cells, solidMaxSpeed: solidMax / cells, dyeMean: dyeSum / (dyeData.length / 4),
      };
    }

    dispose() {
      const gl = this.gl;
      for (const k of ['vel', 'pres', 'div', 'curl', 'obs', 'dye']) { freeTarget(gl, this[k]); this[k] = null; }
      (this.levels || []).forEach((L, i) => { freeTarget(gl, L.r); if (i > 0) { freeTarget(gl, L.p); freeTarget(gl, L.b); freeTarget(gl, L.obs); } });
      this.levels = null;
    }
  }

  Fluid.QUALITY = QUALITY;
  NS.Fluid = Fluid;
})();
