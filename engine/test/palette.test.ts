import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  choosePalette, pairPalettes, contrast, distance, hex, liftForDark, isAchromatic,
  saturation, separated, hue, type Sample,
} from '../src/poster/palette.ts';

const s = (r: number, g: number, b: number, weight: number): Sample => ({ colour: { r, g, b }, weight });
const BLACK = { r: 10, g: 11, b: 14 };

test('the club colour wins over the white the crest is mostly made of', () => {
  // A typical crest: lots of white background, a band of the club's red.
  const p = choosePalette([
    s(255, 255, 255, 600),
    s(200, 16, 46, 180),
    s(12, 12, 12, 90),
  ]);
  assert.ok(p.primary.r > 140 && p.primary.g < 110, `expected a red, got ${hex(p.primary)}`);
});

test('gold detailing does not become the club colour', () => {
  // Gold trim is common and is never what a supporter would name.
  const p = choosePalette([
    s(255, 255, 255, 400),
    s(0, 53, 148, 200),   // navy — the actual club colour
    s(212, 175, 55, 120), // gold trim
  ]);
  assert.ok(p.primary.b > p.primary.r, `expected a blue, got ${hex(p.primary)}`);
});

test('a single-colour crest still gets a usable second colour', () => {
  // Juventus, Newcastle: black and white and nothing else.
  const p = choosePalette([s(255, 255, 255, 500), s(20, 20, 20, 480), s(120, 120, 120, 40)]);
  assert.ok(distance(p.primary, p.secondary) > 20, 'primary and secondary collapsed together');
});

test('every primary is legible on the near-black ground', () => {
  const crests: Sample[][] = [
    [s(0, 0, 90, 300)],              // very dark navy
    [s(20, 20, 20, 300)],            // near black
    [s(120, 0, 0, 300)],             // deep maroon
    [s(0, 60, 0, 300)],              // bottle green
  ];
  for (const c of crests) {
    const p = choosePalette(c);
    assert.ok(contrast(p.primary, BLACK) >= 2.9,
      `${hex(p.primary)} is ${contrast(p.primary, BLACK).toFixed(2)}:1 on the ground`);
  }
});

test('type on the primary is always readable', () => {
  for (const c of [[s(255, 255, 0, 300)], [s(0, 0, 120, 300)], [s(200, 16, 46, 300)]]) {
    const p = choosePalette(c);
    assert.ok(contrast(p.ink, p.primary) >= 4.5,
      `ink ${hex(p.ink)} on ${hex(p.primary)} is only ${contrast(p.ink, p.primary).toFixed(2)}:1`);
  }
});

test('an unusable crest falls back to the brand rather than to noise', () => {
  assert.equal(hex(choosePalette([]).primary), '#e2b979');
  // A crest that is pure white gives nothing to sample.
  assert.equal(hex(choosePalette([s(255, 255, 255, 900)]).primary), '#e2b979');
});

test('two red clubs do not produce one flat red poster', () => {
  // Liverpool v Manchester United — the case that makes a poster look broken.
  const home = choosePalette([s(200, 16, 46, 300), s(255, 255, 255, 400)]);
  const away = choosePalette([s(218, 41, 28, 300), s(251, 225, 34, 90)]);
  const [h, a] = pairPalettes(home, away);
  assert.ok(distance(h.primary, a.primary) > 90,
    `${hex(h.primary)} and ${hex(a.primary)} are too close to tell apart`);
});

test('the home side keeps its colour when a clash is resolved', () => {
  const home = choosePalette([s(200, 16, 46, 300)]);
  const away = choosePalette([s(205, 20, 40, 300)]);
  const [h] = pairPalettes(home, away);
  assert.equal(hex(h.primary), hex(home.primary));
});

test('clubs that already differ are left alone', () => {
  const home = choosePalette([s(200, 16, 46, 300)]);   // red
  const away = choosePalette([s(0, 53, 148, 300)]);    // navy
  const [h, a] = pairPalettes(home, away);
  assert.equal(hex(h.primary), hex(home.primary));
  assert.equal(hex(a.primary), hex(away.primary));
});

