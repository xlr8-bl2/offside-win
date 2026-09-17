/**
 * A club's colours, taken from its own crest.
 *
 * The front end has carried a twelve-entry palette indexed by a hash of the
 * club's name, which is deterministic and arbitrary: Arsenal does not come out
 * red. That is fine for a monogram nobody looks at twice and hopeless for a
 * poster, where the colour *is* the design.
 *
 * Crests are the one asset that is reliably there — stadium photographs exist
 * for about a third of grounds and a miss returns a 1x1 transparent PNG with
 * HTTP 200, so anything photo-led fails silently and often. So the poster is
 * built from the crest: sample it, find the two colours that carry the club,
 * and derive everything else from those.
 *
 * No image library. A PNG decoder for this would be a dependency and a licence
 * question; Chromium is already here for rendering, so the sampling happens in
 * a canvas inside the page that is about to be drawn, and this module holds the
 * colour maths that decides what to do with the samples.
 */

export interface Rgb { r: number; g: number; b: number }

export interface ClubPalette {
  /** The colour a supporter would name. */
  primary: Rgb;
  /** The second colour, far enough from the first to be seen against it. */
  secondary: Rgb;
  /** Type that stays legible on `primary`. */
  ink: Rgb;
}

const BLACK: Rgb = { r: 10, g: 11, b: 14 };
const CREAM: Rgb = { r: 244, g: 238, b: 226 };

/* --------------------------------------------------------------- distance */

