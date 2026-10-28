/**
 * The site's Telegram posts: the free call in the morning, the day's results at
 * night. Built from the public API only (what any reader can already see), so
 * a members' call can never leak into a post.
 *
 * `telegram:preview` sends both to the owner's private chat with the bot, never
 * to the channel, so the look can be judged in Telegram itself.
 *
 * Voice: offside-voice. The odds always say "odds of"; every results post gives
 * the day's true count and lists the misses beside the wins; 18+ on every post.
 */

// @ts-expect-error plain ES module shared with the front end, no types
import { describe } from '../../public/js/lib/markets.js';

const SITE = 'https://offside.win';
const API = 'https://api.telegram.org';
const LANDED = new Set(['WON', 'HALF_WON']);
const GRADED = new Set(['WON', 'HALF_WON', 'LOST', 'HALF_LOST']);
const FOOT = '18+ · BeGambleAware.org';

interface Pick {
  fixture_id: number; kickoff: number; market: string; outcome: string; line: number | null;
  odds: number; bookmaker?: string | null; result: string | null; narrative?: string | null;
  home_team: string; away_team: string; home_goals: number | null; away_goals: number | null; league_id: number;
}

const esc = (s: unknown) => String(s ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]!));
const odds = (v: number) => Number(v).toFixed(2);
const ukDay = (t: number) => new Date(t * 1000).toLocaleDateString('en-CA', { timeZone: 'Europe/London' });
const ukTime = (t: number) => new Date(t * 1000).toLocaleTimeString('en-GB', { timeZone: 'Europe/London', hour: '2-digit', minute: '2-digit' });
const dayName = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-GB', { weekday: 'long', timeZone: 'UTC' });
const slug = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'match';
const matchUrl = (id: number, h: string, a: string) => `${SITE}/match/${id}/${slug(h)}-v-${slug(a)}`;
const NUM = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];
const word = (n: number) => NUM[n] ?? String(n);

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${SITE}${path}`, { headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
  return await res.json() as T;
}

function callOf(p: Pick) {
  const d = describe({ market: p.market, outcome: p.outcome, line: p.line, home: p.home_team, away: p.away_team, odds: p.odds });
  const loses = (d.outcomes ?? []).find((o: { result: string }) => o.result === 'loss')?.label as string | undefined;
  return { name: d.name as string, market: (d.bet?.market ?? '') as string, loses };
}

/** The first two sentences of the analysis: the take, not the whole argument. */
function take(text: string | null | undefined): string {
  const s = String(text ?? '').replace(/\s+/g, ' ').trim();
  const parts = s.match(/[^.!?]+[.!?]+/g) ?? [];
  return parts.slice(0, 2).join('').trim();
}

export interface Post { photo?: string; text: string; button?: { text: string; url: string } }

/** Morning: today's free call, on the match's share card. Null when there is none. */
export async function freeCallPost(): Promise<Post | null> {
  const hero = await get<{ free_fixture_id?: number | null }>('/api/hero');
  const id = Number(hero.free_fixture_id);
  if (!id) return null;
  const { picks } = await get<{ picks: Pick[] }>('/api/picks?limit=60');
  const p = picks.find((x) => Number(x.fixture_id) === id && !x.result);
  if (!p) return null;
  const f = await get<{ league?: string }>(`/api/fixture/${id}`).catch(() => ({} as { league?: string }));
  const c = callOf(p);
  const at = p.bookmaker ? ` at ${esc(p.bookmaker)}` : '';
  const lines = [
    `<b>Today's free call</b>`,
    '',
    `<b>${esc(p.home_team)} v ${esc(p.away_team)}</b>`,
    `${esc(f.league ?? '')}${f.league ? ' · ' : ''}${ukTime(p.kickoff)} UK time`,
    '',
    `<b>${esc(c.name)}</b>${c.market ? ` (${esc(c.market)})` : ''}, odds of ${odds(p.odds)}${at}`,
    ...(c.loses ? [`Only loses if ${esc([p.home_team, p.away_team].some((t) => c.loses!.startsWith(t)) ? c.loses : c.loses.charAt(0).toLowerCase() + c.loses.slice(1))}.`] : []),
  ];
  const t = take(p.narrative);
  if (t) lines.push('', `<i>${esc(t)}</i>`);
  lines.push('', FOOT);
  return {
    photo: `${SITE}/og/${id}.jpg?t=${Math.floor(Date.now() / 3.6e6)}`,
    text: lines.join('\n'),
    button: { text: 'Read the full case', url: matchUrl(id, p.home_team, p.away_team) },
  };
}

