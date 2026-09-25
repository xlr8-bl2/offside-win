import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deflateSync } from 'node:zlib';
import { crestColor, decodePng } from '../src/images/crest.ts';

/** A minimal PNG writer, for building crests the decoder has to read. */
function png(width: number, height: number, type: number, depth: number, rows: number[][], extra: Array<[string, number[]]> = [], filter = 0): Uint8Array {
  const chunk = (name: string, data: number[] | Buffer) => {
    const body = Buffer.from(data);
    const len = Buffer.alloc(4); len.writeUInt32BE(body.length);
    return Buffer.concat([len, Buffer.from(name, 'ascii'), body, Buffer.alloc(4)]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
  ihdr[8] = depth; ihdr[9] = type;
  const raw = Buffer.from(rows.flatMap((r) => [filter, ...r]));
  return new Uint8Array(Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    ...extra.map(([n, d]) => chunk(n, d)),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', []),
  ]));
}

test('decodes a palette PNG with transparency', () => {
  // Index 0 transparent, 1 red, 2 white.
  const buf = png(2, 2, 3, 8, [[0, 1], [2, 1]], [['PLTE', [0, 0, 0, 200, 16, 46, 255, 255, 255]], ['tRNS', [0]]]);
  const px = decodePng(buf);
  assert.equal(px.width, 2);
  assert.deepEqual([...px.rgba.subarray(0, 8)], [0, 0, 0, 0, 200, 16, 46, 255]);
  assert.deepEqual([...px.rgba.subarray(8, 12)], [255, 255, 255, 255]);
});

test('decodes an RGBA PNG and undoes a Sub filter', () => {
  // Filter 1 (Sub): the second pixel is stored as its difference from the first.
  const px = decodePng(png(2, 1, 6, 8, [[10, 20, 30, 255, 5, 5, 5, 0]], [], 1));
  assert.deepEqual([...px.rgba], [10, 20, 30, 255, 15, 25, 35, 255]);
});

test('picks the strong colour over white and ignores a small accent', () => {
  // 100 px: 60 white, 34 navy, 6 red. Navy is the shirt; red is a detail.
  const w = [255, 255, 255, 255], n = [12, 40, 110, 255], r = [220, 20, 40, 255];
  const rgba = new Uint8Array([...Array(60).fill(w), ...Array(34).fill(n), ...Array(6).fill(r)].flat());
  const c = crestColor({ width: 10, height: 10, rgba })!;
  assert.match(c, /^#[0-9a-f]{6}$/);
  const [R, G, B] = [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
  assert.ok(B! > R! && B! > G!, `expected navy, got ${c}`);
});

test('a black and white crest still gives a colour dark page type can sit on', () => {
  const rgba = new Uint8Array([...Array(50).fill([0, 0, 0, 255]), ...Array(50).fill([255, 255, 255, 255])].flat());
  const c = crestColor({ width: 10, height: 10, rgba })!;
  const l = parseInt(c.slice(1, 3), 16) / 255;
  assert.ok(l >= 0.24 && l <= 0.61, `lightness held in range, got ${c}`);
});

test('a fully transparent image has no colour', () => {
  assert.equal(crestColor({ width: 1, height: 1, rgba: new Uint8Array([0, 0, 0, 0]) }), null);
});
