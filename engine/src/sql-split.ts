/**
 * Split a schema file into executable statements.
 *
 * Neither backend can send a whole file in one call, so migrate() feeds them
 * one statement at a time. The naive version of this — split on ';' — was wrong
 * twice over, and both failures were silent rather than loud:
 *
 *   - A comment containing a semicolon was torn in half and its tail executed
 *     as SQL ("a table left out of this list is writable" became a statement).
 *     Stripping comments first fixed that, but only for comments.
 *   - A dollar-quoted function body contains semicolons by definition, so a
 *     file with one could not be split at all. The Postgres schema worked
 *     around it by writing every grant and policy out longhand, which is fine
 *     for DDL and impossible for the serving functions the Worker reads through.
 *
 * So this is a real scanner instead: it walks the file once, tracking whether
 * it is inside a line comment, a block comment, a quoted literal, a quoted
 * identifier or a dollar-quoted body, and only treats a ';' as a terminator
 * when it is in none of them. Comments are dropped as they are consumed, so a
 * semicolon inside one can never reach the splitter in the first place.
 */
export function splitStatements(schemaSql: string): string[] {
  const out: string[] = [];
  const n = schemaSql.length;
  let cur = '';
  let i = 0;

  while (i < n) {
    const c = schemaSql[i]!;
    const next = schemaSql[i + 1];

    // Line comment: consume to the newline, which is left for the next pass so
    // the tokens either side of it do not run together.
    if (c === '-' && next === '-') {
      while (i < n && schemaSql[i] !== '\n') i++;
      continue;
    }

    // Block comment. Postgres nests these; so does this.
    if (c === '/' && next === '*') {
      let depth = 1;
      i += 2;
      while (i < n && depth > 0) {
        if (schemaSql[i] === '/' && schemaSql[i + 1] === '*') {
          depth++;
          i += 2;
        } else if (schemaSql[i] === '*' && schemaSql[i + 1] === '/') {
          depth--;
          i += 2;
        } else i++;
      }
      cur += ' ';
      continue;
    }

    // Quoted literal or quoted identifier. A doubled quote inside is an escape,
    // not a close.
    if (c === "'" || c === '"') {
      cur += c;
      i++;
      while (i < n) {
        if (schemaSql[i] === c && schemaSql[i + 1] === c) {
          cur += c + c;
          i += 2;
          continue;
        }
        if (schemaSql[i] === c) {
          cur += c;
          i++;
          break;
        }
        cur += schemaSql[i];
        i++;
      }
      continue;
    }

    // Dollar-quoted body: $$ ... $$ or $tag$ ... $tag$. Everything up to the
    // matching close tag is opaque, semicolons included.
    if (c === '$') {
      const tag = /^\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/.exec(schemaSql.slice(i))?.[0];
      if (tag) {
        const close = schemaSql.indexOf(tag, i + tag.length);
        const stop = close === -1 ? n : close + tag.length;
        cur += schemaSql.slice(i, stop);
        i = stop;
        continue;
      }
    }

    if (c === ';') {
      const s = cur.trim();
      if (s) out.push(s);
      cur = '';
      i++;
      continue;
    }

    cur += c;
    i++;
  }

  const last = cur.trim();
  if (last) out.push(last);
  return out;
}
