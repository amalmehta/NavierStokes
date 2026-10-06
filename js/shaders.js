// GLSL sources. Every fragment program = HEADER + scene GLSL + one pass body.
// Coordinates: vUv in [0,1]^2; scene space p = (vUv.x * aspect, vUv.y), so 1 unit = screen height.
// Velocities are stored in grid cells per second; uCPU (cells per unit) converts.
(function () {
  const NS = (window.NS = window.NS || {});

  const VERT = `#version 300 es
in vec2 aPos;
uniform vec2 texel;
out vec2 vUv; out vec2 vL; out vec2 vR; out vec2 vT; out vec2 vB;
void main() {
  vUv = aPos * 0.5 + 0.5;
  vL = vUv - vec2(texel.x, 0.0); vR = vUv + vec2(texel.x, 0.0);
  vT = vUv + vec2(0.0, texel.y); vB = vUv - vec2(0.0, texel.y);
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

  const HEADER = `#version 300 es
precision highp float;
precision highp sampler2D;
in vec2 vUv; in vec2 vL; in vec2 vR; in vec2 vT; in vec2 vB;
out vec4 fragColor;
uniform vec2 texel;
uniform float uAspect;  // width / height
uniform float uTime;    // simulated seconds
uniform float uCPU;     // grid cells per unit length
uniform float uInit;    // 1 on the first frame of a scene
vec2 P(vec2 uv) { return vec2(uv.x * uAspect, uv.y); }
float hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1, 0)), u.x), mix(hash12(i + vec2(0, 1)), hash12(i + vec2(1, 1)), u.x), u.y);
}
float fbm(vec2 p) { float s = 0.0, a = 0.5; for (int i = 0; i < 4; i++) { s += a * vnoise(p); p *= 2.03; a *= 0.5; } return s; }
`;

  // ---------- incompressible solver passes ----------
  // Staggered (MAC) grid: texel (i,j) stores .x = u on the cell's right face, .y = v on its top face.
  // Divergence and pressure gradient are then compact one-cell differences, which exactly match the
  // 5-point pressure Laplacian, so a converged solve leaves the flow truly divergence-free.
  // Edge modes per side (L, R, B, T): 0 = wall, 1 = open (p = 0), 2 = inflow (zero-gradient velocity).
  const SOLID = `uniform sampler2D uObs;
uniform vec4 uEdge;
bool solid(vec2 uv) { return texture(uObs, uv).r > 0.5; }
// Zero any face that touches a solid cell or a closed right/top domain wall.
vec2 maskFaces(vec2 v) {
  if (solid(vUv) || solid(vR) || (vR.x > 1.0 && uEdge.y < 0.5)) v.x = 0.0;
  if (solid(vUv) || solid(vT) || (vT.y > 1.0 && uEdge.w < 0.5)) v.y = 0.0;
  return v;
}
`;

  // Velocity at any point (in cell-centre uv space) from the staggered texture.
  const SAMPLE_VEL = `uniform vec2 uSimTexel;
vec2 sampleVel(sampler2D tex, vec2 uv) {
  return vec2(texture(tex, uv - vec2(0.5 * uSimTexel.x, 0.0)).x, texture(tex, uv - vec2(0.0, 0.5 * uSimTexel.y)).y);
}
`;

  const OBSTACLE = `void main() { fragColor = vec4(sceneSDF(P(vUv)) < 0.0 ? 1.0 : 0.0, 0, 0, 1); }`;

  // Viscous diffusion (explicit) + scene body forces + inflow.
  const FORCE = SOLID + `uniform sampler2D uVel, uDye;
uniform float dt, uNu;
void main() {
  vec2 v = texture(uVel, vUv).xy;
  vec2 lap = texture(uVel, vL).xy + texture(uVel, vR).xy + texture(uVel, vB).xy + texture(uVel, vT).xy - 4.0 * v;
  v += min(uNu * dt, 0.2) * lap;
  v = sceneForce(P(vUv), v, texture(uDye, vUv).a, dt);
  fragColor = vec4(maskFaces(v), 0, 1);
}`;

  // Vorticity at the cell's top-right corner.
  const CURL = `uniform sampler2D uVel;
void main() {
  vec2 C = texture(uVel, vUv).xy;
  fragColor = vec4((texture(uVel, vR).y - C.y) - (texture(uVel, vT).x - C.x), 0, 0, 1);
}`;

  // Vorticity confinement: puts back small swirls that the grid smears out.
  const VORTICITY = SOLID + `uniform sampler2D uVel, uCurl;