export function luminance({ r, g, b }: Rgb): number {
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

export function contrast(a: Rgb, b: Rgb): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** Perceptual-ish distance. Good enough to tell two club colours apart. */
export function distance(a: Rgb, b: Rgb): number {
  const rm = (a.r + b.r) / 2;
  const dr = a.r - b.r;
  const dg = a.g - b.g;
  const db = a.b - b.b;
  return Math.sqrt((2 + rm / 256) * dr * dr + 4 * dg * dg + (2 + (255 - rm) / 256) * db * db);
}

export function saturation({ r, g, b }: Rgb): number {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  return max === 0 ? 0 : (max - min) / max;
}

export function hex(c: Rgb): string {
  const h = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
  return `#${h(c.r)}${h(c.g)}${h(c.b)}`;
}

export function mix(a: Rgb, b: Rgb, t: number): Rgb {
  return { r: a.r + (b.r - a.r) * t, g: a.g + (b.g - a.g) * t, b: a.b + (b.b - a.b) * t };
}

/** Push a colour until it reads on a near-black ground. */
export function liftForDark(c: Rgb, minContrast = 3): Rgb {
  let out = c;
  for (let i = 0; i < 24 && contrast(out, BLACK) < minContrast; i++) out = mix(out, CREAM, 0.08);
  return out;
}

/** The brand's own accent, and a cool counterpart, for clubs that have no colour. */
const BRAND: Rgb = { r: 226, g: 185, b: 121 };
const SLATE: Rgb = { r: 91, g: 111, b: 150 };

/* ---------------------------------------------------------------- choosing */

export interface Sample { colour: Rgb; weight: number }

/**
 * Pick a club's two colours from sampled crest pixels.
 *
 * The rules come from what crests actually look like rather than from colour
 * theory. Crests are mostly white or transparent around the edge, so raw
 * frequency picks white every time and every poster comes out the same. Gold
 * and silver detailing is common and is never the club's colour. And a
 * single-colour crest — Juventus, Newcastle — has no second colour to find, so
 * one is derived rather than invented from noise.
 */
export function choosePalette(samples: Sample[]): ClubPalette {
  const usable = samples
    .filter((s) => s.weight > 0)
    // Near-white and near-black are background and outline, not identity.
    .filter((s) => {
      const l = luminance(s.colour);
      return l > 0.02 && l < 0.88;
    })
    // A grey pixel carries no club identity; a desaturated one barely does.
    .map((s) => ({ ...s, score: s.weight * (0.25 + saturation(s.colour)) }))
    .sort((a, b) => b.score - a.score);

  if (usable.length === 0) {
    // Nothing usable in the crest at all — a plain white badge, or no crest.
    // The brand's own accent is the honest fallback, not a random hue. The
    // companion is the slate rather than black: black lifts to a muddy grey,
    // which is what two crestless clubs used to produce between them.
    return { primary: BRAND, secondary: SLATE, ink: BLACK };
  }

  const primary = liftForDark(usable[0]!.colour);

  // The second colour has to be visibly different, or the poster is one flat
  // field. 90 is about the distance between a club's red and its navy.
  const second = usable.find((s) => distance(s.colour, usable[0]!.colour) > 90);
  const secondary = second
    ? liftForDark(second.colour)
    : // Single-colour crest: derive a darker companion rather than invent a hue.
      mix(primary, BLACK, 0.62);

  const ink = contrast(CREAM, primary) >= contrast(BLACK, primary) ? CREAM : BLACK;

  return { primary, secondary, ink };
}


/**
 * Hue angle in degrees, or null for a colour with no hue worth naming.
 *
 * Needed because `distance` alone is not enough to decide whether two clubs
 * will read as two clubs. It weights green four times as heavily as red, so a
 * bottle green and a darker bottle green come out 160 apart — comfortably past
 * any threshold — while on the poster they are plainly one field. Separation
 * has to mean a different colour, not a different amount of the same one.
 */
export function hue(c: Rgb): number | null {
  const max = Math.max(c.r, c.g, c.b);
  const min = Math.min(c.r, c.g, c.b);
  const d = max - min;
  if (d < 12) return null;
  let h: number;
  if (max === c.r) h = ((c.g - c.b) / d) % 6;
  else if (max === c.g) h = (c.b - c.r) / d + 2;
  else h = (c.r - c.g) / d + 4;
  h *= 60;
  return h < 0 ? h + 360 : h;
}

/** True when two colours read as different colours rather than two shades. */
export function separated(a: Rgb, b: Rgb): boolean {
  if (distance(a, b) <= 110) return false;
  const ha = hue(a);
  const hb = hue(b);
  // One of them is effectively grey: distance is the whole story.
  if (ha === null || hb === null) return true;
  const gap = Math.abs(ha - hb);
  return Math.min(gap, 360 - gap) >= 35;
}

/** A crest with no colour in it — Juventus, Newcastle, most monochrome badges. */
export function isAchromatic(c: Rgb): boolean {
  return saturation(c) < 0.14;
}

/**
 * Two clubs side by side.
 *
 * Three things go wrong here and all of them make a poster look broken rather
 * than plain:
 *
 * Both sides in red — Liverpool v Manchester United, Milan v Roma — merges the
 * two halves into one field. The away side moves to its own second colour, and
 * failing that is pushed dark. The home side never moves: it is their ground.
 *
 * Both sides monochrome — Juventus v Newcastle — produces a poster with no
 * colour anywhere, which is not broken but is lifeless, and lifeless is the
 * thing this whole exercise exists to fix. A club with no colour of its own
 * borrows one: the brand accent at home, a cool slate away, so the two sides
 * still read as two sides.
 */
export function pairPalettes(home: ClubPalette, away: ClubPalette): [ClubPalette, ClubPalette] {
  let h = home;
  let a = away;

  // A grey glow is no glow. Give a colourless club something to bring.
  if (isAchromatic(h.primary)) h = { ...h, primary: BRAND, ink: BLACK };
  if (isAchromatic(a.primary)) a = { ...a, primary: SLATE, ink: CREAM };

  if (separated(h.primary, a.primary)) return [h, a];

  if (!isAchromatic(a.secondary) && separated(h.primary, a.secondary)) {
    return [h, { ...a, primary: liftForDark(a.secondary), secondary: a.primary }];
  }

  // Nothing in the away crest separates from the home colour: take the cool
  // counterpart rather than a darker shade of the same thing.
  if (separated(h.primary, SLATE)) return [h, { ...a, primary: SLATE, ink: CREAM }];
  // Home is itself slate-ish: the warm accent is the remaining contrast.
  if (separated(h.primary, BRAND)) return [h, { ...a, primary: BRAND, ink: BLACK }];

  const pushed = liftForDark(mix(a.primary, BLACK, 0.55), 2);
  return [h, { ...a, primary: pushed }];
}
