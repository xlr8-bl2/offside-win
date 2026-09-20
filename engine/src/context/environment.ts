import { num, pickNum, pickStr } from '../bsd.ts';
import { adj, clamp, computed, effect, thin, unavailable } from '../ledger.ts';
import type { Claim, Factor } from '../types.ts';
import type { FixtureContext } from './types.ts';

/**
 * §6 — the environment.
 *
 * These are multipliers on everything above, not primary drivers, and §12 ranks
 * them sixth for that reason. They still matter: heavy rain amplifies a tactical
 * mismatch, and the doctrine gives concrete thresholds rather than vibes.
 *
 * Note what is *not* here. Home advantage itself is fitted as γ inside the
 * Dixon-Coles model, so re-applying it as a context factor would double-count
 * it. Neutral ground is handled where λ is computed, because removing a fitted
 * home advantage is a structural correction of roughly 20% and would be clipped
 * to nonsense by the per-factor cap that exists to stop doctrine factors running
 * away. A cap designed for judgement calls should not be applied to arithmetic.
 */

interface Weather {
  precipitationMm: number | null;
  windKph: number | null;
  tempC: number | null;
  description: string | null;
}

export function parseWeather(raw: unknown): Weather | null {
  if (raw === null || raw === undefined) return null;
  const precipitationMm =
    pickNum(raw, 'precipitation', 'precipitation_mm', 'precip', 'rain', 'rain_mm', 'rainfall') ?? null;
  let windKph =
    pickNum(raw, 'wind_speed_kph', 'wind_kph', 'wind_speed', 'wind', 'windSpeed') ?? null;
  // Some feeds report wind in m/s; 40 m/s is a hurricane, so anything under it
  // that came from an ambiguous field is almost certainly m/s.
  const windUnit = pickStr(raw, 'wind_unit', 'wind_speed_unit');
  if (windKph !== null && (windUnit === 'ms' || windUnit === 'm/s')) windKph *= 3.6;

  const tempC = pickNum(raw, 'temperature', 'temperature_c', 'temp', 'temp_c') ?? null;
  const description = pickStr(raw, 'description', 'summary', 'condition', 'text') ?? null;

  if (precipitationMm === null && windKph === null && tempC === null && description === null) {
    return null;
  }
  return { precipitationMm, windKph, tempC, description };
}

export function environmentFactors(ctx: FixtureContext): Factor[] {
  return [weatherFactor(ctx), pitchFactor(ctx), venueFactor(ctx)];
}

function weatherFactor(ctx: FixtureContext): Factor {
  const w = parseWeather(ctx.event['weather']);

  if (!w) {
    return unavailable({
      id: 'environment.weather',
      section: '§6.2',
      tier: 6,
      note: 'No weather reported for this fixture.',
    });
  }

  const adjustments = [];
  const claims: Claim[] = [];
  const notes: string[] = [];
  let strength = 0;

  // §6.2: rain above ten millimetres reduces passing accuracy, increases
  // defensive errors from miscontrolled balls, and creates more transitions.
  if (w.precipitationMm !== null && w.precipitationMm > 10) {
    const k = clamp((w.precipitationMm - 10) / 20, 0.2, 1);
    adjustments.push(adj('goals', 'both', effect(0.3 * k)));
    adjustments.push(adj('cards', 'both', effect(0.2 * k)));
    notes.push(`${w.precipitationMm.toFixed(0)} mm of rain`);
    claims.push({
      subject: 'the conditions',
      predicate: 'weather',
      polarity: 1,
      magnitude: k,
      evidence: { rain_mm: Math.round(w.precipitationMm) },
      section: '§6.2',
      tier: 6,
    });
    strength = Math.max(strength, k * 0.5);
  }

  // §6.2: wind above twenty-five km/h reduces crossing accuracy and long-ball
  // precision. Counter-intuitively corner *volume* can rise, because teams hit
  // it longer — it is the conversion that falls, not the count.
  if (w.windKph !== null && w.windKph > 25) {
    const k = clamp((w.windKph - 25) / 30, 0.2, 1);
    adjustments.push(adj('goals', 'both', effect(-0.2 * k)));
    adjustments.push(adj('corners', 'both', effect(0.2 * k)));
    notes.push(`${w.windKph.toFixed(0)} km/h wind`);
    claims.push({
      subject: 'the conditions',
      predicate: 'weather',
      polarity: -1,
      magnitude: k,
      evidence: { wind_kph: Math.round(w.windKph) },
      section: '§6.2',
      tier: 6,
    });
    strength = Math.max(strength, k * 0.4);
  }

  // §6.2: above thirty degrees, teams cannot sustain ninety minutes of pressing
  // and the second half closes up as heat compounds fatigue.
  if (w.tempC !== null && w.tempC > 30) {
    const k = clamp((w.tempC - 30) / 8, 0.2, 1);
    adjustments.push(adj('goals', 'both', effect(-0.3 * k)));
    adjustments.push(adj('corners', 'both', effect(-0.25 * k)));
    notes.push(`${w.tempC.toFixed(0)}°C heat`);
    claims.push({
      subject: 'the conditions',
      predicate: 'weather',
      polarity: -1,
      magnitude: k,
      evidence: { temperature_c: Math.round(w.tempC) },
      section: '§6.2',
      tier: 6,
    });
    strength = Math.max(strength, k * 0.5);
  }

  // §6.2: frost changes the bounce and favours direct play over technical
  // passing, producing more unpredictable defensive errors.
  if (w.tempC !== null && w.tempC <= 1) {
    adjustments.push(adj('goals', 'both', effect(0.12)));
    notes.push(`${w.tempC.toFixed(0)}°C, with a hard surface likely`);
    strength = Math.max(strength, 0.25);
  }

  const evidence = {
    rain_mm: w.precipitationMm,
    wind_kph: w.windKph,
    temperature_c: w.tempC,
    description: w.description,
  };

  if (notes.length === 0) {
    return computed({
      id: 'environment.weather',
      section: '§6.2',
      tier: 6,
      note: 'Conditions are unremarkable — nothing here crosses the doctrine’s thresholds.',
      evidence,
      strength: 0,
    });
  }

  return computed({
    id: 'environment.weather',
    section: '§6.2',
    tier: 6,
    note: `Conditions: ${notes.join(', ')}.`,
    evidence,
    adjustments,
    claims,
    strength: clamp(strength, 0, 0.6),
  });
}

