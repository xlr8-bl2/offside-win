/**
 * The channel's daily posts, on a schedule, with the owner's say-so.
 *
 *   draft    when a post is due (the free call from 08:30 UK; a day's results
 *            once every call that day has settled), it is drawn and sent to the
 *            owner's private chat with two buttons: Post and Skip.
 *   publish  a tap on Post copies that exact message to the channel and posts
 *            it to X (the picture, and a caption cut to fit); Skip drops it.
 *
 * `social:tick` does both, every ten minutes (social.yml). Taps are read with
 * getUpdates, so nothing on the site has to change. kv remembers what was
 * drafted and what was handled, so nothing goes out twice.
 *
 * Drawing needs Chromium. When a draft is due and the browser is missing, the
 * tick says so through $GITHUB_OUTPUT (draw=1) and the workflow installs it and
 * runs the tick again.
 */

import { appendFileSync, readFileSync } from 'node:fs';
import { kvGet, kvSet } from '../store.ts';
import { freeCallPost, ownerChat, resultsPost, tg, upload, type Post } from '../telegrampost.ts';
import { keys as xKeys, tweet, uploadImage, xText } from '../xpost.ts';

const SITE = 'https://offside.win';
const DAY = 86400;
const GRADED = new Set(['WON', 'HALF_WON', 'LOST', 'HALF_LOST']);

const ukDay = (t: number) => new Date(t * 1000).toLocaleDateString('en-CA', { timeZone: 'Europe/London' });
const ukMinutes = () => {
  const [h, m] = new Date().toLocaleTimeString('en-GB', { timeZone: 'Europe/London', hour: '2-digit', minute: '2-digit', hour12: false }).split(':').map(Number);
  return h! * 60 + m!;
};

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${SITE}${path}`, { headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
  return await res.json() as T;
}

interface Due { kind: 'morning' | 'night'; key: string; day?: string }

/** What is ready to draft now and has not been drafted. */
async function due(): Promise<Due[]> {
  const out: Due[] = [];
  const now = Date.now() / 1000;
  const today = ukDay(now);
  if (ukMinutes() >= 8 * 60 + 30) {
    const hero = await get<{ free_fixture_id?: number | null }>('/api/hero');
    const id = Number(hero.free_fixture_id);
    const key = `social:drafted:morning:${today}`;
    if (id && !(await kvGet(key))) out.push({ kind: 'morning', key });
  }
  // A day's results: once every call on it has settled. Today and yesterday,
  // so a late finish past midnight is still posted.
  const { picks } = await get<{ picks: Array<{ kickoff: number; result: string | null }> }>('/api/picks?limit=200');
  for (const d of [ukDay(now - DAY), today]) {
    const on = picks.filter((p) => ukDay(p.kickoff) === d);
    if (!on.some((p) => GRADED.has(p.result ?? ''))) continue;
    if (on.some((p) => !p.result)) continue;
    const key = `social:drafted:night:${d}`;
    if (!(await kvGet(key))) out.push({ kind: 'night', key, day: d });
  }
  return out;
}

async function owner(token: string): Promise<number> {
  const saved = await kvGet('social:owner_chat');
  if (saved) return Number(saved);
  const found = await ownerChat(token);
  if (!found) throw new Error('no private chat with the bot yet: open it in Telegram and press Start');
  await kvSet('social:owner_chat', String(found));
  return found;
}

/** Send a post to the owner with Post / Skip under it. The button data carries what publishing needs. */
async function sendDraft(token: string, chat: number, post: Post, tag: string): Promise<void> {
  const rows: unknown[][] = [];
  if (post.button) rows.push([{ text: post.button.text, url: post.button.url }]);
  rows.push([{ text: '✅ Post to Telegram and X', callback_data: `post:${tag}:${post.reaction ?? '-'}` }, { text: 'Skip', callback_data: `skip:${tag}` }]);
  await tg(token, 'sendPhoto', upload(
    { chat_id: String(chat), caption: post.text, parse_mode: 'HTML', reply_markup: { inline_keyboard: rows } },
    { field: 'photo', name: 'post.jpg', bytes: post.photo!, type: 'image/jpeg' },
  ));
}

interface Callback {
  id: string; data?: string; from: { id: number };
  message?: { message_id: number; chat: { id: number }; caption?: string; photo?: Array<{ file_id: string; width: number }>;
    reply_markup?: { inline_keyboard: Array<Array<{ text: string; url?: string; callback_data?: string }>> } };
}

/** Handle every Post / Skip tap not handled yet. */
async function publishTaps(token: string, chat: number, channel: string): Promise<void> {
  const updates = await tg<Array<{ update_id: number; callback_query?: Callback }>>(token, 'getUpdates', { allowed_updates: ['message', 'callback_query'] });
  for (const u of updates) {
    const q = u.callback_query;
    if (!q?.data || !q.message || q.from.id !== chat) continue;
    const doneKey = `social:done:${q.message.message_id}`;
    if (await kvGet(doneKey)) continue;
    await kvSet(doneKey, '1', 7 * DAY);
    await tg(token, 'answerCallbackQuery', { callback_query_id: q.id }).catch(() => null);
    const link = q.message.reply_markup?.inline_keyboard.flat().find((b) => b.url);
    const linkRow = link ? [[{ text: link.text, url: link.url }]] : [];
    if (q.data.startsWith('skip:')) {
      await tg(token, 'editMessageReplyMarkup', { chat_id: chat, message_id: q.message.message_id, reply_markup: { inline_keyboard: [...linkRow, [{ text: 'Skipped', callback_data: 'noop' }]] } }).catch(() => null);
      console.log('a draft was skipped');
      continue;
    }
    const report: string[] = [];
    // Telegram: the exact message the owner approved, without its buttons but with the link.
    try {
      await tg(token, 'copyMessage', { chat_id: channel, from_chat_id: chat, message_id: q.message.message_id, reply_markup: { inline_keyboard: linkRow } });
      const reaction = q.data.split(':').pop();
      if (reaction === 'win' || reaction === 'loss') {
        const bytes = readFileSync(new URL(`../../assets/react-${reaction}.mp4`, import.meta.url));
        await tg(token, 'sendAnimation', upload({ chat_id: channel }, { field: 'animation', name: `${reaction}.mp4`, bytes, type: 'video/mp4' }));
      }
      report.push('Telegram ✅');
    } catch (e) {
      report.push('Telegram ❌');
      console.log(`telegram channel: ${(e as Error).message}`);
    }
    // X: the same picture, the caption cut to fit.
    const k = xKeys();
    if (k) {
      try {
        const photo = [...(q.message.photo ?? [])].sort((a, b) => b.width - a.width)[0];
        let media: string | null = null;
        if (photo) {
          const f = await tg<{ file_path: string }>(token, 'getFile', { file_id: photo.file_id });
          const res = await fetch(`https://api.telegram.org/file/bot${token}/${f.file_path}`);
          media = await uploadImage(k, Buffer.from(await res.arrayBuffer()));
        }
        await tweet(k, xText(q.message.caption ?? '', link?.url ?? SITE), media);
        report.push(media ? 'X ✅' : 'X ✅ (link only, picture refused)');
      } catch (e) {
        report.push('X ❌');
        console.log(`x: ${(e as Error).message}`);
      }
    }
    await tg(token, 'editMessageReplyMarkup', { chat_id: chat, message_id: q.message.message_id, reply_markup: { inline_keyboard: [...linkRow, [{ text: `Posted: ${report.join(' · ')}`, callback_data: 'noop' }]] } }).catch(() => null);
    console.log(`published: ${report.join(', ')}`);
  }
}

