/**
 * The star ball, in 3D: a glass ball whose panels are stars, lit like a
 * studio product shot and turning slowly. Drawn by a fragment shader, so it
 * is one quad and no textures.
 *
 * The geometry is the real ball's: twelve stars centred on the corners of an
 * icosahedron, each star's five points aimed at its five neighbours so the
 * tips meet. For any point on the ball the shader finds the nearest centre,
 * lays the point out flat around it and asks how far it is from a five-point
 * star there. The answer gives the panel, the seam and the glow along it.
 *
 * Only the stars are glass. The holes between them are empty, so the page
 * shows through them, and so do the stars on the far side, seen from behind.
 * The look, layer by layer:
 *   - the far side's stars, dimmer and bluer, through the holes and through
 *     the near stars' glass;
 *   - the near stars, glass slabs: royal blue, bright along the inside of
 *     their edges where the glass is seen through its thickness;
 *   - their outlines, a hairline of light whose colour shifts with the angle
 *     like oil on water (a thin-film cheat: a cosine palette);
 *   - a studio softbox reflected top left, a hard specular, and iridescence
 *     where the glass turns away.
 *
 * A reader without WebGL, or who asked for less motion, gets one still frame
 * (the image the page shows first anyway, public/brand/starball.webp).
 */

const PHI = (1 + Math.sqrt(5)) / 2;
const norm = (v) => { const l = Math.hypot(...v); return v.map((x) => x / l); };
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

// The twelve centres, and for each the direction of one neighbour in its
// tangent plane (the star's first point aims there; the other four follow at
// 72 degrees, which is exactly where the other neighbours are).
const CENTRES = [
  [0, 1, PHI], [0, -1, PHI], [0, 1, -PHI], [0, -1, -PHI],
  [1, PHI, 0], [-1, PHI, 0], [1, -PHI, 0], [-1, -PHI, 0],
  [PHI, 0, 1], [-PHI, 0, 1], [PHI, 0, -1], [-PHI, 0, -1],
].map(norm);
const AIMS = CENTRES.map((c) => {
  const near = CENTRES.filter((o) => o !== c).sort((p, q) => dot(q, c) - dot(p, c))[0];
  const d = dot(near, c);
  return norm([near[0] - c[0] * d, near[1] - c[1] * d, near[2] - c[2] * d]);
});

const VERT = `attribute vec2 a; varying vec2 vUv;
void main() { vUv = a; gl_Position = vec4(a, 0.0, 1.0); }`;