uniform float uCurlStrength, dt;
void main() {
  float L = texture(uCurl, vL).x, R = texture(uCurl, vR).x, T = texture(uCurl, vT).x, B = texture(uCurl, vB).x, C = texture(uCurl, vUv).x;
  vec2 f = 0.5 * vec2(abs(T) - abs(B), abs(R) - abs(L));
  f /= length(f) + 1e-4;
  f *= uCurlStrength * C; f.y *= -1.0;
  vec2 v = texture(uVel, vUv).xy + f * dt;
  fragColor = vec4(maskFaces(clamp(v, -6e4, 6e4)), 0, 1);
}`;

  // ∇·u per cell (minus any scene source such as a drain).
  const DIVERGENCE = SOLID + `uniform sampler2D uVel;
void main() {
  vec2 C = texture(uVel, vUv).xy;
  float uL = texture(uVel, vL).x, vB_ = texture(uVel, vB).y;
  if (vL.x < 0.0) uL = uEdge.x < 0.5 ? 0.0 : C.x;
  if (vB.y < 0.0) vB_ = uEdge.z < 0.5 ? 0.0 : C.y;
  if (solid(vL)) uL = 0.0; if (solid(vB)) vB_ = 0.0;
  if (solid(vR)) C.x = 0.0; if (solid(vT)) C.y = 0.0;
  if (vR.x > 1.0 && uEdge.y < 0.5) C.x = 0.0; if (vT.y > 1.0 && uEdge.w < 0.5) C.y = 0.0;
  fragColor = vec4((C.x - uL) + (C.y - vB_) - sceneSource(P(vUv)), 0, 0, 1);
}`;

  // Ghost pressures: walls, inflow and solids reflect (no flow through); open edges hold p = 0 on the face.
  const PRESSURE_NEIGHBOURS = `uniform sampler2D uP;
float ghost(float mode, float pC) { return (mode > 0.5 && mode < 1.5) ? -pC : pC; }
void neighbours(out float C, out float L, out float R, out float B, out float T) {
  C = texture(uP, vUv).x;
  L = texture(uP, vL).x; R = texture(uP, vR).x; B = texture(uP, vB).x; T = texture(uP, vT).x;
  if (vL.x < 0.0) L = ghost(uEdge.x, C);
  if (vR.x > 1.0) R = ghost(uEdge.y, C);
  if (vB.y < 0.0) B = ghost(uEdge.z, C);
  if (vT.y > 1.0) T = ghost(uEdge.w, C);
  if (solid(vL)) L = C; if (solid(vR)) R = C; if (solid(vB)) B = C; if (solid(vT)) T = C;
}
`;

  // Pressure Poisson equation ∇²p = ∇·u, solved by multigrid V-cycles (see Fluid.vcycle).
  // The same passes run on every grid level; uObs and texel are that level's.
  // Weighted-Jacobi smoothing sweep.
  const PRESSURE = SOLID + PRESSURE_NEIGHBOURS + `uniform sampler2D uDiv;
uniform float uOmega;
void main() {
  float C, L, R, B, T; neighbours(C, L, R, B, T);
  fragColor = vec4(mix(C, 0.25 * (L + R + B + T - texture(uDiv, vUv).x), uOmega), 0, 0, 1);
}`;

  // r = b − ∇²p
  const RESIDUAL = SOLID + PRESSURE_NEIGHBOURS + `uniform sampler2D uDiv;
void main() {
  float C, L, R, B, T; neighbours(C, L, R, B, T);
  float r = texture(uDiv, vUv).x - (L + R + B + T - 4.0 * C);
  fragColor = vec4(solid(vUv) ? 0.0 : r, 0, 0, 1);
}`;

  // Fine residual → coarse right-hand side. Bilinear sampling at the coarse cell centre averages
  // the 2×2 fine block; ×4 because the coarse cells are twice as wide.
  const RESTRICT = `uniform sampler2D uSrc;
void main() { fragColor = vec4(4.0 * texture(uSrc, vUv).x, 0, 0, 1); }`;

  // Coarse correction → fine pressure.
  const PROLONG = `uniform sampler2D uP, uE;
void main() { fragColor = vec4(texture(uP, vUv).x + texture(uE, vUv).x, 0, 0, 1); }`;

  // Coarse solid mask: solid where most of the fine block is solid.
  const OBS_DOWN = `uniform sampler2D uSrc;
