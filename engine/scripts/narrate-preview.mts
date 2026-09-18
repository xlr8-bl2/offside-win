/**
 * Read what the writer actually writes, before any of it is published.
 *
 * Writes nothing. It reads fixtures that are already on the board, rebuilds the
 * facts the slate would hand the model, generates a narrative for each and
 * prints it alongside both gates' verdicts.
 *
 * Two reasons this exists as its own command rather than as a flag on the
 * slate.
 *
 * Running the slate is how the paywall switches on -- the free copies it writes
 * are what `get_board` starts serving to anyone without a membership -- so
 * "just run it and see" is not available while the merchant account is still
 * being set up.
 *
 * And tone is the deliverable. A regex can prove the jargon is gone; it cannot
 * tell whether the writing has a pulse, whether it has a take, or whether a
 * supporter would say every number in it out loud. That needs reading, and
 * reading needs the text in front of you.
 */

import { config } from '../src/config.ts';
import { pubFacts } from '../src/narrate/facts.ts';
import { geminiWriter } from '../src/narrate/gemini.ts';
import { write } from '../src/narrate/write.ts';
import { freeProse } from '../src/membership/redact.ts';
import { closeDb, select } from '../src/store.ts';

const COUNT = Number(process.env['PREVIEW_COUNT'] ?? 12);

interface Row { id: number; home_team: string; away_team: string; bundle_json: string }

async function main(): Promise<void> {
  const apiKey = process.env['GEMINI_API_KEY'];
  if (!apiKey) throw new Error('GEMINI_API_KEY is required to preview the writer.');

  const rows = await select<Row>(
    `SELECT id, home_team, away_team, bundle_json
     FROM fixture
     WHERE kickoff > ? ORDER BY rank ASC, kickoff ASC LIMIT ?`,
    [Math.floor(Date.now() / 1000), COUNT * 3],
  );

  const writer = geminiWriter({ apiKey, model: process.env['GEMINI_MODEL'] ?? 'gemini-2.5-flash' });
  let written = 0;
  let free = 0;
  let seen = 0;
  const rejections: Record<string, number> = {};

  for (const row of rows) {
    if (seen >= COUNT) break;

    const bundle = JSON.parse(row.bundle_json) as Record<string, any>;
    const verdict = bundle['verdicts']?.[0];
    if (!verdict?.candidate) continue;
    seen++;

    const facts = pubFacts({
      home: row.home_team,
      away: row.away_team,
      ledger: bundle['ledger'] ?? [],
      form: bundle['form'] ?? null,
      h2h: bundle['h2h'] ?? null,
      lineups: bundle['lineups'] ?? null,
    });

    const result = await write({
      home: row.home_team,
      away: row.away_team,
      competition: bundle['league'] ?? 'this competition',
      call: `${row.home_team} v ${row.away_team}`,
      facts,
    }, writer);

    console.log(`\n${'='.repeat(78)}`);
    console.log(`${row.home_team} v ${row.away_team}   (${bundle['league'] ?? '?'})`);
    console.log(`facts in: ${facts.length}`);
    console.log('-'.repeat(78));

    if (result.text) {
      written++;
      const travels = freeProse(result.text) !== null;
      if (travels) free++;
      console.log(result.text);
      console.log('-'.repeat(78));
      console.log(`words ${result.text.split(/\s+/).length}   free readers: ${travels ? 'YES' : 'NO — withheld'}`);
    } else {
      for (const r of result.rejections) rejections[r] = (rejections[r] ?? 0) + 1;
      console.log(`(no draft accepted: ${result.rejections.join(', ')})`);
      console.log('the template grammar would be used instead:');
      console.log(verdict.narrative);
    }
  }

  console.log(`\n${'='.repeat(78)}`);
  console.log(`${written}/${seen} written by the model, ${free} of those readable without paying.`);
  if (Object.keys(rejections).length) {
    console.log(`rejections: ${Object.entries(rejections).map(([k, v]) => `${k} ${v}`).join(', ')}`);
  }
  // The number that decides whether the free tier has anything on it. Anything
  // below about eight in ten means the brief needs work, not the plumbing.
  if (seen > 0 && free / seen < 0.8) {
    console.log('\nWARNING: most of these would be withheld from free readers.');
  }
}

main()
  .catch((err) => { console.error(err instanceof Error ? err.message : err); process.exitCode = 1; })
  .finally(() => closeDb().catch(() => {}));

void config;