export const FRAG = `precision highp float;
varying vec2 vUv;
uniform vec3 uC[12];
uniform vec3 uU[12];
uniform mat3 uRot;
uniform float uScale;  // ball radius in clip units
uniform float uPx;     // one pixel in ball units

const float TIP = 0.6;     // tan of a star's point: the tips nearly meet at 0.618
const float INNER = 0.42; // inner corners, as a share of the points
const float ROUND = 0.014; // the glass is cut, then its points are softened

// A five-point star, its first point up the y axis (after Inigo Quilez).
float star(vec2 p, float r, float rf) {
  const vec2 k1 = vec2(0.809016994375, -0.587785252292);
  const vec2 k2 = vec2(-k1.x, k1.y);
  p.x = abs(p.x);
  p -= 2.0 * max(dot(k1, p), 0.0) * k1;
  p -= 2.0 * max(dot(k2, p), 0.0) * k2;
  p.x = abs(p.x);
  p.y -= r;
  vec2 ba = rf * vec2(-k1.y, k1.x) - vec2(0.0, 1.0);
  float h = clamp(dot(p, ba) / dot(ba, ba), 0.0, r);
  return length(p - ba * h) * sign(p.y * ba.x - p.x * ba.y);
}

// Distance to the nearest star's edge (negative inside), and how far into
// the star the point is (0 at the edge, 1 at the centre).
vec2 field(vec3 p) {
  float best = -2.0; int k = 0;
  vec3 c = uC[0]; vec3 u = uU[0];
  for (int i = 0; i < 12; i++) {
    float d = dot(p, uC[i]);
    if (d > best) { best = d; c = uC[i]; u = uU[i]; }
  }
  vec3 v = cross(c, u);
  vec3 t = p / best - c; // gnomonic: great circles stay straight
  vec2 q = vec2(dot(t, v), dot(t, u));
  float d = star(q, TIP - ROUND, INNER) - ROUND;
  return vec2(d, clamp(1.0 - length(q) / TIP, 0.0, 1.0));
}

vec3 film(float x) {
  // Oil on water: the hue walks round the wheel as x changes.
  return 0.55 + 0.45 * cos(6.2831 * (x + vec3(0.0, 0.33, 0.67)));
}

void main() {
  vec2 xy = vUv / uScale;
  float r = length(xy);
  if (r > 1.0) { gl_FragColor = vec4(0.0); return; }
  // Sampled from the competition's own night: the page is a deep ultramarine
  // (the hero's background, not drawn here); the glass runs from a blue
  // barely lighter than it to a bright azure where the light falls.
  vec3 dim = vec3(0.012, 0.03, 0.50);
  vec3 azure = vec3(0.02, 0.36, 0.92);
  vec3 pale = vec3(0.35, 0.58, 1.0);

  float z = sqrt(max(0.0, 1.0 - r * r));
  vec3 n = vec3(xy, z);    // the near side, facing us
  vec3 nb = vec3(xy, -z);  // the far side, seen through the holes
  float edgeOn = 1.0 - z;  // 0 facing us, 1 at the silhouette
  vec3 L = normalize(vec3(0.85, 0.2, 0.5)); // the light is off to the right
  float lit = smoothstep(-0.15, 0.95, dot(n, L));

  // The far side: the backs of the stars, through the holes and through the
  // near glass. Barely lighter than the night, with pale hairline edges.
  vec2 g = field(uRot * nb);
  float inB = smoothstep(uPx, -uPx, g.x);
  float lineB = exp(-pow(g.x / (uPx * 1.4 + 0.0025), 2.0));
  vec3 back = mix(dim, azure, 0.15 + 0.35 * lit) * inB * 0.45 + pale * lineB * 0.45;
  float backA = inB * 0.45 + lineB * 0.45;

  // The near side: glass slabs. The face takes the light from the right;
  // the slab's thickness shows as a lighter band inside every edge, wider
  // where the glass turns away (seen more side-on), closed by a second
  // hairline where the back face's edge shows through.
  vec2 f = field(uRot * n);
  float inN = smoothstep(uPx, -uPx, f.x);
  float depth = -f.x;
  float band = 0.01 + 0.05 * pow(edgeOn, 1.4);
  float side = smoothstep(band + uPx, band - uPx, depth) * inN;
  float backEdge = exp(-pow((depth - band) / (uPx * 1.3 + 0.002), 2.0)) * inN;
  vec3 face = mix(dim, azure, 0.06 + 0.94 * pow(lit, 1.4));
  face += azure * 0.25 * pow(max(0.0, dot(n, L)), 4.0);      // the wash on the lit side
  face += pale * 0.18 * pow(edgeOn, 3.0);                      // glass gets brighter edge-on
  vec3 sideC = mix(face, pale, 0.2 + 0.25 * lit);
  vec3 front = mix(face, sideC, side) + pale * backEdge * 0.35;
  float frontA = inN * (0.82 + 0.12 * edgeOn);

  // The cut edge: a hairline of light split as if through a prism. Each
  // stretch of edge has its own colour, mostly lime and yellow with red,
  // magenta and cyan between, and its own brightness, so the colour walks
  // along the edges as the ball turns. A slight fringe either side.
  vec3 pn = uRot * n;
  float phase = dot(pn, vec3(2.3, 1.7, 2.9)) + 0.6 * edgeOn;
  vec3 hue = clamp(abs(fract(phase + vec3(0.0, 0.67, 0.33)) * 6.0 - 3.0) - 1.0, 0.0, 1.0);
  hue = mix(hue, vec3(0.62, 1.0, 0.08), 0.3);  // lean towards lime, as the original does
  float w = uPx * 1.5 + 0.0022;
  float fringe = uPx * 1.4 + 0.003 * edgeOn;
  float lG = exp(-pow(f.x / w, 2.0));
  float lR = exp(-pow((f.x - fringe) / w, 2.0));
  float lB = exp(-pow((f.x + fringe) / w, 2.0));
  float strength = (0.55 + 0.45 * smoothstep(-0.3, 0.7, sin(dot(pn, vec3(3.7, -2.9, 2.2))))) * min(1.0, 0.8 + 0.5 * edgeOn);

  vec3 col = front * frontA + back * (1.0 - frontA);
  float a = frontA + backA * (1.0 - frontA);
  // The edge is painted, not added, so it keeps its colour instead of
  // washing out to white: the fringes first, then the core over them.
  float kR = lR * 0.45 * strength, kB = lB * 0.6 * strength, kG = lG * strength;
  col = mix(col, vec3(1.0, 0.12, 0.38) * max(a, kR), kR);
  col = mix(col, vec3(0.08, 0.55, 1.0) * max(a, kB), kB);
  a = max(a, max(kR, kB));
  a = max(a, kG);
  col = mix(col, hue * a, kG);
  // And the light it throws onto the glass around it.
  float halo = exp(-abs(f.x) / (0.006 + 0.01 * edgeOn)) * 0.4 * strength * (1.0 - kG);
  col += hue * halo;
  a = clamp(a + halo * 0.6, 0.0, 1.0);
  col = min(col, vec3(1.0));
  float disc = smoothstep(1.0, 1.0 - uPx * 2.0, r);
  gl_FragColor = vec4(min(col, vec3(a)) * disc, a * disc);
}`;

