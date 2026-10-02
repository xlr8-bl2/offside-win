/**
 * The star ball, in 3D, after the competition's own artwork: a clear glass
 * bubble holding twelve glass stars, turning slowly. Drawn by a fragment
 * shader, so it is one quad and no textures.
 *
 * The geometry is the real ball's: twelve stars centred on the corners of an
 * icosahedron, each star's five points aimed at its five neighbours so the
 * tips meet, which leaves a five-sided gap between each three stars. Every
 * corner is rounded. The stars are slabs of thin glass with rounded edges:
 * the shader marches each pixel's view ray through the shell to the first
 * slab it meets, on its face or its side, so the glass has real thickness
 * where it turns away from us. The gaps are empty: through them, the far
 * stars show from inside the ball, dark.
 *
 * The look, layer by layer:
 *   - the far stars, dark, through the gaps;
 *   - the near stars, clear blue glass, lighter where the light falls;
 *   - every star's outline, a crisp line a pixel or two wide, its colour
 *     walking through lime and gold, pink and cyan along the edge;
 *   - the bubble: a broad sheen from a window off to the upper right that
 *     slides across the ball as it sways, and a thin light at the rim.
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

export const FRAG = `#extension GL_OES_standard_derivatives : enable
precision highp float;
varying vec2 vUv;
uniform vec3 uC[12];
uniform vec3 uU[12];
uniform mat3 uRot;
uniform float uScale;  // ball radius in clip units
uniform float uPx;     // one pixel in ball units
uniform vec2 uA;       // a star arm's inner corner, pulled in for the rounding
uniform float uP;      // and its tip, pulled in the same way

const float ROUND = 0.014;  // every corner of the star is rounded: the tips
const float FILLET = 0.06;  // and, more softly, the inside corners
const float T = 0.026;      // the glass's thickness, as a share of the radius
const float BEVEL = 0.0115; // the slab's edges are rounded over, not cut square

// One arm of the star, folded onto its right half: the kite between the
// centre, the inner corner and the tip. Negative inside.
float arm(vec2 q) {
  vec2 a = uA;
  vec2 tip = vec2(0.0, uP);
  vec2 ca = clamp(dot(q, a) / dot(a, a), 0.0, 1.0) * a;
  vec2 at = a + clamp(dot(q - a, tip - a) / dot(tip - a, tip - a), 0.0, 1.0) * (tip - a);
  float d = min(length(q - ca), length(q - at));
  bool inside = a.x * q.y - a.y * q.x > 0.0 && (tip.x - a.x) * (q.y - a.y) - (tip.y - a.y) * (q.x - a.x) > 0.0;
  return inside ? -d : d;
}

// A five-point star, its first point up the y axis, with every corner
// rounded: the arm nearest the point and its neighbour are blended (which
// fillets the inside corner between them), then the whole is grown by ROUND
// (which rounds the tips; uA and uP were pulled in to make room).
float star(vec2 q) {
  const float SECTOR = 1.2566370614; // 72 degrees
  float ang = atan(q.x, q.y);
  float b = abs(ang - SECTOR * floor(ang / SECTOR + 0.5));
  float l = length(q);
  float d1 = arm(l * vec2(sin(b), cos(b)));
  float d2 = arm(l * vec2(sin(SECTOR - b), cos(SECTOR - b)));
  float h = max(FILLET - abs(d1 - d2), 0.0) / FILLET;
  return min(d1, d2) - h * h * FILLET * 0.25 - ROUND;
}

// Distance (in tangent units) to the edge of the nearest star.
float field(vec3 p) {
  float best = -2.0;
  vec3 c = uC[0]; vec3 u = uU[0];
  for (int i = 0; i < 12; i++) {
    float d = dot(p, uC[i]);
    if (d > best) { best = d; c = uC[i]; u = uU[i]; }
  }
  vec3 v = cross(c, u);
  vec3 t = p / best - c; // gnomonic: great circles stay straight
  return star(vec2(dot(t, v), dot(t, u)));
}

// The slabs as a solid: a star's outline, as thick as the glass, its edges
// rounded over like a rounded box (in the plane of "across the edge" and
// "through the glass"). Conservative, so a march never steps through it.
float solid(vec3 x) {
  float l = length(x);
  float across = field(uRot * (x / l)) * l * 0.7;
  float through = abs(l - (1.0 - 0.5 * T)) - 0.5 * T;
  vec2 q = vec2(across, through) + BEVEL;
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - BEVEL;
}
vec3 normalAt(vec3 x) {
  const vec2 e = vec2(0.0012, 0.0);
  return normalize(vec3(solid(x + e.xyy) - solid(x - e.xyy), solid(x + e.yxy) - solid(x - e.yxy), solid(x + e.yyx) - solid(x - e.yyx)));
}

// Down the view ray (straight into the screen) through one stretch of the
// shell, from z0 to z1. Returns where it met glass (or came closest) and how
// far away it stayed: 0 for a hit, a little for a ray that grazes an edge
// (softened into the edge rather than stepped), more for a clean miss.
vec2 march(vec2 xy, float z0, float z1) {
  float z = z0, bz = z0, bd = 1e3;
  for (int i = 0; i < 32; i++) {
    float d = solid(vec3(xy, z));
    if (d < bd) { bd = d; bz = z; }
    if (d < 0.0004) return vec2(z, 0.0);
    z -= max(d, 0.001);
    if (z < z1) break;
  }
  return vec2(bz, bd);
}

vec3 prismHue(vec3 p) {
  float phase = dot(p, vec3(2.3, 1.7, 2.9));
  vec3 h = clamp(abs(fract(phase + vec3(0.0, 0.67, 0.33)) * 6.0 - 3.0) - 1.0, 0.0, 1.0);
  return mix(h, vec3(0.62, 1.0, 0.08), 0.3); // lean towards lime, as the original does
}

// Sampled from the competition's own artwork. The page behind is a deep,
// bright ultramarine (the hero's background, not drawn here). The near stars
// are clear blue glass, lighter than the gaps; through the gaps the far
// stars show from inside the ball, dark.
const vec3 INK = vec3(0.0, 0.012, 0.42);
const vec3 GLASS = vec3(0.02, 0.08, 0.66);
const vec3 BRIGHT = vec3(0.06, 0.26, 0.96);
const vec3 PALE = vec3(0.4, 0.62, 1.0);

// What the glass reflects: one broad soft window off to the upper right,
// fixed to the camera, so a wide diagonal sheen slides across the ball as it
// sways, and a dim fill from below.
vec3 studio(vec3 R) {
  vec3 w = normalize(vec3(0.62, 0.55, 0.56));
  float window = smoothstep(0.55, 0.93, dot(R, w));
  float fill = smoothstep(0.75, 1.0, dot(R, normalize(vec3(-0.3, -0.8, 0.5))));
  return vec3(0.55, 0.72, 1.0) * window * 0.42 + PALE * fill * 0.12;
}

// One star's glass at a point: its colour (premultiplied) and cover. Its cut
// edge, rounded over, catches the light as a crisp coloured line all the way
// round: lime and gold, pink and magenta, cyan, changing along the edge.
vec4 glass(vec3 x, float far) {
  vec3 L = normalize(vec3(0.75, 0.35, 0.55));
  vec3 V = vec3(0.0, 0.0, 1.0);
  vec3 n = normalAt(x);
  vec3 rd = normalize(x);
  float fr = dot(n, rd);                 // 1 outer face, 0 wall, -1 inner face
  float face = smoothstep(0.55, 0.92, abs(fr));
  float lit = smoothstep(-0.3, 1.0, dot(rd, L));

  vec3 p = uRot * x;
  float glint = 0.8 + 0.2 * smoothstep(-0.3, 0.7, sin(dot(p, vec3(3.7, -2.9, 2.2))));
  float edge = min(1.0, 1.4 * exp(-pow((abs(fr) - 0.6) / 0.16, 2.0)) * glint);
  vec3 hue = prismHue(p + 0.6 * (1.0 - abs(rd.z)));

  if (far > 0.5) {
    // The far side, seen from inside: dark tinted glass with pale edges.
    float a = 0.72;
    vec3 col = INK * a;
    float e = edge * 0.3;
    col = mix(col, mix(hue, PALE, 0.6) * max(a, e), e);
    return vec4(col, a);
  }
  vec3 c = mix(GLASS, BRIGHT, pow(lit, 1.3));
  c = mix(mix(BRIGHT, PALE, 0.3), c, face);          // the thin walls, lighter
  float a = mix(0.62, 0.5, face);
  vec3 nv = dot(n, V) < 0.0 ? -n : n;
  float fres = 0.06 + 0.94 * pow(1.0 - max(dot(nv, V), 0.0), 4.0);
  vec3 refl = studio(reflect(-V, nv)) * (0.5 + 0.5 * fres) + PALE * fres * 0.18;
  vec3 col = c * a + refl;
  a = min(1.0, a + dot(refl, vec3(0.3, 0.5, 0.2)) * 0.8);
  col = mix(col, hue * max(a, edge), edge);
  a = max(a, edge);
  return vec4(col, a);
}

void main() {
  vec2 xy = vUv / uScale;
  float r = length(xy);
  // A faint glow around the whole ball, as if it sat in its own light.
  if (r > 1.0) {
    float halo = exp(-(r - 1.0) * 22.0) * 0.18;
    gl_FragColor = vec4(PALE * halo, halo);
    return;
  }
  float ri = 1.0 - T;
  float zo = sqrt(1.0 - r * r);
  bool through = r < ri;                 // the ray crosses the hollow inside
  float zi = through ? sqrt(ri * ri - r * r) : 0.0;
  float aa = uPx * 1.2;

  vec4 outc = vec4(0.0);
  if (through) {
    // The far side first: the backs of the stars, seen from inside the ball.
    vec2 hf = march(xy, -zi + 0.002, -zo);
    float cover = 1.0 - smoothstep(0.0, aa, hf.y);
    if (cover > 0.0) outc = glass(vec3(xy, hf.x), 1.0) * cover;
  }
  vec2 hn = march(xy, zo + 0.002, through ? zi : -zo);
  float cover = 1.0 - smoothstep(0.0, aa, hn.y);
  if (cover > 0.0) {
    vec4 g = glass(vec3(xy, hn.x), 0.0) * cover;
    outc = g + outc * (1.0 - g.a);
  }
  // The outlines: every star's edge, a crisp coloured line a pixel or two
  // wide whatever the angle (measured on screen, so it stays thin even where
  // the sphere turns away), bright on the near stars, faint on the far ones.
  vec3 po = uRot * vec3(xy, zo);
  float fo = field(po);
  float lo = 1.0 - smoothstep(0.6, 1.6, abs(fo) / max(fwidth(fo), 1e-5));
  if (through) {
    vec3 pb = uRot * vec3(xy, -zo);
    float fb = field(pb);
    float lb = (1.0 - smoothstep(0.5, 1.4, abs(fb) / max(fwidth(fb), 1e-5))) * 0.35;
    outc.rgb = mix(outc.rgb, mix(prismHue(pb), PALE, 0.55) * max(outc.a, lb), lb);
    outc.a = max(outc.a, lb);
  }
  float glo = 0.85 + 0.15 * sin(dot(po, vec3(3.7, -2.9, 2.2)));
  lo *= glo;
  outc.rgb = mix(outc.rgb, prismHue(po + 0.5 * (1.0 - zo)) * max(outc.a, lo), lo);
  outc.a = max(outc.a, lo);

  // The whole is held in a clear bubble: no colour of its own, only the
  // window's sheen across it (crossing the gaps too) and a thin light where
  // it turns away at the silhouette.
  vec3 ns = vec3(xy, zo);
  float fs = pow(1.0 - zo, 3.0);
  vec3 bubble = studio(reflect(vec3(0.0, 0.0, -1.0), ns)) * 0.55 + PALE * fs * 0.3;
  bubble += PALE * exp(-pow((1.0 - r) / (uPx * 2.0 + 0.004), 2.0)) * 0.4;
  float ba = min(1.0, dot(bubble, vec3(0.3, 0.5, 0.2)));
  outc = vec4(bubble, ba) + outc * (1.0 - ba);
  outc.rgb = min(outc.rgb, vec3(outc.a));
  gl_FragColor = outc;
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

// One arm of a star, in the plane touching the ball at the star's centre
// (tangent units): the tip straight up (neighbouring tips meet at 0.618),
// the inner corners at 0.42 of it, 36 degrees either side. The
// shader rounds every corner by growing a smaller arm by ROUND, so the tip
// and the inner corner are pulled in first: the arm's outer edge moves in by
// ROUND and the growth puts it back where it was, now with a rounded tip.
const ROUND = 0.014; // keep in step with ROUND in FRAG
function armShape() {
  const TIP = 0.636; // the rounded tip lands just short of 0.618, where the neighbour's meets it
  const inner = 0.42 * TIP;
  const a = [inner * Math.sin(Math.PI / 5), inner * Math.cos(Math.PI / 5)];
  const d = [-a[0], TIP - a[1]];
  const l = Math.hypot(d[0], d[1]);
  const out = [d[1] / l, -d[0] / l]; // the edge's outward normal
  const p = a[1] + (-ROUND + a[0] * out[0]) / out[1];
  const t = 1 - ROUND / (a[0] * out[0] + a[1] * out[1]);
  return { a: [a[0] * t, a[1] * t], p };
}

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
export function startBall(canvas, { still = false, speed = 0.12, t: t0 = 0, frag = FRAG } = {}) {
  const gl = canvas.getContext('webgl', { premultipliedAlpha: true, alpha: true, antialias: false });
  if (!gl) return null;
  // Outlines are measured on screen (fwidth). Without the extension that
  // provides it, a pixel's width in the star's own units stands in.
  if (!gl.getExtension('OES_standard_derivatives')) {
    frag = frag.replace(/^#extension[^\n]*\n/, '').replace(/fwidth\(([a-z]+)\)/g, 'uPx');
  }
  const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); return gl.getShaderParameter(s, gl.COMPILE_STATUS) ? s : null; };
  const vs = sh(gl.VERTEX_SHADER, VERT);
  const fs = sh(gl.FRAGMENT_SHADER, frag);
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
  const arm = armShape();
  gl.uniform2f(gl.getUniformLocation(prog, 'uA'), arm.a[0], arm.a[1]);
  gl.uniform1f(gl.getUniformLocation(prog, 'uP'), arm.p);
  const SCALE = 0.93; // room for the glow around the ball

  const size = () => {
    const box = canvas.getBoundingClientRect();
    const side = Math.min(1100, Math.round(Math.max(box.width, 1) * Math.min(devicePixelRatio || 1, 1.25)));
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
  // Thirty frames a second is plenty for a slow sway, and halves the work
  // of a shader that marches every pixel through the glass.
  const frame = (now) => {
    raf = 0;
    if (stopped) return;
    if (last && now - last < 31) { raf = requestAnimationFrame(frame); return; }
    if (last) t += Math.min(0.1, (now - last) / 1000) * speed;
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
