// The trophy's outline, without its ribbons (they turn it into a slab):
// the crown and the lions traced from the photo, the vase drawn from its
// measured profile and mirrored, the arms and the base as they are.
import { chromium } from 'playwright';
import { readFileSync, writeFileSync } from 'fs';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const p = await b.newPage();
const url = await p.evaluate(async (src) => {
  const img = new Image(); img.src = src; await img.decode();
  const W = img.width, H = img.height, K = 2;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const x = c.getContext('2d'); x.drawImage(img, 0, 0);
  const d = x.getImageData(0, 0, W, H).data;
  // Pass 1, the photo above the shoulders: anything that is not the white
  // ground and not a navy ribbon.
  const m = document.createElement('canvas'); m.width = W * K; m.height = H * K;
  const mx = m.getContext('2d');
  mx.fillStyle = '#fff'; mx.fillRect(0, 0, W * K, H * K);
  // The crown: everything the white ground cannot reach from the edges.
  const bg = new Uint8Array(W * H);
  const isWhite = (k) => d[k * 4] > 240 && d[k * 4 + 1] > 240 && d[k * 4 + 2] > 240;
  const st = [];
  for (let i = 0; i < W; i++) st.push(i);
  for (let j = 0; j < H; j++) st.push(j * W, j * W + W - 1);
  while (st.length) {
    const k = st.pop();
    if (bg[k] || !isWhite(k)) continue;
    bg[k] = 1;
    const i = k % W, j = (k / W) | 0;
    if (i > 0) st.push(k - 1); if (i < W - 1) st.push(k + 1); if (j > 0) st.push(k - W); if (j < H - 1) st.push(k + W);
  }
  const top = x.createImageData(W, H);
  for (let k = 0; k < W * H; k++) {
    const r = d[k * 4], g = d[k * 4 + 1], bl = d[k * 4 + 2];
    const j = (k / W) | 0;
    const lum = 0.2126 * r + 0.7152 * g + 0.0722 * bl;
    const navy = bl > r + 30 && bl > g + 10 && lum < 150;
    const gold = r > bl + 45 && r > 120;
    // Above the collar the flood decides; across the lions, only gold or
    // a real shadow counts, so the white inside the arms stays open.
    const ink = j < 250 ? !bg[k] : j < 352 ? (gold || (lum < 190 && !navy)) : false;
    top.data[k * 4] = top.data[k * 4 + 1] = top.data[k * 4 + 2] = 0; top.data[k * 4 + 3] = ink ? 255 : 0;
  }
  const t = document.createElement('canvas'); t.width = W; t.height = H; t.getContext('2d').putImageData(top, 0, 0);
  mx.imageSmoothingQuality = 'high';
  mx.drawImage(t, 0, 0, W * K, H * K);
  // Pass 2, drawn: the vase from its profile (radius, height above the foot,
  // in tenths of the photo's pixels), the base, the arms.
  const CX = 400, FOOT = 965;
  const X = (r, s) => (CX + s * r * 10) * K, Y = (y) => (FOOT - y * 10) * K;
  const prof = [[14, 6.5], [14.2, 7.2], [13.6, 8.4], [12, 9.6], [10, 11.4], [7.4, 13.4], [5.4, 15], [4.3, 16.2],
    [4.1, 17.4], [4.8, 18.4], [5.6, 19.2], [7, 21.5], [8.6, 25], [10, 30], [11, 36.5], [11.8, 42], [12.3, 48], [12.5, 52.5],
    [12.4, 55.5], [11.8, 58.6], [10.4, 61.4], [8.4, 63.6], [6.8, 65.4], [6.3, 66.8], [6.4, 67.6], [7.6, 68.2], [8.5, 69.4],
    [8.9, 70.6], [9.0, 71.6], [8.7, 72.6]];
  mx.fillStyle = '#000';
  mx.beginPath();
  prof.forEach(([r, y], i) => (i ? mx.lineTo(X(r, 1), Y(y)) : mx.moveTo(X(r, 1), Y(y))));
  [...prof].reverse().forEach(([r, y]) => mx.lineTo(X(r, -1), Y(y)));
  mx.closePath(); mx.fill();
  // The malachite base, a touch narrower at its foot.
  mx.beginPath(); mx.moveTo(X(13.7, -1), Y(6.6)); mx.lineTo(X(13.7, 1), Y(6.6)); mx.lineTo(X(13.2, 1), Y(0)); mx.lineTo(X(13.2, -1), Y(0)); mx.closePath(); mx.fill();
  // The arms: straight out from the collar, a short drop at the end.
  for (const s of [-1, 1]) {
    mx.fillRect(Math.min(X(7.5, s), X(23.6, s)), Y(71.1), Math.abs(X(23.6, s) - X(7.5, s)), 1.3 * 10 * K);
    mx.fillRect(Math.min(X(22.6, s), X(23.8, s)), Y(71.1), 1.2 * 10 * K, 9 * 10 * K);
  }
  // Our own ribbons: two a side, hung from the end of each arm, cut with a
  // swallowtail. Each is drawn with a thin gap round it (cleared first), so
  // where a ribbon crosses the arm or the vase the two still read apart.
  const ribbon = (s, xTop, xBot, w, yTop, yBot) => {
    const pts = [[xTop - w / 2, yTop], [xTop + w / 2, yTop], [xBot + w / 2, yBot], [xBot, yBot - w * 0.62], [xBot - w / 2, yBot]]
      .map(([px, py]) => [(CX + s * (px - CX)) * K, py * K]);
    const path = () => { mx.beginPath(); pts.forEach(([px, py], i) => (i ? mx.lineTo(px, py) : mx.moveTo(px, py))); mx.closePath(); };
    mx.save();
    mx.globalCompositeOperation = 'source-over';
    mx.strokeStyle = '#fff'; mx.lineWidth = 7 * K; mx.lineJoin = 'round';
    path(); mx.stroke();
    mx.fillStyle = '#000'; path(); mx.fill();
    mx.restore();
  };
  // The handles: down the outside from the end of each arm, then a long
  // curve down and in to meet the stem just above its knot, as on the real
  // trophy. Behind the ribbons: each ribbon's gap cuts across them.
  for (const s of [-1, 1]) {
    const P = (px, py) => [(CX + s * (px - CX)) * K, py * K];
    mx.save();
    mx.lineCap = 'round'; mx.lineJoin = 'round';
    // Through the points of the owner's drawing (photo pixels), smoothed.
    const pts = [[170, 336], [178, 470], [229, 606], [269, 719], [356, 791]].map(([px, py]) => P(px, py));
    mx.beginPath(); mx.moveTo(...pts[0]);
    for (let i = 1; i < pts.length - 1; i++) {
      const mxp = (pts[i][0] + pts[i + 1][0]) / 2, myp = (pts[i][1] + pts[i + 1][1]) / 2;
      mx.quadraticCurveTo(pts[i][0], pts[i][1], mxp, myp);
    }
    mx.lineTo(...pts[pts.length - 1]);
    mx.strokeStyle = '#000'; mx.lineWidth = 11 * K; mx.stroke();
    mx.restore();
    // A ledge under each lion, from the end of the arm to the neck: what
    // the lion stands on, and what the ribbons hang from.
    const [x0, y0] = P(164, 343), [x1] = P(302, 343);
    mx.fillStyle = '#000';
    mx.fillRect(Math.min(x0, x1), y0, Math.abs(x1 - x0), 11 * K);
  }
  for (const s of [-1, 1]) {
    ribbon(s, 196, 200, 31, 358, 936);   // outer, all but straight
    ribbon(s, 230, 246, 31, 358, 912);   // middle
    ribbon(s, 264, 292, 31, 358, 884);   // inner, drawn in towards the stem
  }
  return m.toDataURL('image/png');
}, 'data:image/webp;base64,' + readFileSync('pl-photo.webp').toString('base64'));
writeFileSync('pl-mask2.png', Buffer.from(url.split(',')[1], 'base64'));
await b.close();