export async function socialTick(): Promise<void> {
  const token = (process.env['TELEGRAM_BOT_TOKEN'] ?? '').trim();
  const channel = (process.env['TELEGRAM_CHANNEL'] ?? '').trim();
  if (!token || !channel) throw new Error('TELEGRAM_BOT_TOKEN and TELEGRAM_CHANNEL must be set in Actions secrets');
  const chat = await owner(token);
  const ch = /^-?\d+$/.test(channel) ? channel : channel.startsWith('@') ? channel : `@${channel}`;

  await publishTaps(token, chat, ch);

  const todo = await due();
  if (!todo.length) { console.log('nothing to draft'); return; }
  let browser: { close(): Promise<void> } & Record<string, unknown>;
  try {
    const { chromium } = await import('playwright');
    browser = await chromium.launch({ executablePath: process.env['CHROMIUM_PATH'] || undefined }) as never;
  } catch {
    console.log(`drafts due (${todo.map((t) => t.kind).join(', ')}), but no browser here to draw them`);
    if (process.env['GITHUB_OUTPUT']) appendFileSync(process.env['GITHUB_OUTPUT'], 'draw=1\n');
    return;
  }
  try {
    for (const t of todo) {
      const post = t.kind === 'morning' ? await freeCallPost(browser as never) : await resultsPost(browser as never, t.day);
      if (!post?.photo) { console.log(`${t.kind}: nothing to post`); await kvSet(t.key, 'none', 3 * DAY); continue; }
      await sendDraft(token, chat, post, `${t.kind}:${t.day ?? ukDay(Date.now() / 1000)}`);
      await kvSet(t.key, '1', 3 * DAY);
      console.log(`${t.kind}: draft sent to the owner`);
    }
  } finally {
    await browser.close();
  }
}

