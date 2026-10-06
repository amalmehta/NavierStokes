// The five demos. Each fluid scene is a set of GLSL hooks plugged into the shared solver
// (see shaders.js): sceneSDF (solids), sceneForce (body forces, inflow), sceneSource
// (mass sinks), sceneDye (where colour enters), sceneBackground / sceneSolid / sceneDecor (looks).
// Lengths are in screen heights ("units"); multiply speeds by uCPU to get cells per second.
(function () {
  const NS = (window.NS = window.NS || {});

  const NS_EQ = {
    lines: ['∂<b>u</b>/∂t + (<b>u</b>·∇)<b>u</b> = −∇p/ρ + ν∇²<b>u</b> + <b>f</b>', '∇·<b>u</b> = 0'],
    terms: [['(<b>u</b>·∇)<b>u</b>', 'advection — the flow carries itself'], ['−∇p/ρ', 'pressure — keeps water incompressible'],
      ['ν∇²<b>u</b>', 'viscosity — smooths velocity'], ['<b>f</b>', 'body forces — gravity, stirring']],
  };

  const INLET = 'bool inlet(vec2 p) { return p.x < 2.5 / uCPU; }\n';

  const scenes = [
    {
      id: 'river', name: 'River & Rocks', kind: 'fluid',
      blurb: 'Water enters from the left, splits around rocks and sheds eddies and foam downstream. Drag to stir.',
      eq: NS_EQ, eqNote: 'Inflow on the left, open outlet on the right, banks and rocks are solid walls.',
      edges: [2, 1, 0, 0], speed: 0.32, viscosity: 1.5e-5, vorticity: 22, dyeDiss: 0.04, velDiss: 0.0,
      splat: () => [0.45, 0.55, 0.6, 0],
      glsl: {
        helpers: INLET + `
float banks(vec2 p) {
  float top = 0.87 + 0.035 * sin(p.x * 3.7 + 1.0) + 0.04 * (fbm(vec2(p.x * 5.0, 1.3)) - 0.5);
  float bot = 0.13 + 0.035 * sin(p.x * 2.9) + 0.04 * (fbm(vec2(p.x * 5.0, 7.1)) - 0.5);
  return min(top - p.y, p.y - bot);
}
float rock(vec2 p, vec2 c, float r) { return length(p - c) - r - 0.018 * (fbm((p - c) * 22.0 + c * 9.0) - 0.5); }
float rocks(vec2 p) {
  float A = uAspect;
  float d = rock(p, vec2(0.27 * A, 0.56), 0.055);
  d = min(d, rock(p, vec2(0.43 * A, 0.33), 0.045));
  d = min(d, rock(p, vec2(0.58 * A, 0.66), 0.06));
  d = min(d, rock(p, vec2(0.76 * A, 0.41), 0.042));
  d = min(d, rock(p, vec2(0.38 * A, 0.77), 0.028));
  d = min(d, rock(p, vec2(0.88 * A, 0.72), 0.03));
  return d;
}`,
        sdf: 'float sceneSDF(vec2 p) { return min(banks(p), rocks(p)); }',
        force: `vec2 sceneForce(vec2 p, vec2 v, float dens, float dt) {
  if (inlet(p)) {
    float wob = 1.0 + 0.12 * sin(uTime * 2.3 + p.y * 23.0);
    v = vec2(0.32 * uCPU * smoothstep(0.0, 0.06, banks(p)) * wob, 0.0);
  }
  return v;
}`,
        dye: `vec4 sceneDye(vec2 p, vec4 d, float dt) {
  if (inlet(p)) {
    float s = fbm(vec2(p.y * 16.0, uTime * 1.2));
    vec3 c = mix(vec3(0.0, 0.08, 0.14), vec3(0.03, 0.26, 0.34), s);
    c += smoothstep(0.6, 0.74, fbm(vec2(p.y * 34.0, uTime * 2.0))) * vec3(0.65, 0.75, 0.8);
    d = vec4(c, 1.0);
  }
  float r = rocks(p);
  if (r > 0.0 && r < 0.012) d.rgb += vec3(0.9, 0.95, 1.0) * dt * 2.2 * (0.4 + fbm(p * 60.0 + uTime));
  return d;
}`,
        background: 'vec3 sceneBackground(vec2 p) { return vec3(0.005, 0.045, 0.07) + 0.02 * fbm(p * 3.0); }',
        solid: `vec3 sceneSolid(vec2 p) {
  return banks(p) < 0.0 ? mix(vec3(0.20, 0.27, 0.13), vec3(0.33, 0.28, 0.2), fbm(p * 8.0)) : vec3(0.40, 0.37, 0.34);
}`,
      },
    },
    {
      id: 'vortex', name: 'Vortex Street', kind: 'fluid',
      blurb: 'Steady flow past a cylinder rolls up into alternating eddies — a von Kármán vortex street, the same pattern behind bridge piers and islands.',
      eq: NS_EQ, eqNote: 'Uniform inflow, open outlet, slip walls top and bottom. Dye is released from the cylinder surface.',
      edges: [2, 1, 0, 0], speed: 0.35, viscosity: 2e-5, vorticity: 8, dyeDiss: 0.12, velDiss: 0.0,
      cylinder: { r: 0.055 }, // for the Reynolds number readout
      splat: () => { const h = Math.random(); return [0.6 + 0.4 * h, 0.4, 1.0 - 0.6 * h, 0]; },
      glsl: {
        helpers: INLET + `
vec2 cylC() { return vec2(min(0.32, 0.22 * uAspect), 0.5); }
const float CR = 0.055;`,
        sdf: 'float sceneSDF(vec2 p) { return length(p - cylC()) - CR; }',
        force: `vec2 sceneForce(vec2 p, vec2 v, float dens, float dt) {
  if (inlet(p)) v = vec2(0.35 * uCPU, 0.0);
  // brief nudge so the wake breaks symmetry and starts shedding
  if (uTime < 1.0 && length(p - cylC() - vec2(2.5 * CR, 0.0)) < CR) v.y += 0.08 * uCPU;
  return v;
}`,
        dye: `vec4 sceneDye(vec2 p, vec4 d, float dt) {
  if (inlet(p)) d = vec4(vec3(0.35, 0.4, 0.45) * smoothstep(0.82, 0.9, fract(p.y * 16.0)), 0.0);
  float r = length(p - cylC()) - CR;
  if (r > 0.0 && r < 0.008) d.rgb += (p.y > cylC().y ? vec3(1.0, 0.42, 0.12) : vec3(0.12, 0.55, 1.0)) * dt * 9.0;
  return d;
}`,
        background: 'vec3 sceneBackground(vec2 p) { return vec3(0.01, 0.018, 0.03); }',
        solid: 'vec3 sceneSolid(vec2 p) { return vec3(0.55, 0.57, 0.6); }',
      },
    },
    {
      id: 'faucet', name: 'Faucet Plunge', kind: 'fluid',
      blurb: 'A stream from a faucet plunges into a tank, rolls up into mushroom vortices and spreads along the bottom. Seen through the glass.',
      eq: NS_EQ, eqNote: 'Glass walls on three sides; the jet enters at the surface. f = −g·ρ′: the aerated stream is pulled down.',
      edges: [0, 0, 0, 1], speed: 0.5, viscosity: 1e-5, vorticity: 18, dyeDiss: 0.18, velDiss: 0.0,
      splat: () => [0.35, 0.55, 0.65, 0.2],
      glsl: {
        helpers: `
const float SURF = 0.9;
float nozzleX() { return uAspect * 0.5 + 0.06 * min(uAspect, 1.0) * sin(uTime * 0.45); }
bool jet(vec2 p) { return abs(p.x - nozzleX()) < 0.017 && p.y > SURF - 0.01; }`,
        force: `vec2 sceneForce(vec2 p, vec2 v, float dens, float dt) {
  v.y -= 0.35 * uCPU * dens * dt;            // gravity on the denser, bubbly stream
  if (jet(p)) v = vec2(0.0, -0.55 * uCPU);
  return v;
}`,
        dye: `vec4 sceneDye(vec2 p, vec4 d, float dt) {
  if (jet(p)) d = vec4(vec3(0.7, 0.88, 1.0) * (0.55 + 0.6 * vnoise(vec2(p.x * 90.0, p.y * 60.0 + uTime * 25.0))), 1.0);
  return d;
}`,
        background: `vec3 sceneBackground(vec2 p) {
  vec3 c = mix(vec3(0.01, 0.06, 0.11), vec3(0.03, 0.15, 0.22), p.y);
  float glare = smoothstep(0.02, 0.0, abs(fract((p.x + p.y * 0.6) * 1.3) - 0.2)) * 0.03;
  return c + glare;
}`,
        decor: `vec4 sceneDecor(vec2 p) {
  vec4 o = vec4(0);
  float wave = 0.004 * sin(p.x * 40.0 - uTime * 3.0) + 0.003 * sin(p.x * 23.0 + uTime * 2.0);
  float s = SURF + wave;
  if (p.y > s) {
    o = vec4(mix(vec3(0.62, 0.68, 0.72), vec3(0.85, 0.88, 0.9), (p.y - s) / (1.0 - s)), 1.0);
    float nx = nozzleX();
    // falling stream
    float w = 0.015 + 0.002 * sin(p.y * 90.0 + uTime * 30.0);
    if (abs(p.x - nx) < w) {
      float edge = abs(p.x - nx) / w;
      o.rgb = mix(vec3(0.92, 0.97, 1.0), vec3(0.55, 0.78, 0.92), edge * edge) + 0.08 * vnoise(vec2(p.x * 400.0, p.y * 60.0 - uTime * 30.0));
    }
    // chrome spout
    if (p.y > 0.965 && abs(p.x - nx) < 0.03) o.rgb = vec3(0.55, 0.58, 0.62) + 0.35 * smoothstep(0.03, 0.0, abs(p.x - nx + 0.01));
    if (p.y > 0.985 && p.x < nx + 0.03) o.rgb = vec3(0.5, 0.53, 0.57) + 0.3 * smoothstep(0.015, 0.0, abs(p.y - 0.993));
  } else {
    o = vec4(vec3(0.75, 0.9, 1.0), 0.5 * smoothstep(0.004, 0.0, s - p.y)); // meniscus line
  }
  return o;
}`,
      },
    },
    {
      id: 'whirlpool', name: 'Whirlpool Drain', kind: 'fluid',
      blurb: 'Water spirals into a drain. Pulling fluid inward spins it up (angular momentum is conserved), so the vortex tightens near the plughole.',
      eq: NS_EQ, eqNote: 'Mass leaves through the drain: ∇·u = −Q there. Open edges let water flow in; a weak swirl force f keeps it turning.',
      edges: [1, 1, 1, 1], speed: 0.6, viscosity: 1e-5, vorticity: 12, dyeDiss: 0.02, velDiss: 0.0,
      splat: () => [0.4, 0.55, 0.6, 0],
      glsl: {
        helpers: `
const float RD = 0.035;
vec2 drainC() { return vec2(0.5 * uAspect, 0.5); }
vec3 water(vec2 p) {
  vec2 q = p - drainC();
  vec2 dir = q / (length(q) + 1e-4);
  float foam = smoothstep(0.56, 0.78, fbm(dir * 2.5 + q * 5.0 + vec2(uTime * 0.25, -uTime * 0.18)));
  float tint = fbm(q * 4.0 + uTime * 0.05);
  return mix(vec3(0.0, 0.05, 0.1), vec3(0.02, 0.24, 0.32), tint) + foam * vec3(0.6, 0.7, 0.75);
}`,
        source: `float sceneSource(vec2 p) { return length(p - drainC()) < RD ? -40.0 : 0.0; }`,
        force: `vec2 sceneForce(vec2 p, vec2 v, float dens, float dt) {
  vec2 q = p - drainC();
  float r = length(q) + 1e-4;
  vec2 t = vec2(-q.y, q.x) / r;
  v += t * 0.02 * uCPU * (r / (r * r + 0.01)) * dt;
  return v / (1.0 + 0.35 * dt);
}`,
        dye: `vec4 sceneDye(vec2 p, vec4 d, float dt) {
  vec2 e = vec2(3.0 / uCPU);
  if (uInit > 0.5 || p.x < e.x || p.y < e.y || p.x > uAspect - e.x || p.y > 1.0 - e.y) d = vec4(water(p), 0.0);
  if (length(p - drainC()) < RD) d *= 1.0 - min(1.0, 6.0 * dt);
  return d;
}`,
        background: 'vec3 sceneBackground(vec2 p) { return vec3(0.004, 0.035, 0.06); }',
        decor: `vec4 sceneDecor(vec2 p) {
  vec2 q = p - drainC();
  float r = length(q);
  if (r > RD * 1.25) return vec4(0.0, 0.01, 0.02, 0.6 * smoothstep(0.25, RD, r)); // the funnel darkens toward the drain
  vec3 c = vec3(0.6, 0.62, 0.65) * (0.7 + 0.5 * smoothstep(RD * 1.25, RD, r));
  if (r < RD) {
    float bars = step(0.5, fract(q.x / RD * 3.0)) * step(abs(q.y), RD * 0.95);
    c = mix(vec3(0.01, 0.015, 0.02), vec3(0.45, 0.47, 0.5), bars * 0.85);
  }
  return vec4(c, smoothstep(RD * 1.25, RD * 1.2, r));
}`,
      },
    },
    {
      id: 'pool', name: 'Ripple Pool', kind: 'pool',
      blurb: 'Raindrops on a swimming pool. Tap or drag to make ripples. Waves travel, reflect off the walls and interfere; crests focus sunlight into caustics.',
      eq: {
        lines: ['∂<b>u</b>/∂t + (<b>u</b>·∇)<b>u</b> = −g∇η + ν∇²<b>u</b>', '∂η/∂t + H ∇·<b>u</b> = 0'],
        terms: [['η', 'surface height'], ['−g∇η', 'pressure from the sloping surface'], ['ν∇²<b>u</b>', 'viscosity'],
          ['H∇·<b>u</b>', 'mass: flow in raises the surface']],
      },
      eqNote: 'Shallow-water equations: Navier–Stokes averaged over the depth, so the free surface can move and carry waves.',
      speed: 0.25, waveSpeed: 0.35, viscosity: 2e-5, damping: 0.12,
    },
  ];

  NS.scenes = scenes;
})();