void main() { fragColor = vec4(texture(uSrc, vUv).r > 0.5 ? 1.0 : 0.0, 0, 0, 1); }`;

  // u -= ∇p on each face.
  const GRADIENT = SOLID + PRESSURE_NEIGHBOURS + `uniform sampler2D uVel;
void main() {
  float C, L, R, B, T; neighbours(C, L, R, B, T);
  vec2 v = texture(uVel, vUv).xy - vec2(R - C, T - C);
  fragColor = vec4(maskFaces(v), 0, 1);
}`;

  // Semi-Lagrangian advection of the velocity itself, each component from its own face position.
  const ADVECT_VEL = SOLID + SAMPLE_VEL + `uniform sampler2D uVel;
uniform float dt, uDiss;
void main() {
  vec2 hx = vec2(0.5 * uSimTexel.x, 0.0), hy = vec2(0.0, 0.5 * uSimTexel.y);
  vec2 pu = vUv + hx, pv = vUv + hy;
  float u = texture(uVel, pu - dt * sampleVel(uVel, pu) * uSimTexel - hx).x;
  float v = texture(uVel, pv - dt * sampleVel(uVel, pv) * uSimTexel - hy).y;
  fragColor = vec4(maskFaces(vec2(u, v) / (1.0 + uDiss * dt)), 0, 1);
}`;

  // Semi-Lagrangian advection of dye: trace back along the velocity, sample there.
  const ADVECT = SOLID + SAMPLE_VEL + `uniform sampler2D uVel, uSrc;
uniform float dt, uDiss;
void main() {
  vec4 r = texture(uSrc, vUv - dt * sampleVel(uVel, vUv) * uSimTexel) / (1.0 + uDiss * dt);
  if (solid(vUv)) r = vec4(0);
  fragColor = r;
}`;

  const DYE_SOURCE = `uniform sampler2D uDye;
uniform float dt;
void main() {
  vec2 p = P(vUv);
  vec4 d = sceneDye(p, texture(uDye, vUv), dt);
  if (sceneSDF(p) < 0.0) d = vec4(0);
  fragColor = min(d, vec4(3.0));
}`;

  const SPLAT = `uniform sampler2D uTarget;
uniform vec2 uPoint;
uniform vec4 uColor;
uniform float uRadius;
void main() {
  vec2 d = P(vUv) - uPoint;
  fragColor = texture(uTarget, vUv) + uColor * exp(-dot(d, d) / uRadius);
}`;

  const SCALE = `uniform sampler2D uSrc; uniform float uS;
void main() { fragColor = texture(uSrc, vUv) * uS; }`;

  const COLORMAPS = `
vec3 inferno(float t) {
  const vec3 c0 = vec3(0.00021894, 0.00165100, -0.01948090);
  const vec3 c1 = vec3(0.10651342, 0.56395644, 3.93271239);
  const vec3 c2 = vec3(11.60249308, -3.97285397, -15.94239411);
  const vec3 c3 = vec3(-41.70399613, 17.43639888, 44.35414520);
  const vec3 c4 = vec3(77.16293570, -33.40235894, -81.80730926);
  const vec3 c5 = vec3(-71.31942824, 32.62606426, 73.20951986);
  const vec3 c6 = vec3(25.13112622, -12.24266895, -23.07032500);
  t = clamp(t, 0.0, 1.0);
  return c0 + t * (c1 + t * (c2 + t * (c3 + t * (c4 + t * (c5 + t * c6)))));
}
vec3 diverge(float t) {
  t = clamp(t, -1.0, 1.0);
  float s = sqrt(abs(t));
  vec3 mid = vec3(0.05, 0.06, 0.08);
  return t < 0.0 ? mix(mid, vec3(0.20, 0.55, 1.00), s) : mix(mid, vec3(1.00, 0.42, 0.22), s);
}
`;

  // Final image. uMode: 0 water, 1 speed, 2 vorticity, 3 pressure.
  const DISPLAY = COLORMAPS + SAMPLE_VEL + `uniform sampler2D uDye, uVel, uP, uCurl;