/**
 * §6.3 pitch condition.
 *
 * The provider ships this as a bare integer with no documented scale, and
 * guessing which end is "heavy" would be inventing a reading. So it is recorded
 * as evidence and left inert until the scale is confirmed against live data
 * (run `npm run probe`, then set PITCH_SCALE_MAX). Reporting a number we cannot
 * interpret is honest; acting on one we cannot interpret is not.
 */
function pitchFactor(ctx: FixtureContext): Factor {
  const raw = num(ctx.event['pitch_condition']);
  const scaleMax = Number(process.env.PITCH_SCALE_MAX ?? '');

  if (raw === undefined) {
    return unavailable({
      id: 'environment.pitch',
      section: '§6.3',
      tier: 6,
      note: 'No pitch condition reported for this fixture.',
    });
  }

  if (!Number.isFinite(scaleMax) || scaleMax <= 1) {
    return thin({
      id: 'environment.pitch',
      section: '§6.3',
      tier: 6,
      note:
        `Pitch condition reported as ${raw}, but the provider documents no scale for it. ` +
        `Recorded and excluded until the scale is confirmed — set PITCH_SCALE_MAX once known.`,
      evidence: { pitch_condition: raw },
    });
  }

  // Convention once configured: higher is worse (heavier, more broken up).
  const severity = clamp(raw / scaleMax, 0, 1);
  if (severity < 0.5) {
    return computed({
      id: 'environment.pitch',
      section: '§6.3',
      tier: 6,
      note: `Pitch is in good order (${raw}/${scaleMax}).`,
      evidence: { pitch_condition: raw, scale_max: scaleMax },
      strength: 0,
    });
  }

  const k = (severity - 0.5) * 2;
  return computed({
    id: 'environment.pitch',
    section: '§6.3',
    tier: 6,
    note: `A heavy surface (${raw}/${scaleMax}) slows the game and blunts short passing combinations.`,
    evidence: { pitch_condition: raw, scale_max: scaleMax },
    adjustments: [adj('goals', 'both', effect(-0.25 * k))],
    claims: [
      {
        subject: 'the pitch',
        predicate: 'pitch',
        polarity: -1,
        magnitude: k,
        evidence: { rating: raw, scale_max: scaleMax },
        section: '§6.3',
        tier: 6,
      },
    ],
    strength: clamp(k * 0.4, 0, 0.4),
  });
}

/**
 * §6.1 home and away.
 *
 * The advantage itself is already fitted as γ in the ratings, so this only
 * reports the exceptions: neutral ground (handled where λ is computed, not
 * capped here) and crowd size. Crowd quality genuinely cannot be assessed
 * before kickoff from this feed — attendance is only populated afterwards — so
 * it says so rather than reaching for a proxy.
 */
function venueFactor(ctx: FixtureContext): Factor {
  const neutral = ctx.event['is_neutral_ground'] === true;
  const attendance = num(ctx.event['attendance']);

  if (neutral) {
    return computed({
      id: 'environment.venue',
      section: '§6.1',
      tier: 6,
      note:
        `Played at a neutral venue, so ${ctx.home.team_name}'s fitted home advantage is removed ` +
        `from the reading rather than applied.`,
      evidence: { neutral_ground: true, home_adv_removed: ctx.model.params.home_adv },
      claims: [
        {
          subject: ctx.home.team_name,
          predicate: 'crowd',
          polarity: -1,
          magnitude: 0.5,
          evidence: { neutral: 'yes' },
          section: '§6.1',
          tier: 6,
        },
      ],
      strength: 0.4,
    });
  }

  if (attendance === undefined || attendance <= 0) {
    return unavailable({
      id: 'environment.venue',
      section: '§6.1',
      tier: 6,
      note:
        'Attendance is only published after kickoff, so crowd size cannot be assessed in advance. ' +
        'Home advantage is carried by the fitted rating rather than estimated here.',
      evidence: { home_adv: ctx.model.params.home_adv },
    });
  }

  return computed({
    id: 'environment.venue',
    section: '§6.1',
    tier: 6,
    note: `Home fixture with an attendance of ${attendance.toLocaleString('en-GB')}.`,
    evidence: { attendance, home_adv: ctx.model.params.home_adv },
    strength: 0.1,
  });
}

export const _internals = { parseWeather };
