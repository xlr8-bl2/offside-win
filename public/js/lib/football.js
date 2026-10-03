/**
 * A football, in 3D, for the moments that are about football itself rather
 * than one competition: the classic ball of twelve black pentagons and twenty
 * white hexagons, stitched, glossy, lit by a white key light from the upper
 * left and the site's violet floodlight from behind on the right.
 *
 * Drawn by a fragment shader on one quad, like the star ball, and started
 * the same way: startBall(canvas, { frag: FOOTBALL }) from ./starball.js,
 * which supplies the turn (uRot), the size (uScale) and a pixel (uPx).
 *
 * The panels are the truncated icosahedron's faces: a point on the ball
 * belongs to the face whose plane its ray meets first, which for a unit
 * direction is the face with the largest dot(p, n) / inradius. The seams sit
 * where the best two faces are nearly level, measured on screen (fwidth) so
 * they stay a crisp line however the sphere turns.
 */

export const FOOTBALL = `#extension GL_OES_standard_derivatives : enable
precision highp float;
varying vec2 vUv;
uniform mat3 uRot;
uniform float uScale;
uniform float uPx;

const float PHI = 1.6180339887;
// Inradii of the truncated icosahedron's faces, edge length one.
const float RP = 2.32744;   // pentagons
const float RH = 2.26728;   // hexagons

vec3 perm(vec3 v, int k) { return k == 0 ? v : k == 1 ? v.yzx : v.zxy; }

// The best and second-best face scores for direction p, and whether the best
// is a pentagon.
void faces(vec3 p, out float best, out float second, out float pent, out vec3 nb) {
  best = -9.0; second = -9.0; pent = 0.0; nb = p;
  // Pentagons: the icosahedron's corners, (0, +-1, +-phi) and cycles.
  for (int k = 0; k < 3; k++) for (int i = 0; i < 4; i++) {
    float a = mod(float(i), 2.0) < 1.0 ? 1.0 : -1.0;
    float b = i < 2 ? PHI : -PHI;
    vec3 n = normalize(perm(vec3(0.0, a, b), k));
    float s = dot(p, n) / RP;
    if (s > best) { second = best; best = s; pent = 1.0; nb = n; } else if (s > second) second = s;
  }
  // Hexagons: the dodecahedron's corners, (+-1, +-1, +-1) ...
  for (int i = 0; i < 8; i++) {
    float fi = float(i);
    vec3 n = normalize(vec3(mod(fi, 2.0) < 1.0 ? 1.0 : -1.0, mod(floor(fi / 2.0), 2.0) < 1.0 ? 1.0 : -1.0, fi < 4.0 ? 1.0 : -1.0));
    float s = dot(p, n) / RH;
    if (s > best) { second = best; best = s; pent = 0.0; nb = n; } else if (s > second) second = s;
  }
  // ... and (0, +-1/phi, +-phi) and cycles.
  for (int k = 0; k < 3; k++) for (int i = 0; i < 4; i++) {
    float a = mod(float(i), 2.0) < 1.0 ? 1.0 / PHI : -1.0 / PHI;
    float b = i < 2 ? PHI : -PHI;
    vec3 n = normalize(perm(vec3(0.0, a, b), k));
    float s = dot(p, n) / RH;
    if (s > best) { second = best; best = s; pent = 0.0; nb = n; } else if (s > second) second = s;
  }
}

void main() {
  vec2 xy = vUv / uScale;
  float r = length(xy);
  float edge = 1.0 - smoothstep(1.0 - uPx * 1.5, 1.0, r);
  if (r > 1.0) { gl_FragColor = vec4(0.0); return; }
  float z = sqrt(max(0.0, 1.0 - r * r));
  vec3 N = vec3(xy, z);             // the sphere's normal, towards us
  vec3 p = uRot * N;                // the same point on the turning ball

  float best, second, pent; vec3 nb;
  faces(p, best, second, pent, nb);
  // The seam: where the two nearest faces are nearly level, a groove of
  // constant width on screen.
  float gap = best - second;
  float w = max(fwidth(gap), 1e-5);
  float seam = 1.0 - smoothstep(0.6, 2.0, gap / w);
  // Panels puff out a little between the seams.
  float puff = smoothstep(0.0, 0.035, gap);

  vec3 white = vec3(0.95, 0.955, 0.965);
  vec3 black = vec3(0.045, 0.045, 0.055);
  vec3 base = mix(white, black, pent);

  // Light, in view space: a white key from the upper left, a violet rim from
  // behind on the right, a little fill from below.
  vec3 V = vec3(0.0, 0.0, 1.0);
  vec3 L = normalize(vec3(-0.55, 0.6, 0.6));
  vec3 bent = normalize(N + (uRot * 0.0) + 0.06 * (1.0 - puff) * N);
  float dif = max(dot(bent, L), 0.0);
  float amb = 0.32 + 0.12 * N.y;
  vec3 H = normalize(L + V);
  float spec = pow(max(dot(N, H), 0.0), mix(60.0, 90.0, pent)) * mix(0.55, 0.9, pent);
  float rim = pow(1.0 - z, 2.4);
  vec3 violet = vec3(0.48, 0.35, 0.97);

  vec3 c = base * (amb + 0.85 * dif);
  c *= mix(0.78, 1.0, puff);                          // shade into the seams
  c = mix(c, vec3(0.02), seam * 0.85);                // the stitched groove
  c += spec;                                          // the gloss
  c += violet * rim * smoothstep(-0.2, 0.9, N.x) * 0.9; // the floodlight, behind
  c *= 0.9 + 0.1 * smoothstep(-1.0, 0.4, N.y);        // a touch darker underneath

  gl_FragColor = vec4(c * edge, edge);
}`;