uniform int uMode;
uniform vec2 uDyeTexel;
uniform vec3 uScales; // speed, vorticity, pressure
float rockHeight(vec2 q) { return sqrt(clamp(-sceneSDF(q) * 14.0, 0.0, 1.0)) + 0.10 * fbm(q * 34.0); }
vec3 solidColor(vec2 p) {
  float e = 0.0015;
  float gx = (rockHeight(p + vec2(e, 0)) - rockHeight(p - vec2(e, 0))) / (2.0 * e);
  float gy = (rockHeight(p + vec2(0, e)) - rockHeight(p - vec2(0, e))) / (2.0 * e);
  vec3 n = normalize(vec3(-gx * 0.03, -gy * 0.03, 1.0));
  vec3 l = normalize(vec3(-0.5, 0.6, 0.65));
  float diff = clamp(dot(n, l), 0.0, 1.0);
  float spec = pow(clamp(dot(reflect(-l, n), vec3(0, 0, 1)), 0.0, 1.0), 24.0);
  vec3 base = sceneSolid(p) * (0.65 + 0.6 * fbm(p * 14.0));
  return base * (0.25 + 0.95 * diff) + spec * 0.18;
}
float lum(vec3 c) { return dot(c, vec3(0.3, 0.5, 0.2)); }
void main() {
  vec2 p = P(vUv);
  float sdf = sceneSDF(p);
  float aa = max(fwidth(sdf), 1e-4) * 1.2;
  vec3 col;
  if (uMode == 0) {
    vec4 d = texture(uDye, vUv);
    float hx = lum(texture(uDye, vUv + vec2(uDyeTexel.x, 0)).rgb - texture(uDye, vUv - vec2(uDyeTexel.x, 0)).rgb);
    float hy = lum(texture(uDye, vUv + vec2(0, uDyeTexel.y)).rgb - texture(uDye, vUv - vec2(0, uDyeTexel.y)).rgb);
    vec3 n = normalize(vec3(-hx * 2.5, -hy * 2.5, 1.0));
    vec3 l = normalize(vec3(-0.4, 0.6, 0.7));
    float diff = clamp(dot(n, l), 0.0, 1.0);
    float spec = pow(clamp(dot(reflect(-l, n), vec3(0, 0, 1)), 0.0, 1.0), 40.0);
    col = sceneBackground(p) + d.rgb;
    col = 1.0 - exp(-col * 1.4);
    col *= 0.8 + 0.3 * diff;
    col += spec * 0.3;
    col *= mix(1.0, 0.7, smoothstep(0.014, 0.0, sdf));  // wet shadow beside solids
  } else if (uMode == 1) {
    col = inferno(length(sampleVel(uVel, vUv)) / uScales.x);
  } else if (uMode == 2) {
    col = diverge(texture(uCurl, vUv).x / uScales.y);
  } else {
    col = diverge(texture(uP, vUv).x / uScales.z);
  }
  if (sdf < aa) col = mix(col, solidColor(p), smoothstep(aa, -aa, sdf));
  vec4 dec = sceneDecor(p);
  col = mix(col, dec.rgb, dec.a);
  vec2 c = vUv - 0.5;
  col *= 1.0 - 0.35 * dot(c, c);
  fragColor = vec4(col, 1.0);
}`;

  // ---------- shallow-water pool (depth-averaged Navier–Stokes) ----------
  // State texture: r = surface height eta, g = u, b = v. Staggered storage:
  // u at the cell's right face, v at its top face (no checkerboard modes).
  const POOL_VEL = `uniform sampler2D uW;
uniform float dt, uG, uNu, uDamp;
void main() {
  vec4 C = texture(uW, vUv);
  vec2 v = texture(uW, vUv - dt * C.yz * texel).yz;  // advection (u . grad) u
  vec2 lap = texture(uW, vL).yz + texture(uW, vR).yz + texture(uW, vB).yz + texture(uW, vT).yz - 4.0 * C.yz;
  v += min(uNu * dt, 0.2) * lap;                         // viscosity
  v -= dt * uG * vec2(texture(uW, vR).x - C.x, texture(uW, vT).x - C.x);  // pressure: -g grad eta
  v /= 1.0 + uDamp * dt;                                 // bottom friction
  if (vR.x > 1.0) v.x = 0.0;
  if (vT.y > 1.0) v.y = 0.0;
  fragColor = vec4(C.x, v, 1);
}`;

  const POOL_HEIGHT = `uniform sampler2D uW;
uniform float dt, uH;
void main() {
  vec4 C = texture(uW, vUv);
  float uL = vL.x < 0.0 ? 0.0 : texture(uW, vL).y;
  float vB_ = vB.y < 0.0 ? 0.0 : texture(uW, vB).z;
  float div = (C.y - uL) + (C.z - vB_);
  fragColor = vec4(C.x - dt * uH * div, C.yz, 1);  // mass conservation
}`;

  const POOL_CURL = `uniform sampler2D uW;