// The composition at rest, as on the competition's covers: a star a little
// left of centre and above, facing us, one point reaching up and to the left.
const cross3 = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const REST = (() => {
  const v0 = norm([-0.5, 0.16, 0.85]);
  const up = [-0.42, 0.91, 0];
  const k = dot(up, v0);
  const w0 = norm([up[0] - v0[0] * k, up[1] - v0[1] * k, up[2] - v0[2] * k]);
  const x0 = cross3(v0, w0);
  const c0 = CENTRES[0], a0 = AIMS[0], b0 = cross3(c0, a0);
  // View to ball: [c0 a0 b0] times the transpose of [v0 w0 x0].
  return [0, 1, 2].map((i) => [0, 1, 2].map((j) => c0[i] * v0[j] + a0[i] * w0[j] + b0[i] * x0[j]));
})();

function rotation(t) {
  // The ball sways rather than spins, so the composition holds: a slow turn
  // left and right with a little nod.
  const yaw = 0.32 * Math.sin(t * 0.9);
  const pitch = 0.1 * Math.sin(t * 0.63);
  const cy = Math.cos(yaw), sy = Math.sin(yaw), cx = Math.cos(pitch), sx = Math.sin(pitch);
  const sway = [[cy, sy * sx, sy * cx], [0, cx, -sx], [-sy, cy * sx, cy * cx]];
  const m = [0, 1, 2].map((i) => [0, 1, 2].map((j) => REST[i][0] * sway[0][j] + REST[i][1] * sway[1][j] + REST[i][2] * sway[2][j]));
  // Column-major for GLSL.
  return new Float32Array([m[0][0], m[1][0], m[2][0], m[0][1], m[1][1], m[2][1], m[0][2], m[1][2], m[2][2]]);
}

/**
 * Starts the ball on a canvas. Returns a stop function. Renders one frame
 * and stops if `still`; otherwise turns while on screen and the tab is
 * visible. Returns null when WebGL is not available.
 */
export function startBall(canvas, { still = false, speed = 0.12, t: t0 = 0 } = {}) {
  const gl = canvas.getContext('webgl', { premultipliedAlpha: true, alpha: true, antialias: false });
  if (!gl) return null;
  const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); return gl.getShaderParameter(s, gl.COMPILE_STATUS) ? s : null; };
  const vs = sh(gl.VERTEX_SHADER, VERT);
  const fs = sh(gl.FRAGMENT_SHADER, FRAG);
  if (!vs || !fs) return null;
  const prog = gl.createProgram();
  gl.attachShader(prog, vs); gl.attachShader(prog, fs); gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return null;
  gl.useProgram(prog);
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(prog, 'a');
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  gl.uniform3fv(gl.getUniformLocation(prog, 'uC'), new Float32Array(CENTRES.flat()));
  gl.uniform3fv(gl.getUniformLocation(prog, 'uU'), new Float32Array(AIMS.flat()));
  const uRot = gl.getUniformLocation(prog, 'uRot');
  const uScale = gl.getUniformLocation(prog, 'uScale');
  const uPx = gl.getUniformLocation(prog, 'uPx');
  const SCALE = 0.985; // a hair of room for the edge's antialiasing

  const size = () => {
    const box = canvas.getBoundingClientRect();
    const side = Math.min(1100, Math.round(Math.max(box.width, 1) * Math.min(devicePixelRatio || 1, 1.5)));
    if (canvas.width !== side) { canvas.width = side; canvas.height = side; }
    gl.viewport(0, 0, side, side);
    gl.uniform1f(uScale, SCALE);
    gl.uniform1f(uPx, 2 / (side * SCALE));
  };
  let t = t0, last = 0, raf = 0, onScreen = true, stopped = false;
  const draw = () => {
    size();
    gl.uniformMatrix3fv(uRot, false, rotation(t));
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  };
  const frame = (now) => {
    raf = 0;
    if (stopped) return;
    if (last) t += Math.min(0.05, (now - last) / 1000) * speed;
    last = now;
    draw();
    if (onScreen && !document.hidden) raf = requestAnimationFrame(frame);
    else last = 0;
  };
  const wake = () => { if (!raf && !still && !stopped && onScreen && !document.hidden) raf = requestAnimationFrame(frame); };
  draw();
  canvas.classList.add('is-live');
  if (still) return () => { stopped = true; };
  const io = typeof IntersectionObserver === 'function'
    ? new IntersectionObserver(([e]) => { onScreen = e.isIntersecting; wake(); }) : null;
  io?.observe(canvas);
  document.addEventListener('visibilitychange', wake);
  wake();
  return () => {
    stopped = true;
    if (raf) cancelAnimationFrame(raf);
    io?.disconnect();
    document.removeEventListener('visibilitychange', wake);
  };
}
