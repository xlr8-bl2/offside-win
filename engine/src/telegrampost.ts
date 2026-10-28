/**
 * The site's Telegram posts: the free call in the morning, the day's results at
 * night. Built from the public API only (what any reader can already see), so
 * a members' call can never leak into a post.
 *
 * Each post is a drawn picture (social/graphics.ts) with a caption
 * (social/copy.ts); a results post is followed by the win or loss reaction
 * (social/reactions.ts, engine/assets).
 *
 * `telegram:preview` sends them to the owner's private chat with the bot, never
 * to the channel, so the look can be judged in Telegram itself.
 */

import { readFileSync } from 'node:fs';
// @ts-expect-error plain ES module shared with the front end, no types
import { describe } from '../../public/js/lib/markets.js';
import { fetchCrest } from './poster/render.ts';
import { freeCallHTML, render, resultsHTML, type Browserish, type ResultRow } from './social/graphics.ts';
import { fallbackHook, highlight, plain, resultsHook, resultsLead, writtenHook, type CallFacts } from './social/copy.ts';

const SITE = 'https://offside.win';
const API = 'https://api.telegram.org';
const LANDED = new Set(['WON', 'HALF_WON']);
const GRADED = new Set(['WON', 'HALF_WON', 'LOST', 'HALF_LOST']);
const FOOT = '<i>18+ · BeGambleAware.org</i>';

interface Pick {
  fixture_id: number; kickoff: number; market: string; outcome: string; line: number | null;
  odds: number; bookmaker?: string | null; result: string | null; narrative?: string | null;
  home_team: string; away_team: string; home_goals: number | null; away_goals: number | null;
  league_id: number; home_team_id?: number | null; away_team_id?: number | null;
}