/** Night: one day's results, every graded call, the true count first. */
export async function resultsPost(day?: string): Promise<Post | null> {
  const { picks } = await get<{ picks: Pick[] }>('/api/picks?limit=200&settled=true');
  const settled = picks.filter((p) => p.result && p.home_goals !== null);
  const today = ukDay(Date.now() / 1000);
  const d = day || [...new Set(settled.map((p) => ukDay(p.kickoff)))].filter((x) => x < today && settled.some((p) => ukDay(p.kickoff) === x && GRADED.has(p.result!))).sort().pop();
  if (!d) return null;
  const on = settled.filter((p) => ukDay(p.kickoff) === d).sort((a, b) => a.kickoff - b.kickoff);
  const graded = on.filter((p) => GRADED.has(p.result!));
  if (!graded.length) return null;
  const landed = graded.filter((p) => LANDED.has(p.result!));
  const back = on.filter((p) => p.result === 'PUSH' || p.result === 'VOID').length;
  const row = (p: Pick) => {
    const mark = LANDED.has(p.result!) ? '✅' : GRADED.has(p.result!) ? '❌' : '↩️';
    return `${mark} ${esc(p.home_team)} ${p.home_goals}–${p.away_goals} ${esc(p.away_team)}\n      ${esc(callOf(p).name)}, odds of ${odds(p.odds)}`;
  };
  const head = landed.length === graded.length
    ? `<b>${dayName(d)}: all ${word(graded.length)} calls landed</b>`
    : `<b>${dayName(d)}: ${landed.length} of ${graded.length} calls landed</b>`;
  const lines = [head, ...(back ? [`${back === 1 ? 'One more' : `${word(back)} more`} came back as a refund.`] : []), '', ...on.map(row), '', FOOT];
  // The share card of the longest price that landed: the one people stop for.
  const lead = [...landed].sort((a, b) => b.odds - a.odds)[0];
  return {
    ...(lead ? { photo: `${SITE}/og/${lead.fixture_id}.jpg?t=${Math.floor(Date.now() / 3.6e6)}` } : {}),
    text: lines.join('\n'),
    button: { text: 'Every call and every result', url: `${SITE}/results` },
  };
}

async function tg(token: string, method: string, body: Record<string, unknown>) {
  const res = await fetch(`${API}/bot${token}/${method}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const j = await res.json().catch(() => ({})) as { ok?: boolean; description?: string };
  if (!j.ok) throw new Error(`${method}: ${j.description ?? `HTTP ${res.status}`}`);
}

/** Send one post to a chat: a photo with the text as its caption when it fits, else the text alone. */
export async function send(token: string, chat: string | number, post: Post): Promise<void> {
  const reply_markup = post.button ? { inline_keyboard: [[{ text: post.button.text, url: post.button.url }]] } : undefined;
  // Telegram caps a caption at 1,024 characters (markup not counted, roughly).
  if (post.photo && post.text.length <= 1000) {
    await tg(token, 'sendPhoto', { chat_id: chat, photo: post.photo, caption: post.text, parse_mode: 'HTML', reply_markup });
    return;
  }
  if (post.photo) await tg(token, 'sendPhoto', { chat_id: chat, photo: post.photo });
  await tg(token, 'sendMessage', { chat_id: chat, text: post.text, parse_mode: 'HTML', link_preview_options: { is_disabled: true }, reply_markup });
}

/** The owner's private chat with the bot: the latest one that pressed Start. */
export async function ownerChat(token: string): Promise<number | null> {
  const res = await fetch(`${API}/bot${token}/getUpdates`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ allowed_updates: ['message'] }) });
  const j = await res.json().catch(() => ({})) as { result?: Array<{ message?: { chat?: { id: number; type: string } } }> };
  const ids = (j.result ?? []).map((u) => u.message?.chat).filter((c) => c?.type === 'private').map((c) => c!.id);
  return ids.length ? ids[ids.length - 1]! : null;
}

export async function telegramPreview(arg = ''): Promise<void> {
  const token = (process.env['TELEGRAM_BOT_TOKEN'] ?? '').trim();
  if (!token) throw new Error('TELEGRAM_BOT_TOKEN is not set in Actions secrets');
  const chat = await ownerChat(token);
  if (!chat) throw new Error('no private chat with the bot yet: open it in Telegram and press Start');
  await tg(token, 'sendMessage', { chat_id: chat, text: 'Preview: the two daily posts as the channel would get them. Nothing was posted to the channel.' });
  const morning = await freeCallPost();
  if (morning) { await send(token, chat, morning); console.log('morning post: sent'); } else console.log('morning post: no free call today');
  const night = await resultsPost(arg.trim() || undefined);
  if (night) { await send(token, chat, night); console.log('night post: sent'); } else console.log('night post: no settled day found');
}