test('liftForDark stops once it is legible rather than washing out', () => {
  const lifted = liftForDark({ r: 0, g: 0, b: 60 });
  assert.ok(contrast(lifted, BLACK) >= 3);
  assert.ok(contrast(lifted, BLACK) < 8, 'lifted further than it needed to');
});

test('two monochrome clubs still get a poster with colour in it', () => {
  // Juventus v Newcastle. Grey on black is not broken, it is lifeless, and
  // lifeless is the thing this exists to fix.
  const mono = choosePalette([s(255, 255, 255, 400), s(20, 20, 20, 380), s(120, 120, 120, 40)]);
  const [h, a] = pairPalettes(mono, mono);
  assert.ok(!isAchromatic(h.primary), `home came out grey: ${hex(h.primary)}`);
  assert.ok(!isAchromatic(a.primary), `away came out grey: ${hex(a.primary)}`);
  assert.ok(distance(h.primary, a.primary) > 110, 'the two sides are indistinguishable');
});

test('one monochrome club against a coloured one keeps the coloured one', () => {
  const mono = choosePalette([s(20, 20, 20, 400), s(255, 255, 255, 400)]);
  const red = choosePalette([s(200, 16, 46, 300)]);
  const [h, a] = pairPalettes(red, mono);
  assert.equal(hex(h.primary), hex(red.primary), 'the coloured home side was overridden');
  assert.ok(!isAchromatic(a.primary));
});

test('isAchromatic knows a club colour from a shade of grey', () => {
  assert.ok(isAchromatic({ r: 128, g: 128, b: 128 }));
  assert.ok(isAchromatic({ r: 200, g: 205, b: 210 }));
  assert.ok(!isAchromatic({ r: 200, g: 16, b: 46 }));
  assert.ok(!isAchromatic({ r: 0, g: 53, b: 148 }));
});

test('every pairing produces two colours that can be told apart', () => {
  // A sweep over the shapes that actually occur, because the failure is always
  // a pair rather than a single crest.
  const crests: Sample[][] = [
    [s(200, 16, 46, 300)],                    // red
    [s(218, 41, 28, 300)],                    // a different red
    [s(0, 53, 148, 300)],                     // navy
    [s(20, 20, 20, 300), s(255, 255, 255, 300)], // monochrome
    [s(255, 255, 255, 900)],                  // blank
    [s(0, 60, 0, 300)],                       // bottle green
    [s(255, 215, 0, 300)],                    // yellow
  ];
  for (const x of crests) {
    for (const y of crests) {
      const [h, a] = pairPalettes(choosePalette(x), choosePalette(y));
      assert.ok(separated(h.primary, a.primary),
        `${hex(h.primary)} vs ${hex(a.primary)} read as one field`);
      assert.ok(saturation(h.primary) > 0.1 || saturation(a.primary) > 0.1,
        'neither side brought any colour');
    }
  }
});

test('separation means a different colour, not a darker one', () => {
  // A bottle-green club's own primary and secondary. Distance calls them 144
  // apart — it weights green four times as heavily as red — but they are nine
  // degrees apart in hue and on the poster they are one field.
  const primary = { r: 69, g: 110, b: 64 };    // #456e40
  const secondary = { r: 32, g: 49, b: 33 };   // #203121
  assert.ok(distance(primary, secondary) > 110, 'precondition: distance says far apart');
  assert.ok(!separated(primary, secondary), 'two greens should not count as separated');

  assert.ok(separated(primary, { r: 91, g: 111, b: 150 }), 'green and slate are different colours');
});

test('hue returns nothing for a colour that has none', () => {
  assert.equal(hue({ r: 128, g: 128, b: 128 }), null);
  assert.ok(hue({ r: 200, g: 16, b: 46 }) !== null);
});
