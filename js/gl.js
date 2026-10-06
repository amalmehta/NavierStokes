// Small WebGL 2 toolkit: context, shader programs, render targets, full-screen passes.
(function () {
  const NS = (window.NS = window.NS || {});

  function createGL(canvas) {
    const gl = canvas.getContext('webgl2', {
      alpha: false, depth: false, stencil: false, antialias: false,
      preserveDrawingBuffer: true, // lets screenshots read the canvas
    });
    if (!gl) throw new Error('This browser does not support WebGL 2.');
    if (!gl.getExtension('EXT_color_buffer_float')) {
      throw new Error('This GPU cannot render to floating-point textures (EXT_color_buffer_float).');
    }
    gl.floatLinear = !!gl.getExtension('OES_texture_float_linear');

    // One quad covering the screen, shared by every pass.
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.disable(gl.BLEND);
    return gl;
  }

  function compile(gl, type, src) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      const log = gl.getShaderInfoLog(s);
      const numbered = src.split('\n').map((l, i) => String(i + 1).padStart(4) + ' ' + l).join('\n');
      console.error(log + '\n' + numbered);
      throw new Error('Shader compile failed: ' + log);
    }
    return s;
  }

  class Program {
    constructor(gl, vsrc, fsrc) {
      this.gl = gl;
      const p = gl.createProgram();
      gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, vsrc));
      gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fsrc));
      gl.bindAttribLocation(p, 0, 'aPos');
      gl.linkProgram(p);
      if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
        throw new Error('Program link failed: ' + gl.getProgramInfoLog(p));
      }
      this.prog = p;
      this.uniforms = {};
      const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
      for (let i = 0; i < n; i++) {
        const info = gl.getActiveUniform(p, i);
        this.uniforms[info.name] = { loc: gl.getUniformLocation(p, info.name), type: info.type };
      }
    }

    // Uniforms the shader optimised away are silently skipped.
    set(values) {
      const gl = this.gl;
      let unit = 0;
      for (const name in values) {
        const u = this.uniforms[name];
        if (!u) continue;
        const v = values[name];
        switch (u.type) {
          case gl.SAMPLER_2D:
            gl.activeTexture(gl.TEXTURE0 + unit);
            gl.bindTexture(gl.TEXTURE_2D, v.tex || v);
            gl.uniform1i(u.loc, unit++);
            break;
          case gl.FLOAT: gl.uniform1f(u.loc, v); break;
          case gl.INT: case gl.BOOL: gl.uniform1i(u.loc, v); break;
          case gl.FLOAT_VEC2: gl.uniform2fv(u.loc, v); break;
          case gl.FLOAT_VEC3: gl.uniform3fv(u.loc, v); break;
          case gl.FLOAT_VEC4: gl.uniform4fv(u.loc, v); break;
        }
      }
    }
  }

  function createTarget(gl, w, h, filter, precise) {
    // precise = 32-bit floats (pressure, pool height); otherwise half floats to save bandwidth.
    const full = precise && (filter === gl.NEAREST || gl.floatLinear);
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, full ? gl.RGBA32F : gl.RGBA16F, w, h, 0, gl.RGBA, full ? gl.FLOAT : gl.HALF_FLOAT, null);
    const fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    gl.viewport(0, 0, w, h);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    return { tex, fbo, w, h, texel: [1 / w, 1 / h] };
  }

  function createDouble(gl, w, h, filter, precise) {
    const d = { read: createTarget(gl, w, h, filter, precise), write: createTarget(gl, w, h, filter, precise) };
    d.swap = () => { const t = d.read; d.read = d.write; d.write = t; };
    d.w = w; d.h = h; d.texel = [1 / w, 1 / h];
    return d;
  }

  function freeTarget(gl, t) {
    if (!t) return;
    if (t.read) { freeTarget(gl, t.read); freeTarget(gl, t.write); return; }
    gl.deleteTexture(t.tex);
    gl.deleteFramebuffer(t.fbo);
  }

  // Run a program over the whole of `target` (null = the screen).
  function pass(gl, program, uniforms, target) {
    gl.useProgram(program.prog);
    program.set(uniforms);
    if (target) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, target.fbo);
      gl.viewport(0, 0, target.w, target.h);
    } else {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
    }
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  function readTarget(gl, t) {
    const out = new Float32Array(t.w * t.h * 4);
    gl.bindFramebuffer(gl.FRAMEBUFFER, t.fbo);
    gl.readPixels(0, 0, t.w, t.h, gl.RGBA, gl.FLOAT, out);
    return out;
  }

  NS.gl = { createGL, Program, createTarget, createDouble, freeTarget, pass, readTarget };
})();
