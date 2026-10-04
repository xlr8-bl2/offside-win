/**
 * The copy of public/ that is deployed: the same files, minified and
 * versioned. Run by deploy.yml before `wrangler deploy`; public/ itself is
 * never touched, so working on the site is still edit and reload.
 *
 *   node scripts/build-public.mjs            # public/ -> dist/
 *
 * Why, measured on the live site (September 2026):
 *
 *  - Every script and stylesheet was served `max-age=0, must-revalidate`, so
 *    every visit asked again for each one before the page could run. A long
 *    cache is only safe when a changed file gets a new address, so every
 *    reference to a script or stylesheet carries `?v=<hash of its contents>`:
 *    the HTML's links, every relative import between the modules, and the two
 *    stylesheets the scripts load themselves. dist/_headers then lets those
 *    be kept for a year.
 *  - app.js was 409KB, most of it comments, parsed on every phone before the
 *    page could draw. Each file is minified on its own (no bundling: the
 *    modules stay modules, loaded when they are now).
 *
 * Every module's version is the hash of its own contents, so an unchanged
 * file keeps its address and its cached copy across deploys. A module's
 * address changes when it or anything it imports changes, because its
 * imports are rewritten with their versions before it is hashed.
 */
import { createHash } from 'node:crypto';
import { cpSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { transform } from 'esbuild';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'public');
const OUT = resolve(process.argv[2] ?? join(ROOT, 'dist'));

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
cpSync(SRC, OUT, { recursive: true });

const walk = (dir) => readdirSync(dir).flatMap((n) => {
  const p = join(dir, n);
  return statSync(p).isDirectory() ? walk(p) : [p];
});
const files = walk(OUT);
const rel = (p) => `/${relative(OUT, p).split('\\').join('/')}`;
const hash = (text) => createHash('sha256').update(text).digest('hex').slice(0, 10);

// --- stylesheets: minified, then versioned by their own contents.
const version = new Map(); // "/components.css" -> "abc123"
for (const f of files.filter((p) => p.endsWith('.css'))) {
  const { code } = await transform(readFileSync(f, 'utf8'), { loader: 'css', minify: true, legalComments: 'none' });
  writeFileSync(f, code);
  version.set(rel(f), hash(code));
}

// --- modules: an import graph, versioned leaves first.
const IMPORT = /(\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)(['"])(\.{1,2}\/[^'"]+?\.js)\2/g;
const CSS_REF = /(['"])(\/[\w./-]+?\.css)\1/g;
const js = files.filter((p) => p.endsWith('.js') && !rel(p).startsWith('/brand/'));
const deps = new Map(js.map((f) => [f, [...readFileSync(f, 'utf8').matchAll(IMPORT)].map((m) => resolve(dirname(f), m[3]))]));
const done = new Set();
const visiting = new Set();
async function build(f) {
  if (done.has(f)) return;
  if (visiting.has(f)) throw new Error(`import cycle through ${rel(f)}: a cycle cannot be versioned by content`);
  visiting.add(f);
  for (const d of deps.get(f) ?? []) {
    if (!deps.has(d)) throw new Error(`${rel(f)} imports ${rel(d)}, which is not in public/`);
    await build(d);
  }
  let src = readFileSync(f, 'utf8')
    .replace(IMPORT, (all, lead, q, spec) => `${lead}${q}${spec}?v=${version.get(rel(resolve(dirname(f), spec)))}${q}`)
    .replace(CSS_REF, (all, q, path) => (version.has(path) ? `${q}${path}?v=${version.get(path)}${q}` : all));
  const { code } = await transform(src, { loader: 'js', format: 'esm', minify: true, target: 'es2022', legalComments: 'none' });
  writeFileSync(f, code);
  version.set(rel(f), hash(code));
  visiting.delete(f);
  done.add(f);
}
for (const f of js) await build(f);

// --- pages: every link to a script or stylesheet carries its version.
for (const f of files.filter((p) => p.endsWith('.html'))) {
  const html = readFileSync(f, 'utf8').replace(/((?:src|href)=")(\/[\w./-]+?\.(?:js|css))(")/g,
    (all, a, path, b) => (version.has(path) ? `${a}${path}?v=${version.get(path)}${b}` : all));
  writeFileSync(f, html);
}

// --- caching: versioned files for a year; the faces for a month (their names
// do not change with their contents, but they almost never change).
const year = 'public, max-age=31536000, immutable';
const rules = [
  ...[...version.keys()].filter((p) => !p.startsWith('/js/')).map((p) => [p, year]),
  ['/js/*', year],
  ['/fonts/*', 'public, max-age=2592000'],
  ['/brand/*', 'public, max-age=86400'],
  // Named one by one: a rule's splat stands for the rest of a path, not a suffix.
  ...files.map(rel).filter((p) => /^\/[^/]+\.(png|svg|webmanifest)$/.test(p)).map((p) => [p, 'public, max-age=86400']),
];
// The browser's protections on every file, as the Worker sets them on what it
// answers (SECURITY_HEADERS in worker/src/index.ts): above all, no framing.
const secure = [
  'Strict-Transport-Security: max-age=31536000; includeSubDomains',
  'X-Content-Type-Options: nosniff',
  'X-Frame-Options: DENY',
  'Referrer-Policy: strict-origin-when-cross-origin',
  'Permissions-Policy: camera=(), microphone=(), geolocation=()',
  "Content-Security-Policy: frame-ancestors 'none'; base-uri 'self'; object-src 'none'",
];
writeFileSync(join(OUT, '_headers'), `/*\n${secure.map((h) => `  ${h}`).join('\n')}\n${rules.map(([p, v]) => `${p}\n  Cache-Control: ${v}`).join('\n')}\n`);

const before = files.filter((p) => /\.(js|css)$/.test(p)).reduce((n, p) => n + statSync(join(SRC, relative(OUT, p))).size, 0);
const after = files.filter((p) => /\.(js|css)$/.test(p)).reduce((n, p) => n + statSync(p).size, 0);
console.log(`dist: ${version.size} scripts and stylesheets versioned, ${Math.round(before / 1024)}KB -> ${Math.round(after / 1024)}KB before compression`);
