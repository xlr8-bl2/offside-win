/**
 * A club's colour, read off its crest.
 *
 * The match page's masthead is washed in the two sides' colours. Nothing in
 * the feed says what a club's colours are, but the crest does: the most common
 * strong colour in it is, for nearly every club, the shirt. So each crest is
 * fetched once, decoded, and reduced to one hex value that the fixture page
 * reads through get_fixture.
 *
 * It is done here rather than in the browser because the image host sends no
 * CORS header, so a page cannot read a crest's pixels -- and because a colour
 * computed once is better than the same colour computed on every page view.
 *
 * The decoder is small on purpose. The crests are 150px PNGs, 8-bit, and
 * non-interlaced; that is what it supports, via node:zlib, with no image
 * library added to the engine for it.
 */

import { inflateSync } from 'node:zlib';
import { config } from '../config.ts';
import { exec, select } from '../store.ts';

export interface Pixels { width: number; height: number; rgba: Uint8Array }

/** Decode an 8-bit (or palette 1/2/4-bit), non-interlaced PNG to RGBA. */
export function decodePng(buf: Uint8Array): Pixels {
  const sig = [137, 80, 78, 71, 13, 10, 26, 10];
  if (sig.some((b, i) => buf[i] !== b)) throw new Error('not a PNG');
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let pos = 8;
  let width = 0, height = 0, depth = 0, type = 0, interlace = 0;
  let palette: Uint8Array | null = null;
  let trns: Uint8Array | null = null;
  const idat: Uint8Array[] = [];
  while (pos + 8 <= buf.length) {
    const len = view.getUint32(pos);
    const name = String.fromCharCode(buf[pos + 4]!, buf[pos + 5]!, buf[pos + 6]!, buf[pos + 7]!);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (name === 'IHDR') {
      width = view.getUint32(pos + 8);
      height = view.getUint32(pos + 12);
      depth = data[8]!;
      type = data[9]!;
      interlace = data[12]!;
    } else if (name === 'PLTE') palette = data;
    else if (name === 'tRNS') trns = data;
    else if (name === 'IDAT') idat.push(data);
    else if (name === 'IEND') break;
    pos += 12 + len;
  }
  if (interlace) throw new Error('interlaced PNG not supported');
  const channels = ({ 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 } as Record<number, number>)[type];
  if (!channels) throw new Error(`PNG colour type ${type} not supported`);
  if (type !== 3 && depth !== 8) throw new Error(`PNG bit depth ${depth} not supported`);

  const raw = inflateSync(Buffer.concat(idat.map((d) => Buffer.from(d))));
  const bitsPerPixel = channels * depth;
  const stride = Math.ceil((width * bitsPerPixel) / 8);
  const bpp = Math.max(1, bitsPerPixel >> 3);
  const out = new Uint8Array(width * height * 4);
  let prev = new Uint8Array(stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]!;
    const line = Uint8Array.from(raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)));
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? line[i - bpp]! : 0;
      const b = prev[i]!;
      const c = i >= bpp ? prev[i - bpp]! : 0;
      let add = 0;
      if (filter === 1) add = a;
      else if (filter === 2) add = b;
      else if (filter === 3) add = (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        add = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      line[i] = (line[i]! + add) & 0xff;
    }
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4;
      if (type === 3) {
        const perByte = 8 / depth;
        const byte = line[Math.floor(x / perByte)]!;
        const shift = 8 - depth * ((x % perByte) + 1);
        const idx = (byte >> shift) & ((1 << depth) - 1);
        out[o] = palette?.[idx * 3] ?? 0;
        out[o + 1] = palette?.[idx * 3 + 1] ?? 0;
        out[o + 2] = palette?.[idx * 3 + 2] ?? 0;
        out[o + 3] = trns && idx < trns.length ? trns[idx]! : 255;
      } else {
        const i = x * channels;
        const rgb = type === 2 || type === 6;
        out[o] = line[i]!;
        out[o + 1] = rgb ? line[i + 1]! : line[i]!;
        out[o + 2] = rgb ? line[i + 2]! : line[i]!;
        out[o + 3] = type === 6 ? line[i + 3]! : type === 4 ? line[i + 1]! : 255;
      }
    }
    prev = line;
  }
  return { width, height, rgba: out };
}

function hsl(r: number, g: number, b: number): [number, number, number] {
  const R = r / 255, G = g / 255, B = b / 255;
  const max = Math.max(R, G, B), min = Math.min(R, G, B);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === R ? (G - B) / d + (G < B ? 6 : 0) : max === G ? (B - R) / d + 2 : (R - G) / d + 4;
  return [h / 6, s, l];
}

