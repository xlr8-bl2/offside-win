/**
 * Check the Telegram bot the site posts through, before anything is posted.
 * Is the token good, can the bot post in the channel, and has the owner
 * pressed Start in a private chat with it (so posts can go to them first to
 * approve)? Sends one test message to that private chat, never to the channel.
 *
 * Prints yes/no answers and Telegram's error words. Never the token, a chat id
 * or anything the owner wrote: the repository and its logs are public.
 */

const API = 'https://api.telegram.org';

interface Reply<T> { ok: boolean; result?: T; description?: string; error_code?: number }

async function call<T>(token: string, method: string, body: Record<string, unknown> = {}): Promise<Reply<T>> {
  const res = await fetch(`${API}/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return await res.json().catch(() => ({ ok: false, description: `HTTP ${res.status}` })) as Reply<T>;
}

/** "@name", "name", "t.me/name" or "https://t.me/name" → "@name"; a numeric id stays as it is. */
export function channelOf(raw: string): string {
  const s = raw.trim().replace(/^https?:\/\//, '').replace(/^t\.me\//, '').replace(/\/+$/, '');
  if (/^-?\d+$/.test(s)) return s;
  return s.startsWith('@') ? s : `@${s}`;
}

export async function telegramCheck(): Promise<void> {
  const token = (process.env['TELEGRAM_BOT_TOKEN'] ?? '').trim();
  const rawChannel = process.env['TELEGRAM_CHANNEL'] ?? '';
  if (!token) throw new Error('TELEGRAM_BOT_TOKEN is not set in Actions secrets');

  const me = await call<{ id: number; is_bot: boolean }>(token, 'getMe');
  if (!me.ok || !me.result) throw new Error(`the token was refused: ${me.description ?? 'no answer'}`);
  console.log('token: works');

  let problems = 0;
  if (!rawChannel.trim()) {
    console.log('channel: TELEGRAM_CHANNEL is not set in Actions secrets');
    problems++;
  } else {
    const chat = channelOf(rawChannel);
    const info = await call<{ type: string }>(token, 'getChat', { chat_id: chat });
    if (!info.ok || !info.result) {
      console.log(`channel: not found (${info.description ?? 'no answer'})`);
      problems++;
    } else {
      console.log(`channel: found, a ${info.result.type}`);
      const member = await call<{ status: string; can_post_messages?: boolean }>(token, 'getChatMember', { chat_id: chat, user_id: me.result.id });
      const status = member.result?.status ?? `unknown (${member.description ?? 'no answer'})`;
      const canPost = status === 'creator' || (status === 'administrator' && member.result?.can_post_messages !== false);
      console.log(`  the bot is: ${status}; can post: ${canPost ? 'yes' : 'no'}`);
      if (!canPost) problems++;
    }
  }

  // getUpdates only answers while no webhook is set; the site sets none.
  const updates = await call<Array<{ message?: { chat?: { id: number; type: string }; text?: string } }>>(token, 'getUpdates', { allowed_updates: ['message'] });
  const privateChats = [...new Set((updates.result ?? [])
    .map((u) => u.message?.chat)
    .filter((c): c is { id: number; type: string } => c?.type === 'private')
    .map((c) => c.id))];
  if (!updates.ok) {
    console.log(`private chat: could not read the bot's messages (${updates.description ?? 'no answer'})`);
    problems++;
  } else if (!privateChats.length) {
    console.log('private chat: none yet. Open the bot in Telegram and press Start (or send it any message), then run this again.');
    problems++;
  } else {
    console.log(`private chat: ${privateChats.length} found`);
    const sent = await call(token, 'sendMessage', {
      chat_id: privateChats[privateChats.length - 1],
      text: 'offside.win test: the bot works. This is where posts will come for you to approve before they go to the channel. Nothing was posted to the channel.',
    });
    console.log(`  test message: ${sent.ok ? 'sent' : `not sent (${sent.description ?? 'no answer'})`}`);
    if (!sent.ok) problems++;
  }

  if (problems) throw new Error(`${problems} thing(s) to fix, listed above`);
  console.log('all good: the bot can post to the channel and reach you privately');
}