const esc = (s: unknown) => String(s ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]!));
const odds = (v: number) => Number(v).toFixed(2);
const ukDay = (t: number) => new Date(t * 1000).toLocaleDateString('en-CA', { timeZone: 'Europe/London' });
const ukTime = (t: number) => new Date(t * 1000).toLocaleTimeString('en-GB', { timeZone: 'Europe/London', hour: '2-digit', minute: '2-digit' });
const ukDate = (t: number) => new Date(t * 1000).toLocaleDateString('en-GB', { timeZone: 'Europe/London', weekday: 'short', day: 'numeric', month: 'short' });
const dayName = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-GB', { weekday: 'long', timeZone: 'UTC' });
const slug = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'match';
const matchUrl = (id: number, h: string, a: string) => `${SITE}/match/${id}/${slug(h)}-v-${slug(a)}`;

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${SITE}${path}`, { headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
  return await res.json() as T;
}

function callOf(p: Pick) {
  const d = describe({ market: p.market, outcome: p.outcome, line: p.line, home: p.home_team, away: p.away_team, odds: p.odds });
  const loss = (d.outcomes ?? []).find((o: { result: string }) => o.result === 'loss')?.label as string | undefined;
  const loses = loss ? ([p.home_team, p.away_team].some((t) => loss.startsWith(t)) ? loss : loss.charAt(0).toLowerCase() + loss.slice(1)) : null;
  return { name: d.name as string, market: (d.bet?.market ?? '') as string, loses };
}

function factsOf(p: Pick): CallFacts {
  const away = p.outcome === 'AWAY' || p.outcome === 'X2';
  return { market: p.market, outcome: p.outcome, line: p.line, home: p.home_team, away: p.away_team,
    backed: away ? p.away_team : p.home_team, other: away ? p.home_team : p.away_team };
}

/** The first two sentences of the analysis: the take, not the whole argument. */
function take(text: string | null | undefined): string {
  const s = String(text ?? '').replace(/\s+/g, ' ').trim();
  return (s.match(/[^.!?]+[.!?]+/g) ?? []).slice(0, 2).join('').trim();
}

export interface Post { photo?: Buffer; text: string; button?: { text: string; url: string }; reaction?: 'win' | 'loss' }

/** Morning: today's free call. Null when there is none. */
export async function freeCallPost(browser: Browserish): Promise<Post | null> {
  const hero = await get<{ free_fixture_id?: number | null }>('/api/hero');
  const id = Number(hero.free_fixture_id);
  if (!id) return null;
  const { picks } = await get<{ picks: Pick[] }>('/api/picks?limit=60');
  const p = picks.find((x) => Number(x.fixture_id) === id && !x.result);
  if (!p) return null;
  const f = await get<{ league?: string }>(`/api/fixture/${id}`).catch(() => ({} as { league?: string }));
  const c = callOf(p);
  const facts = factsOf(p);
  const hook = (await writtenHook(facts, p.narrative ?? '', c.name)) ?? fallbackHook(facts);
  const [homeCrest, awayCrest] = await Promise.all([fetchCrest(p.home_team_id), fetchCrest(p.away_team_id)]);
  const photo = await render(browser, freeCallHTML({
    home: p.home_team, away: p.away_team, homeCrest, awayCrest, competition: f.league ?? '',
    kickoff: ukTime(p.kickoff), day: ukDate(p.kickoff), hook: highlight(hook),
    call: c.name, market: c.market, odds: odds(p.odds), loses: c.loses,
  }));
  const at = p.bookmaker ? ` at ${esc(p.bookmaker)}` : '';
  const t = take(p.narrative);
  const lines = [
    `🚨 <b>FREE CALL</b> · ${esc(p.home_team)} v ${esc(p.away_team)}`,
    '',
    `<b>${esc(plain(hook))}</b>`,
    '',
    `🎯 <b>${esc(c.name)}</b>${c.market ? ` (${esc(c.market)})` : ''}, odds of ${odds(p.odds)}${at}`,
    ...(c.loses ? [`Only loses if ${esc(c.loses)}.`] : []),
    `⏰ ${ukTime(p.kickoff)} UK${f.league ? ` · ${esc(f.league)}` : ''}`,
    ...(t ? ['', `<i>${esc(t)}</i>`] : []),
    '',
    'The full case is free on the site. Members get every call on the board 👇',
    '',
    FOOT,
  ];
  return { photo, text: lines.join('\n'), button: { text: 'Read the full case', url: matchUrl(id, p.home_team, p.away_team) } };
}

/** Night: one day's results, the true count first and every graded call shown. */
export async function resultsPost(browser: Browserish, day?: string): Promise<Post | null> {
  const { picks } = await get<{ picks: Pick[] }>('/api/picks?limit=200&settled=true');
  const settled = picks.filter((p) => p.result && p.home_goals !== null);
  const today = ukDay(Date.now() / 1000);
  const d = day || [...new Set(settled.map((p) => ukDay(p.kickoff)))]
    .filter((x) => x < today && settled.some((p) => ukDay(p.kickoff) === x && GRADED.has(p.result!))).sort().pop();
  if (!d) return null;
  const on = settled.filter((p) => ukDay(p.kickoff) === d).sort((a, b) => a.kickoff - b.kickoff);
  const graded = on.filter((p) => GRADED.has(p.result!));
  if (!graded.length) return null;
  const count = { landed: graded.filter((p) => LANDED.has(p.result!)).length, graded: graded.length };
  // Landed first, then the misses, then refunds: the misses stay on the picture.
  const order = (p: Pick) => (LANDED.has(p.result!) ? 0 : GRADED.has(p.result!) ? 1 : 2);
  const rows: ResultRow[] = [...on].sort((a, b) => order(a) - order(b) || a.kickoff - b.kickoff).map((p) => ({
    mark: LANDED.has(p.result!) ? 'won' : GRADED.has(p.result!) ? 'lost' : 'back',
    home: p.home_team, away: p.away_team, score: `${p.home_goals}–${p.away_goals}`, call: callOf(p).name, odds: odds(p.odds),
  }));
  // A day with more misses than the picture holds would hide them: put them first instead.
  if (rows.filter((r) => r.mark === 'lost').length && rows.length > 9) rows.sort((a, b) => (a.mark === 'lost' ? -1 : 0) - (b.mark === 'lost' ? -1 : 0));
  const photo = await render(browser, resultsHTML({ day: dayName(d), ...count, hook: resultsHook(count), rows }));
  const longest = graded.filter((p) => LANDED.has(p.result!)).sort((a, b) => b.odds - a.odds)[0];
  const missed = graded.filter((p) => !LANDED.has(p.result!));
  const lines = [
    ...resultsLead(count, dayName(d)),
    '',
    ...(longest ? [`💥 Longest price that landed: ${esc(longest.home_team)} ${longest.home_goals}–${longest.away_goals} ${esc(longest.away_team)}, ${esc(callOf(longest).name)} at odds of ${odds(longest.odds)}.`] : []),
    ...missed.map((p) => `❌ ${esc(p.home_team)} ${p.home_goals}–${p.away_goals} ${esc(p.away_team)}, ${esc(callOf(p).name)}.`),
    '',
    "Tomorrow's free call lands here in the morning. Turn notifications on 🔔",
    '',
    FOOT,
  ];
  return {
    photo, text: lines.join('\n'),
    button: { text: 'Every call and every result', url: `${SITE}/results` },
    reaction: count.landed / count.graded >= 0.7 ? 'win' : count.landed / count.graded < 0.5 ? 'loss' : undefined,
  };
}

async function tg(token: string, method: string, body: Record<string, unknown> | FormData) {
  const form = body instanceof FormData;
  const res = await fetch(`${API}/bot${token}/${method}`, { method: 'POST', ...(form ? {} : { headers: { 'content-type': 'application/json' } }), body: form ? body : JSON.stringify(body) });
  const j = await res.json().catch(() => ({})) as { ok?: boolean; description?: string };
  if (!j.ok) throw new Error(`${method}: ${j.description ?? `HTTP ${res.status}`}`);
}

function upload(fields: Record<string, unknown>, file: { name: string; field: string; bytes: Buffer; type: string }): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) if (v !== undefined) fd.append(k, typeof v === 'string' ? v : JSON.stringify(v));
  fd.append(file.field, new Blob([new Uint8Array(file.bytes)], { type: file.type }), file.name);
  return fd;
}

/** Send one post to a chat: the picture with the text as its caption, then the reaction if there is one. */
export async function send(token: string, chat: string | number, post: Post): Promise<void> {
  const reply_markup = post.button ? { inline_keyboard: [[{ text: post.button.text, url: post.button.url }]] } : undefined;
  // Telegram caps a caption at 1,024 characters of text; the markup does not count.
  const fits = post.text.replace(/<[^>]+>/g, '').length <= 1000;
  if (post.photo) {
    await tg(token, 'sendPhoto', upload({ chat_id: String(chat), ...(fits ? { caption: post.text, parse_mode: 'HTML', reply_markup } : {}) },
      { field: 'photo', name: 'post.jpg', bytes: post.photo, type: 'image/jpeg' }));
  }
  if ((!post.photo || !fits) && post.text) {
    await tg(token, 'sendMessage', { chat_id: chat, text: post.text, parse_mode: 'HTML', link_preview_options: { is_disabled: true }, reply_markup });
  }
  if (post.reaction) {
    const bytes = readFileSync(new URL(`../assets/react-${post.reaction}.mp4`, import.meta.url));
    await tg(token, 'sendAnimation', upload({ chat_id: String(chat) }, { field: 'animation', name: `${post.reaction}.mp4`, bytes, type: 'video/mp4' }));
  }
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
  const { chromium } = await import('playwright');
  const browser = await chromium.launch({ executablePath: process.env['CHROMIUM_PATH'] || undefined });
  try {
    await tg(token, 'sendMessage', { chat_id: chat, text: 'Preview v2: the morning post, the night post, and both reactions. Nothing was posted to the channel.' });
    const morning = await freeCallPost(browser as never);
    if (morning) { await send(token, chat, morning); console.log('morning post: sent'); } else console.log('morning post: no free call today');
    const night = await resultsPost(browser as never, arg.trim() || undefined);
    if (night) { await send(token, chat, { ...night, reaction: night.reaction ?? 'win' }); console.log('night post: sent'); } else console.log('night post: no settled day found');
    // The other reaction too, so both can be judged.
    await tg(token, 'sendMessage', { chat_id: chat, text: 'And the one for a bad night:' });
    await send(token, chat, { text: '', reaction: night?.reaction === 'loss' ? 'win' : 'loss' } as Post);
  } finally {
    await browser.close();
  }
}