function hex(h: number, s: number, l: number): string {
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const f = (t: number) => {
    let x = t;
    if (x < 0) x += 1;
    if (x > 1) x -= 1;
    const v = x < 1 / 6 ? p + (q - p) * 6 * x : x < 1 / 2 ? q : x < 2 / 3 ? p + (q - p) * (2 / 3 - x) * 6 : p;
    return Math.round(v * 255).toString(16).padStart(2, '0');
  };
  return `#${f(h + 1 / 3)}${f(h)}${f(h - 1 / 3)}`;
}

/**
 * The crest's colour: the most common strong colour, or, for a crest with
 * none (black and white, say), its most common visible one. Lightness is held
 * between a quarter and three-fifths so a white crest does not wash the
 * masthead out and a black one still shows on a near-black page.
 */
export function crestColor(px: Pixels): string | null {
  type Bin = { n: number; w: number; r: number; g: number; b: number };
  const strong = new Map<number, Bin>();
  const any = new Map<number, Bin>();
  const { rgba } = px;
  for (let i = 0; i < rgba.length; i += 4) {
    if (rgba[i + 3]! < 200) continue;
    const r = rgba[i]!, g = rgba[i + 1]!, b = rgba[i + 2]!;
    const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
    const [h, s, l] = hsl(r, g, b);
    const into = s > 0.35 && l > 0.12 && l < 0.9 ? [strong, any] : [any];
    // Gold is usually trim -- a crown, a border, a star -- rather than the
    // shirt, so it counts for a little less than other strong colours.
    const w = h > 0.1 && h < 0.17 ? 0.6 : 1;
    for (const m of into) {
      // Strong colours are grouped by hue, so a blue drawn in six shades of
      // anti-aliasing counts as one blue rather than six small ones.
      const k = m === strong ? 4096 + Math.floor(h * 12) * 4 + Math.min(3, Math.floor(l * 4)) : key;
      const e = m.get(k) ?? { n: 0, w: 0, r: 0, g: 0, b: 0 };
      e.n++; e.w += w; e.r += r; e.g += g; e.b += b;
      m.set(k, e);
    }
  }
  const total = [...any.values()].reduce((t, e) => t + e.n, 0);
  if (!total) return null;
  const top = (m: Map<number, Bin>) => [...m.values()].sort((a, b) => b.w - a.w)[0];
  // A strong colour has to cover a real share of the crest to count, or a
  // red dot on a white badge would paint the whole masthead red.
  const s = top(strong);
  const pick = s && s.n >= total * 0.06 ? s : top(any)!;
  const [h, sat, l] = hsl(pick.r / pick.n, pick.g / pick.n, pick.b / pick.n);
  return hex(h, Math.min(sat, 0.85), Math.min(0.6, Math.max(0.25, l)));
}

/**
 * Fill in colours for the teams on the board that do not have one yet.
 * Bounded per run, and a crest that cannot be read is recorded as tried
 * (an empty colour) so it is not fetched again every quarter of an hour.
 */
export async function fillCrestColors({ limit = 250 } = {}): Promise<number> {
  const now = Math.floor(Date.now() / 1000);
  // Soonest kick-off first, so the games people are opening today get their
  // colours on the first run rather than whenever their turn comes round.
  const rows = await select<{ id: number | string }>(
    `SELECT t.id FROM (
       SELECT home_team_id AS id, kickoff FROM fixture WHERE kickoff BETWEEN ? AND ?
       UNION ALL SELECT away_team_id, kickoff FROM fixture WHERE kickoff BETWEEN ? AND ?
     ) t
     WHERE t.id IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM team_color c WHERE c.team_id = t.id)
     GROUP BY t.id
     ORDER BY min(abs(t.kickoff - ?))
     LIMIT ?`,
    [now - 3 * 86400, now + 10 * 86400, now - 3 * 86400, now + 10 * 86400, now, limit],
  );
  let done = 0;
  for (const { id } of rows) {
    let color: string | null = null;
    try {
      const res = await fetch(`${config.bsd.base}/img/team/${encodeURIComponent(String(id))}/`);
      if (res.ok) color = crestColor(decodePng(new Uint8Array(await res.arrayBuffer())));
    } catch { /* recorded as tried below */ }
    await exec(
      `INSERT INTO team_color (team_id, color, updated_at) VALUES (?, ?, ?)
       ON CONFLICT (team_id) DO UPDATE SET color = excluded.color, updated_at = excluded.updated_at`,
      [Number(id), color ?? '', now],
    );
    if (color) done++;
  }
  return done;
}