void main() {
  float L = texture(uW, vL).z, R = texture(uW, vR).z, T = texture(uW, vT).y, B = texture(uW, vB).y;
  fragColor = vec4(0.5 * (R - L - T + B), 0, 0, 1);
}`;

  const POOL_DISPLAY = COLORMAPS + `uniform sampler2D uW, uCurl;
uniform int uMode;
uniform vec3 uScales; // speed, vorticity, height
uniform float uNormal, uCaustic;
void main() {
  vec2 p = P(vUv);
  vec4 C = texture(uW, vUv);
  float eL = texture(uW, vL).x, eR = texture(uW, vR).x, eB = texture(uW, vB).x, eT = texture(uW, vT).x;
  vec3 col;
  if (uMode == 0) {
    vec2 g = 0.5 * vec2(eR - eL, eT - eB);
    float lap = eL + eR + eB + eT - 4.0 * C.x;
    vec3 n = normalize(vec3(-g * uNormal, 1.0));
    vec2 q = p + n.xy * 0.05;
    // pool floor tiles seen through the refracting surface
    vec2 tp = q * 12.0;
    vec2 f = abs(fract(tp) - 0.5);
    float grout = smoothstep(0.455, 0.49, max(f.x, f.y));
    vec3 tile = mix(vec3(0.52, 0.84, 0.92), vec3(0.80, 0.95, 0.98), hash12(floor(tp)) * 0.35);
    vec3 floorC = mix(tile, vec3(0.20, 0.45, 0.55), grout);
    float lane = smoothstep(0.05, 0.03, abs(fract(q.x * 1.5) - 0.5));
    floorC = mix(floorC, vec3(0.07, 0.17, 0.35), lane * 0.85);
    col = mix(floorC, vec3(0.02, 0.38, 0.56), 0.45);
    // caustics: crests focus sunlight onto the floor
    float ambient = pow(1.0 - abs(vnoise(q * 14.0 + uTime * 0.4) * 2.0 - 1.0), 6.0);
    col += vec3(0.85, 1.0, 1.0) * (clamp(-lap * uCaustic, -0.4, 1.4) * 0.45 + ambient * 0.12);
    vec3 l = normalize(vec3(0.45, 0.55, 1.0));
    float spec = pow(max(dot(reflect(-l, n), vec3(0, 0, 1)), 0.0), 140.0);
    float fres = pow(1.0 - n.z, 3.0);
    col = mix(col, vec3(0.85, 0.94, 1.0), clamp(fres * 6.0, 0.0, 0.6));
    col += spec * 1.4;
  } else if (uMode == 1) {
    col = inferno(length(C.yz) / uScales.x);
  } else if (uMode == 2) {
    col = diverge(texture(uCurl, vUv).x / uScales.y);
  } else {
    col = diverge(C.x / uScales.z);
  }
  vec2 c = vUv - 0.5;
  col *= 1.0 - 0.35 * dot(c, c);
  fragColor = vec4(col, 1.0);
}`;

  // Defaults for scene hooks a scene leaves out.
  const SCENE_DEFAULTS = {
    sdf: 'float sceneSDF(vec2 p) { return 1.0; }',
    force: 'vec2 sceneForce(vec2 p, vec2 v, float dens, float dt) { return v; }',
    source: 'float sceneSource(vec2 p) { return 0.0; }',
    dye: 'vec4 sceneDye(vec2 p, vec4 d, float dt) { return d; }',
    background: 'vec3 sceneBackground(vec2 p) { return vec3(0.01, 0.05, 0.08); }',
    solid: 'vec3 sceneSolid(vec2 p) { return vec3(0.36, 0.34, 0.31); }',
    decor: 'vec4 sceneDecor(vec2 p) { return vec4(0); }',
  };

  function sceneGLSL(scene) {
    const g = scene.glsl || {};
    return (g.helpers || '') + '\n' + Object.keys(SCENE_DEFAULTS).map((k) => g[k] || SCENE_DEFAULTS[k]).join('\n') + '\n';
  }

  function frag(scene, body) { return HEADER + sceneGLSL(scene) + body; }

  NS.shaders = {
    VERT, frag,
    fluid: { OBSTACLE, FORCE, CURL, VORTICITY, DIVERGENCE, PRESSURE, RESIDUAL, RESTRICT, PROLONG, OBS_DOWN, GRADIENT, ADVECT_VEL, ADVECT, DYE_SOURCE, SPLAT, SCALE, DISPLAY },
    pool: { POOL_VEL, POOL_HEIGHT, POOL_CURL, POOL_DISPLAY, SPLAT },
  };
})();
