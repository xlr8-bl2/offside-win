/**
 * Serve public/ locally and proxy /api/* to the live Worker.
 *
 * The browser cannot reach the Worker directly from a sandbox: the egress
 * proxy re-terminates TLS and Chromium's own root store does not carry its CA.
 * Node does trust it, so Node fetches and hands the bytes over. Never disable
 * certificate verification to get around this.
 *
 *   node serve.mjs                 # serve the real API
 *   FREE=1 node serve.mjs          # pass every response through the paywall
 *                                  # redaction, so you see what a signed-out
 *                                  # reader sees before the slate has run
 */
import { Buffer } from 'node:buffer';
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';

const ROOT = process.env.ROOT ?? '/home/user/offside-win/public';
const UP = process.env.UPSTREAM ?? 'https://offside-win.ashleymbaht.workers.dev';
/*
 * The provider's image host, proxied for the same reason the API is.
 *
 * Leaving it unproxied was not a neutral omission. Every crest, every league
 * badge and every stadium photograph failed TLS in the browser, so the checker
 * and every screenshot showed a site with no photography and coloured initials
 * where the club badges go -- and a whole redesign got judged against that.
 * The images were fine the entire time; Chromium just could not fetch them.
 */
const IMG = process.env.IMG_UPSTREAM ?? 'https://sports.bzzoiro.com';

/*
 * Google Fonts, proxied for the same reason as everything else.
 *
 * Chromium cannot complete TLS to fonts.googleapis.com from this sandbox, so
 * every screenshot this project has ever taken rendered in a system fallback.
 * Three typefaces were chosen and shipped without anyone seeing one of them
 * render -- picked from a name and a description. Node can reach Google, so it
 * fetches the stylesheet, rewrites the font file URLs to point back here, and
 * serves the woff2 itself.
 *
 * The browser user-agent matters: without it Google serves ttf instead of
 * woff2, which works but is four times the bytes.
 */
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36';
const PORT = Number(process.env.PORT ?? 8788);
const TYPES = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json',
};

let redact = null;
if (process.env.FREE) {
  redact = await import('/home/user/offside-win/engine/src/membership/redact.ts');
}

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');

  // Same-origin web fonts, so the type can actually be looked at.
  if (url.pathname === '/gfonts/css') {
    try {
      const r = await fetch('https://fonts.googleapis.com/css2?' + url.searchParams.toString(), {
        headers: { 'user-agent': UA },
      });
      const css = (await r.text()).replaceAll('https://fonts.gstatic.com/', '/gfonts/file/');
      res.writeHead(r.status, { 'content-type': 'text/css' });
      res.end(css);
    } catch (e) { res.writeHead(502); res.end(String(e)); }
    return;
  }
  if (url.pathname.startsWith('/gfonts/file/')) {
    try {
      const r = await fetch('https://fonts.gstatic.com/' + url.pathname.slice('/gfonts/file/'.length));
      res.writeHead(r.status, {
        'content-type': r.headers.get('content-type') ?? 'font/woff2',
        'cache-control': 'public, max-age=86400',
      });
      res.end(Buffer.from(await r.arrayBuffer()));
    } catch (e) { res.writeHead(502); res.end(String(e)); }
    return;
  }

  // Same-origin images, so the browser can actually load them here.
  if (url.pathname.startsWith('/img/')) {
    try {
      const r = await fetch(IMG + url.pathname + url.search, { redirect: 'follow' });
      const buf = Buffer.from(await r.arrayBuffer());
      res.writeHead(r.status, {
        'content-type': r.headers.get('content-type') ?? 'application/octet-stream',
        'cache-control': 'public, max-age=3600',
      });
      res.end(buf);
    } catch (e) {
      res.writeHead(502);
      res.end(String(e));
    }
    return;
  }

  if (url.pathname.startsWith('/api/')) {
    try {
      const r = await fetch(UP + url.pathname + url.search);
      let body = await r.text();
      if (redact) {
        try {
          const d = JSON.parse(body);
          if (url.pathname === '/api/board') {
            d.fixtures = d.fixtures.map(redact.freeBoard);
            body = JSON.stringify(d);
          } else if (url.pathname.startsWith('/api/fixture/')) {
            body = JSON.stringify(redact.freeBundle(d));
          }
        } catch { /* not json, leave it */ }
      }
      res.writeHead(r.status, { 'content-type': 'application/json' });
      res.end(body);
    } catch (e) {
      res.writeHead(502);
      res.end(JSON.stringify({ error: String(e) }));
    }
    return;
  }

  const rel = url.pathname === '/' ? '/index.html' : url.pathname;
  const path = join(ROOT, normalize(rel).replace(/^(\.\.[/\\])+/, ''));
  try {
    let buf = await readFile(path);
    // Point the app at this server's own image proxy rather than the host it
    // cannot reach. One substitution, and only in what is served locally.
    if (extname(path) === '.js') buf = Buffer.from(String(buf).replaceAll(IMG + '/img', '/img'));
    if (extname(path) === '.html') {
      buf = Buffer.from(String(buf).replaceAll('https://fonts.googleapis.com/css2?', '/gfonts/css?'));
    }
    res.writeHead(200, { 'content-type': TYPES[extname(path)] ?? 'application/octet-stream' });
    res.end(buf);
  } catch {
    res.writeHead(404);
    res.end('not found');
  }
}).listen(PORT, '127.0.0.1', () => console.log(`serving ${ROOT} on ${PORT}${redact ? ' (free view)' : ''}`));
