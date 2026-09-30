// Planner-owned boundary tests (A11, A14). Never weaken these to get green.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const ROOT = new URL('../../', import.meta.url).pathname;

/** @param {string} dir @param {(p: string) => boolean} keep @returns {string[]} */
function walk(dir, keep) {
  const out = [];
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === '.git') continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p, keep));
    else if (keep(p)) out.push(p);
  }
  return out;
}
const rel = (/** @type {string} */ p) => relative(ROOT, p).split(sep).join('/');

const NETWORK = /\bfetch\s*\(|XMLHttpRequest|new\s+WebSocket|EventSource|sendBeacon|importScripts|serviceWorker|\bimport\s*\(\s*['"`]https?:/;

test('only docs/js/io may touch the network (D8)', () => {
  const files = walk(join(ROOT, 'docs'), (p) => /\.(mjs|js|html)$/.test(p));
  assert.ok(files.length > 0, 'expected site sources under docs/');
  const offenders = files
    .filter((p) => !rel(p).startsWith('docs/js/io/'))
    .filter((p) => NETWORK.test(readFileSync(p, 'utf8')))
    .map(rel);
  assert.deepEqual(offenders, [], 'network primitive outside docs/js/io');
});

test('no external scripts or styles are loaded by the site', () => {
  for (const p of walk(join(ROOT, 'docs'), (f) => f.endsWith('.html'))) {
    const html = readFileSync(p, 'utf8');
    assert.doesNotMatch(html, /<script[^>]+src=["']https?:/i, `${rel(p)} loads a remote script`);
    assert.doesNotMatch(html, /<link[^>]+href=["']https?:/i, `${rel(p)} loads a remote stylesheet`);
  }
});

const ORDER_WORDS = /\bcqg\b|place_?order|submit_?order|cancel_?order|modify_?order|new_?order_?single|order_?entry|\/orders?\b/i;

test('no order placement or CQG code anywhere in product sources (boundary)', () => {
  const dirs = ['docs', 'jobs', 'apps_script'].map((d) => join(ROOT, d));
  const files = dirs.flatMap((d) => walk(d, (p) => /\.(mjs|js|html|py|gs|json)$/.test(p)));
  const offenders = files.filter((p) => ORDER_WORDS.test(readFileSync(p, 'utf8'))).map(rel);
  assert.deepEqual(offenders, []);
});

test('CSP restricts connect-src to self and Apps Script hosts; no eval (A11)', () => {
  const p = join(ROOT, 'docs', 'index.html');
  assert.ok(existsSync(p), 'docs/index.html missing');
  const html = readFileSync(p, 'utf8');
  const m = html.match(/<meta\s+http-equiv=["']Content-Security-Policy["']\s+content=(?:"([^"]+)"|'([^']+)')/i);
  assert.ok(m, 'CSP meta tag missing');
  const policy = m[1] ?? m[2];
  const csp = Object.fromEntries(
    policy.split(';').map((s) => s.trim()).filter(Boolean).map((d) => {
      const [k, ...v] = d.split(/\s+/);
      return [k, v];
    }),
  );
  assert.deepEqual(
    [...(csp['connect-src'] ?? [])].sort(),
    ["'self'", 'https://script.google.com', 'https://script.googleusercontent.com'].sort(),
  );
  assert.deepEqual(csp['script-src'], ["'self'"]);
  assert.deepEqual(csp['default-src'], ["'self'"]);
  assert.ok(!policy.includes('unsafe-eval'), 'unsafe-eval present');
  assert.ok(!(csp['script-src'] ?? []).includes("'unsafe-inline'"), 'inline scripts allowed');
});

test('no committed secrets (A14)', () => {
  const files = walk(ROOT, (p) => !/\.(png|jpg|ico|lock)$/.test(p) && !p.includes(`${sep}tests${sep}boundary${sep}`));
  const SECRET = /\bdb-[A-Za-z0-9]{24,}\b|AKfycb[A-Za-z0-9_-]{30,}|"?sheet_key"?\s*[:=]\s*"[^"$]{8,}"/;
  const offenders = files.filter((p) => SECRET.test(readFileSync(p, 'utf8'))).map(rel);
  assert.deepEqual(offenders, []);
});

test('workflow permissions are minimal (A14)', () => {
  const ci = readFileSync(join(ROOT, '.github/workflows/ci.yml'), 'utf8');
  assert.match(ci, /^permissions:\s*\n\s+contents:\s*read\s*$/m, 'ci.yml must be contents: read');
  assert.doesNotMatch(ci, /secrets\./, 'ci.yml must not use secrets');
  const refreshPath = join(ROOT, '.github/workflows/refresh.yml');
  assert.ok(existsSync(refreshPath), 'refresh.yml missing');
  const refresh = readFileSync(refreshPath, 'utf8');
  assert.match(refresh, /^permissions:\s*\n\s+contents:\s*write\s*$/m, 'refresh.yml must be exactly contents: write');
  const used = [...refresh.matchAll(/secrets\.([A-Z_]+)/g)].map((x) => x[1]);
  assert.deepEqual([...new Set(used)].filter((s) => s !== 'GITHUB_TOKEN'), ['DATABENTO_API_KEY']);
  assert.doesNotMatch(refresh, /echo[^\n]*secrets\./, 'never echo secrets');
  assert.doesNotMatch(refresh, /pull_request_target/);
});
