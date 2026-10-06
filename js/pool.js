// Ripple pool: the shallow-water equations (Navier–Stokes averaged over depth) on a staggered grid.
(function () {
  const NS = (window.NS = window.NS || {});
  const { Program, createTarget, createDouble, freeTarget, pass, readTarget } = NS.gl;

  const SIZE = { low: 192, medium: 256, high: 384, ultra: 512 };
  let programs = null;

  class Pool {
    constructor(gl, scene, settings) {
      this.gl = gl; this.scene = scene; this.settings = settings;
      if (!programs) {
        const S = NS.shaders;
        programs = {};
        for (const [name, body] of Object.entries(S.pool)) programs[name] = new Program(gl, S.VERT, S.frag(scene, body));
      }
      this.p = programs;
      this.time = 0; this.rainClock = 0;
    }

    resize(width, height) {
      const gl = this.gl;
      this.dispose();
      this.size = [width, height];
      this.aspect = width / height;
      this.simH = SIZE[this.settings.quality] || SIZE.high;
      this.simW = Math.round(this.simH * this.aspect);
      this.water = createDouble(gl, this.simW, this.simH, gl.LINEAR, true);
      this.curl = createTarget(gl, this.simW, this.simH, gl.NEAREST);
      this.time = 0;
    }

    reset() { this.resize(...this.size); }

    common() { return { texel: this.water.texel, uAspect: this.aspect, uTime: this.time, uCPU: this.simH, uInit: 0 }; }

    drop(x, y, amount, radius) {
      const w = this.water;
      pass(this.gl, this.p.SPLAT, { ...this.common(), uTarget: w.read, uPoint: [x, y], uColor: [-amount, 0, 0, 0], uRadius: radius }, w.write); w.swap();
    }

    step(dt, splats) {
      const gl = this.gl, P = this.p, w = this.water, s = this.scene, st = this.settings;
      const c = s.waveSpeed * this.simH;                 // wave speed, cells/s
      const n = Math.max(1, Math.ceil((c * dt) / 0.35)); // keep the CFL number below 0.35
      const h = dt / n;

      if (st.rain) {
        this.rainClock -= dt;
        while (this.rainClock < 0) {
          this.rainClock += 0.12 + Math.random() * 0.45;
          this.drop(Math.random() * this.aspect, Math.random(), 0.3 + Math.random() * 0.6, 0.0001 + Math.random() * 0.0002);
        }
      }
      for (const sp of splats) {
        pass(gl, P.SPLAT, { ...this.common(), uTarget: w.read, uPoint: [sp.x, sp.y], uColor: [0, sp.dx * this.simH * 0.5, sp.dy * this.simH * 0.5, 0], uRadius: sp.radius }, w.write); w.swap();
        if (sp.down || Math.random() < 0.35) this.drop(sp.x, sp.y, sp.down ? 1.2 : 0.35, sp.down ? 0.00012 : 0.00005);
      }

      const nu = s.viscosity * st.viscosity * this.simH * this.simH;
      for (let i = 0; i < n; i++) {
        pass(gl, P.POOL_VEL, { ...this.common(), uW: w.read, dt: h, uG: c * c, uNu: nu, uDamp: s.damping }, w.write); w.swap();
        pass(gl, P.POOL_HEIGHT, { ...this.common(), uW: w.read, dt: h, uH: 1 }, w.write); w.swap();
        this.time += h;
      }
      pass(gl, P.POOL_CURL, { ...this.common(), uW: w.read }, this.curl);
    }

    render(mode) {
      const c = this.scene.waveSpeed * this.simH;
      pass(this.gl, this.p.POOL_DISPLAY, {
        ...this.common(), uW: this.water.read, uCurl: this.curl, uMode: mode,
        uScales: [c * 0.15, 4.0, 0.15], uNormal: this.simH * 0.03, uCaustic: this.simH * this.simH * 0.0004,
      }, null);
    }

    // Self-test: total water volume must stay constant (no rain), nothing blows up.
    measure() {
      const sum = () => { const d = readTarget(this.gl, this.water.read); let s = 0, nan = 0; for (let i = 0; i < d.length; i += 4) { if (Number.isFinite(d[i])) s += d[i]; else nan++; } return { s, nan }; };
      const rain = this.settings.rain;
      this.settings.rain = false;
      this.drop(this.aspect * 0.5, 0.5, 1.0, 0.0002);
      const before = sum();
      for (let i = 0; i < 120; i++) this.step(1 / 60, []);
      const after = sum();
      this.settings.rain = rain;
      return { volumeBefore: before.s, volumeAfter: after.s, volumeDrift: Math.abs(after.s - before.s) / Math.abs(before.s), nan: before.nan + after.nan };
    }

    dispose() {
      freeTarget(this.gl, this.water); freeTarget(this.gl, this.curl);
      this.water = this.curl = null;
    }
  }

  Pool.SIZE = SIZE;
  NS.Pool = Pool;
})();
