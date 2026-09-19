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
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';

const ROOT = process.env.ROOT ?? '/home/user/offside-win/public';
const UP = process.env.UPSTREAM ?? 'https://offside-win.ashleymbaht.workers.dev';
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
    const buf = await readFile(path);
    res.writeHead(200, { 'content-type': TYPES[extname(path)] ?? 'application/octet-stream' });
    res.end(buf);
  } catch {
    res.writeHead(404);
    res.end('not found');
  }
}).listen(PORT, '127.0.0.1', () => console.log(`serving ${ROOT} on ${PORT}${redact ? ' (free view)' : ''}`));
