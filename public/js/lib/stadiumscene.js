/**
 * The stadium at night: offside.win's own match-night scene.
 *
 * A city at the horizon, a stadium glowing in the middle of it, and
 * searchlights fanning up into a violet haze. Drawn on a 2D canvas in layers,
 * back to front, with light added on light ('lighter') so where beams cross
 * they burn brighter, the way light in haze does. Seeded, so the same scene
 * comes out every time: the emails carry stills of it (scripts/mail-art.mjs)
 * and a page can draw it live.
 *
 *   drawScene(canvas, { seed, beams, horizon })
 *
 * The canvas's own size is the drawing size; everything is measured as a
 * share of the width, so a still at 2x and a live one at 1x agree.
 */

const TAU = Math.PI * 2;

function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

const VIOLET = [122, 90, 248];
const VIOLET_HI = [158, 134, 255];
const rgba = (c, a) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;

export function drawScene(canvas, { seed = 7, horizon = 0.74, beams = 30, stadium = true } = {}) {
  const ctx = canvas.getContext('2d');
  const W = canvas.width;
  const H = canvas.height;
  const u = W / 1200;               // one unit at the 1200-wide reference size
  const hy = H * horizon;           // the horizon line
  const cx = W / 2;
  const r = rng(seed);

  ctx.save();
  ctx.globalCompositeOperation = 'source-over';

  // 1. The sky: near-black at the top, deepening to violet-navy, then the
  //    glow of the city and the ground lifting the horizon.
  const sky = ctx.createLinearGradient(0, 0, 0, H);
  sky.addColorStop(0, '#04031a');
  sky.addColorStop(0.35, '#0a0838');
  sky.addColorStop(horizon - 0.12, '#1a0f63');
  sky.addColorStop(horizon - 0.01, '#3a22a8');
  sky.addColorStop(horizon + 0.02, '#170d4d');
  sky.addColorStop(1, '#05041a');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, W, H);

  // 2. Haze over the horizon: the light of the whole city, widest in the
  //    middle where the stadium is.
  ctx.globalCompositeOperation = 'lighter';
  const haze = (x, y, rx, ry, c, a) => {
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(1, ry / rx);
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, rx);
    g.addColorStop(0, rgba(c, a));
    g.addColorStop(1, rgba(c, 0));
    ctx.fillStyle = g;
    ctx.fillRect(-rx, -rx, rx * 2, rx * 2);
    ctx.restore();
  };
  haze(cx, hy, 700 * u, 170 * u, VIOLET, 0.55);
  haze(cx, hy, 380 * u, 120 * u, VIOLET_HI, 0.45);
  haze(cx, hy - 10 * u, 160 * u, 60 * u, [235, 228, 255], 0.35);

  // 3. The city: thousands of lights on the ground, packed tight at the
  //    horizon and thinning as they come towards us. Mostly amber street
  //    light, some white, a little violet; a few soft ones out of focus at
  //    the front.
  ctx.globalCompositeOperation = 'lighter';
  const ground = H - hy;
  // The ground itself, darkening towards us.
  ctx.globalCompositeOperation = 'source-over';
  const gnd = ctx.createLinearGradient(0, hy, 0, H);
  gnd.addColorStop(0, 'rgba(40,24,110,0.55)');
  gnd.addColorStop(0.25, 'rgba(10,7,36,0.85)');
  gnd.addColorStop(1, 'rgba(3,3,14,1)');
  ctx.fillStyle = gnd;
  ctx.fillRect(0, hy, W, ground);
  ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 6500; i++) {
    const t = Math.pow(r(), 3.2);                 // most right at the horizon
    const y = hy + 1.5 * u + t * ground;
    const spread = 0.55 + t * 1.1;
    const x = cx + (r() - 0.5) * W * 1.25 * spread;
    if (x < -10 || x > W + 10) continue;
    const size = (0.45 + t * 1.6) * u;
    const k = r();
    const c = k < 0.62 ? [255, 176, 92] : k < 0.86 ? [255, 236, 210] : VIOLET_HI;
    const a = (0.2 + r() * 0.6) * (1 - t * 0.55);
    ctx.fillStyle = rgba(c, a);
    ctx.beginPath();
    ctx.arc(x, y, size, 0, TAU);
    ctx.fill();
  }
  // Roads of light running away from us, so the ground reads as a city.
  for (let k = 0; k < 7; k++) {
    const x0 = cx + (r() - 0.5) * W * 0.9;
    const lean = (x0 - cx) / W;
    for (let i = 0; i < 70; i++) {
      const t = Math.pow(i / 70, 1.4);
      const y = hy + 3 * u + t * ground;
      const x = x0 + lean * t * W * 1.1;
      ctx.fillStyle = rgba([255, 170, 90], 0.42 * (1 - t * 0.6));
      ctx.beginPath();
      ctx.arc(x, y, (0.6 + t * 1.2) * u, 0, TAU);
      ctx.fill();
    }
  }
  // Bokeh: a few soft discs right at the front, dim.
  ctx.filter = `blur(${7 * u}px)`;
  for (let i = 0; i < 12; i++) {
    const x = r() * W;
    const y = H - r() * ground * 0.25;
    const c = r() < 0.4 ? VIOLET_HI : [255, 180, 110];
    ctx.fillStyle = rgba(c, 0.08 + r() * 0.1);
    ctx.beginPath();
    ctx.arc(x, y, (10 + r() * 16) * u, 0, TAU);
    ctx.fill();
  }
  ctx.filter = 'none';

  // 4. The searchlights. Each is a cone from a point on the horizon, leaning
  //    out from the middle, bright at its foot and fading as it climbs: a
  //    wide soft glow first, then a sharp white-violet core over it.
  const beam = (x, ang, len, w0, w1, a, core, by = hy) => {
    const dx = Math.sin(ang);
    const dy = -Math.cos(ang);
    const nx = -dy;
    const ny = dx;
    const x1 = x + dx * len;
    const y1 = by + dy * len;
    const g = ctx.createLinearGradient(x, by, x1, y1);
    const c = core ? [246, 242, 255] : VIOLET_HI;
    g.addColorStop(0, rgba(c, a));
    g.addColorStop(0.12, rgba(c, a * 0.8));
    g.addColorStop(0.45, rgba(c, a * 0.32));
    g.addColorStop(1, rgba(c, 0));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(x + nx * w0, by + ny * w0);
    ctx.lineTo(x1 + nx * w1, y1 + ny * w1);
    ctx.lineTo(x1 - nx * w1, y1 - ny * w1);
    ctx.lineTo(x - nx * w0, by - ny * w0);
    ctx.closePath();
    ctx.fill();
  };
  const feet = [];
  for (let i = 0; i < beams; i++) {
    const s2 = (i + 0.5) / beams;                 // across the horizon
    const x = W * (0.03 + s2 * 0.94) + (r() - 0.5) * 40 * u;
    const off = (x - cx) / (W / 2);               // -1 left .. 1 right
    // Fanning out from the middle; a few lean the other way and cross.
    const ang = off * 0.78 + (r() - 0.5) * (r() < 0.2 ? 0.9 : 0.28);
    const len = (hy * (0.75 + r() * 0.6)) / Math.max(0.4, Math.cos(ang));
    feet.push({ x, ang, len, a: 0.35 + r() * 0.65, w: 0.6 + r() * 0.9 });
  }
  // A tight bundle from the stadium itself, near-vertical, the brightest.
  if (stadium) {
    for (let i = 0; i < 10; i++) {
      const x = cx + (i - 4.5) * 40 * u + (r() - 0.5) * 10 * u;
      // From the rim of the stadium's opening, not the horizon.
      const t = Math.PI + (i + 0.5) / 10 * Math.PI;
      const bx = cx + Math.cos(t) * 182 * u;
      const by = hy - 54 * u + Math.sin(t) * 25 * u;
      feet.push({ x: bx, by, ang: (bx - cx) / (190 * u) * 0.32 + (r() - 0.5) * 0.05, len: by * (1.0 + r() * 0.2), a: 0.85 + r() * 0.15, w: 1 });
    }
  }
  ctx.globalCompositeOperation = 'lighter';
  ctx.filter = `blur(${14 * u}px)`;
  for (const f of feet) beam(f.x, f.ang, f.len, 12 * u * f.w, 70 * u * f.w, 0.16 * f.a, false, f.by);
  ctx.filter = `blur(${3 * u}px)`;
  for (const f of feet) beam(f.x, f.ang, f.len * 0.92, 3.5 * u * f.w, 18 * u * f.w, 0.22 * f.a, false, f.by);
  ctx.filter = `blur(${0.9 * u}px)`;
  for (const f of feet) beam(f.x, f.ang, f.len * 0.85, 1.1 * u * f.w, 5 * u * f.w, 0.55 * f.a, true, f.by);
  ctx.filter = 'none';
  // The lamps: a hot point and a flare where each beam leaves the ground.
  for (const f of feet) {
    if (f.by) continue;          // the stadium's own lamps are drawn with it
    haze(f.x, hy, 26 * u, 10 * u, VIOLET_HI, 0.55 * f.a);
    haze(f.x, hy, 7 * u, 4 * u, [255, 255, 255], 0.95);
  }

  // 5. The stadium: a low, wide dome, seen from a little above. The roof
  //    slopes from the rim of the opening down to the ground, panelled; the
  //    opening shows the lit bowl inside, and its light pours up.
  if (stadium) {
    const O = { x: cx, y: hy - 2 * u, rx: 340 * u, ry: 46 * u };   // the base, on the ground
    const I = { x: cx, y: hy - 54 * u, rx: 190 * u, ry: 27 * u };  // the rim of the opening
    const at = (e, t) => [e.x + Math.cos(t) * e.rx, e.y + Math.sin(t) * e.ry];
    const hull = () => {
      ctx.beginPath();
      ctx.ellipse(O.x, O.y, O.rx, O.ry, 0, 0, Math.PI);       // front of the base
      ctx.lineTo(...at(I, Math.PI));
      ctx.ellipse(I.x, I.y, I.rx, I.ry, 0, Math.PI, TAU);     // back of the rim
      ctx.lineTo(...at(O, 0));
      ctx.closePath();
    };
    // The roof, darker at the foot, lit along the rim.
    ctx.globalCompositeOperation = 'source-over';
    const rg = ctx.createLinearGradient(0, I.y - I.ry, 0, O.y + O.ry);
    rg.addColorStop(0, '#4b37c4');
    rg.addColorStop(0.45, '#2a1d8a');
    rg.addColorStop(1, '#0d0930');
    ctx.fillStyle = rg;
    hull();
    ctx.fill();
    // Its panels: ribs from the rim down to the ground, and rings across.
    ctx.save();
    hull();
    ctx.clip();
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 64; i++) {
      const t = (i / 64) * TAU;
      const front = Math.sin(t) > 0;
      const [x0, y0] = at(I, t);
      const [x1, y1] = at(O, t);
      const g = ctx.createLinearGradient(x0, y0, x1, y1);
      g.addColorStop(0, rgba([236, 230, 255], front ? 0.55 : 0.3));
      g.addColorStop(1, rgba(VIOLET_HI, 0.04));
      ctx.strokeStyle = g;
      ctx.lineWidth = 1.1 * u;
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.lineTo(x1, y1);
      ctx.stroke();
    }
    for (const k of [0.3, 0.58, 0.82]) {
      const E = { x: I.x, y: I.y + (O.y - I.y) * k, rx: I.rx + (O.rx - I.rx) * k, ry: I.ry + (O.ry - I.ry) * k };
      ctx.strokeStyle = rgba(VIOLET_HI, 0.22 * (1 - k * 0.6));
      ctx.lineWidth = 1 * u;
      ctx.beginPath();
      ctx.ellipse(E.x, E.y, E.rx, E.ry, 0, 0, TAU);
      ctx.stroke();
    }
    ctx.restore();
    // The opening: the far stands inside, lit, and the pitch below them.
    ctx.save();
    ctx.beginPath();
    ctx.ellipse(I.x, I.y, I.rx, I.ry, 0, 0, TAU);
    ctx.clip();
    ctx.globalCompositeOperation = 'source-over';
    const og = ctx.createLinearGradient(0, I.y - I.ry, 0, I.y + I.ry);
    og.addColorStop(0, '#b9aaff');
    og.addColorStop(0.35, '#4a39b8');
    og.addColorStop(0.6, '#1d5a4a');
    og.addColorStop(1, '#0f3a30');
    ctx.fillStyle = og;
    ctx.fillRect(I.x - I.rx, I.y - I.ry, I.rx * 2, I.ry * 2);
    ctx.globalCompositeOperation = 'lighter';
    // Rows of seats catching the floodlights, on the far side.
    for (let row = 0; row < 3; row++) {
      ctx.strokeStyle = rgba([255, 255, 255], 0.22 - row * 0.05);
      ctx.lineWidth = 0.8 * u;
      ctx.beginPath();
      ctx.ellipse(I.x, I.y + (row + 1) * 3.2 * u, I.rx * (0.97 - row * 0.05), I.ry * (0.92 - row * 0.12), 0, Math.PI, TAU);
      ctx.stroke();
    }
    haze(I.x, I.y + I.ry * 0.55, I.rx * 0.7, I.ry * 0.5, [190, 255, 210], 0.35);
    ctx.restore();
    // The rims: the opening's bright, the base's a dotted line of lamps.
    ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = rgba([248, 245, 255], 0.95);
    ctx.lineWidth = 2.2 * u;
    ctx.beginPath();
    ctx.ellipse(I.x, I.y, I.rx, I.ry, 0, 0, TAU);
    ctx.stroke();
    ctx.filter = `blur(${7 * u}px)`;
    ctx.strokeStyle = rgba(VIOLET_HI, 0.9);
    ctx.lineWidth = 9 * u;
    ctx.stroke();
    ctx.filter = 'none';
    for (let i = 0; i <= 120; i++) {
      const t = Math.PI * (i / 120);
      const [x, y] = at(O, t);
      ctx.fillStyle = rgba([255, 236, 210], 0.35 + 0.5 * Math.sin(t));
      ctx.beginPath();
      ctx.arc(x, y, 1.1 * u, 0, TAU);
      ctx.fill();
    }
    // Light out of the opening, up into the haze.
    haze(cx, I.y, I.rx * 1.3, I.ry * 6, VIOLET_HI, 0.28);
    haze(cx, I.y - I.ry, I.rx * 0.7, I.ry * 2, [235, 230, 255], 0.22);
  }

  // A soft darkening at the corners, as a lens does.
  ctx.globalCompositeOperation = 'source-over';
  const vg = ctx.createRadialGradient(cx, H * 0.55, H * 0.35, cx, H * 0.55, W * 0.75);
  vg.addColorStop(0, 'rgba(0,0,0,0)');
  vg.addColorStop(1, 'rgba(2,1,10,0.55)');
  ctx.fillStyle = vg;
  ctx.fillRect(0, 0, W, H);

  // 6. Grain, so the gradients do not band and the whole thing reads as a
  //    photograph of a night rather than a drawing of one.
  ctx.globalCompositeOperation = 'source-over';
  const img = ctx.getImageData(0, 0, W, H);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (r() - 0.5) * 10;
    d[i] += n; d[i + 1] += n; d[i + 2] += n;
  }
  ctx.putImageData(img, 0, 0);
  ctx.restore();
}
