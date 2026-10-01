// WP-UI e2e smoke test: static server over docs/ on an OS-assigned port, headless Chromium at iPhone size.
// Playwright is not a project dependency: it is resolved from the global npm install. If it is missing,
// print SKIP and exit 0. Screenshots go to tests/e2e/out/ (gitignored). Exits non-zero on any failure.
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const DOCS = join(ROOT, 'docs');
const OUT = join(ROOT, 'tests', 'e2e', 'out');
const NOW_ISO = '2026-09-30T19:45:00Z'; // Wed 14:45 CDT, 25 min before the fixture flatten time 15:10 CT
const NOW = Date.parse(NOW_ISO);
const MIN = 60000;
const SHEET_URL = 'https://script.google.com/macros/s/E2E_FIXTURE_ID/exec';

// ---------- Playwright (global install) ----------
/** @type {any} */
let chromium;
try {
  const req = createRequire(join(execSync('npm root -g').toString().trim(), '/'));
  ({ chromium } = req('playwright'));
} catch (e) {
  console.log(`SKIP: playwright not available (${e instanceof Error ? e.message.split('\n')[0] : e})`);
  process.exit(0);
}

/** @returns {string|undefined} */
function chromiumPath() {
  try {
    const p = chromium.executablePath();
    if (p && existsSync(p)) return p;
  } catch { /* fall through */ }
  const base = process.env.PLAYWRIGHT_BROWSERS_PATH;
  if (!base || !existsSync(base)) return undefined;
  for (const d of readdirSync(base).filter((n) => /^chromium-\d+$/.test(n)).sort().reverse()) {
    for (const rel of ['chrome-linux/chrome', 'chrome-linux64/chrome']) {
      const p = join(base, d, rel);
      if (existsSync(p)) return p;
    }
  }
  return undefined;
}

// ---------- static server ----------
/** @type {Record<string, string>} */
const MIME = {
  '.html': 'text/html; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png',
};
/** @type {Set<string>} */
const served = new Set();
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? '/', 'http://x');
    let p = decodeURIComponent(url.pathname);
    if (p.endsWith('/')) p += 'index.html';
    const file = normalize(join(DOCS, p));
    if (!file.startsWith(DOCS + sep)) throw new Error('outside docs');
    const body = await readFile(file);
    served.add(p);
    res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-store' });
    res.end(body);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('not found');
  }
});
await new Promise((r) => server.listen(0, '127.0.0.1', () => r(null)));
const addr = server.address();
const PORT = typeof addr === 'object' && addr ? addr.port : 0;
const BASE = `http://127.0.0.1:${PORT}/`;

const BUILD_ID = (readFileSync(join(DOCS, 'js/ui/render.mjs'), 'utf8').match(/export const BUILD_ID = '([^']+)'/) ?? [])[1];

// ---------- fixtures ----------
/** @param {string} dataset @param {unknown} data @param {number} asOf @param {'ok'|'partial'|'error'} [status] */
function env(dataset, data, asOf, status = 'ok') {
  const iso = new Date(asOf).toISOString();
  return { schema_version: 1, dataset, generated_at: iso, data_as_of: iso, source: `e2e fixture ${dataset}`, status, errors: status === 'ok' ? [] : ['fixture: HTTP 403'], data };
}
/** @param {number} start @param {number} step */
function bars(start, step) {
  const out = [];
  for (let i = 0; i < 24; i++) {
    const c = start + i * step;
    out.push({ t: new Date(NOW - (24 - i) * 60 * MIN).toISOString(), o: c - step, h: c + 1.5, l: c - 2, c, v: 1000 + i });
  }
  return out;
}
const golden = JSON.parse(readFileSync(join(ROOT, 'tests/golden/sizer.json'), 'utf8'));
const utcGolden = JSON.parse(readFileSync(join(ROOT, 'tests/golden/utc2026.json'), 'utf8'));
/** ADR-008: the 2026 UTC rules (golden fixture), served instead of the sizer fixture in the *-utc scenario. */
const UTC_RULES = { schema_version: 1, updated_at: 'e2e', source_doc: 'tests/golden/utc2026.json#rules_fixture (TEST FIXTURE)', rules: utcGolden.rules_fixture };
const FIXTURES = {
  'rules.json': { schema_version: 1, updated_at: 'e2e', source_doc: 'tests/golden/sizer.json#rules_fixture (TEST FIXTURE)', rules: golden.rules_fixture },
  'bars.json': env('bars', { roots: { ES: { symbol: 'ES.c.0', bars: bars(5790.25, 0.5) }, NQ: { symbol: 'NQ.c.0', bars: bars(20100, 2.25) } }, aliases: { MES: 'ES', MNQ: 'NQ' }, cost_usd: 0.004 }, NOW - 35 * MIN),
  'settlements.json': env('settlements', { rows: [
    { root: 'ES', contract_code: 'ESZ26', settle: 5796.5, trade_date: '2026-09-29' },
    { root: 'NQ', contract_code: 'NQZ26', settle: 20122.75, trade_date: '2026-09-29' },
  ] }, NOW - 20 * 60 * MIN),
  'margins.json': env('margins', { rows: [
    { root: 'ES', initial_usd: 16500, maintenance_usd: 15000, as_of: '2026-09-29' },
    { root: 'MES', initial_usd: 1650, maintenance_usd: 1500, as_of: '2026-09-29' },
  ] }, NOW - 50 * 60 * MIN, 'error'),
  'challenge.json': env('challenge', { rows: [{ date: '2026-09-28', account: 'e2e', pnl_usd: 17.5, balance_usd: 50017.5, rank: 41 }] }, NOW - 4 * 24 * 60 * MIN),
};
const XSS = '<script>alert(1)</script><img src=x onerror=alert(2)>';
const SHEET = {
  schema_version: 1,
  generated_at: NOW_ISO,
  tabs: {
    Trades: [
      { id: 'C1', root: 'MES', side: 'short', qty: 1, entry: 5800, exit: 5790, entry_time: '2026-09-30T09:00:00-05:00', exit_time: '2026-09-30T14:00:00-05:00', fees_usd: 0.62, notes: 'fade' },
      { id: 'C0', root: 'ES', side: 'long', qty: 1, entry: 5780, exit: 5781.5, entry_time: '2026-09-29T09:00:00-05:00', exit_time: '2026-09-29T11:00:00-05:00', fees_usd: 4.5, notes: '' },
      { id: 'O1', root: 'MES', side: 'long', qty: '2', entry: '5795.00', exit: '', entry_time: '2026-09-30T13:00:00-05:00', exit_time: '', fees_usd: '1.24', notes: XSS },
    ],
    Daily: [
      { date: '2026-09-29', reported_pnl_usd: 70.5, reported_balance_usd: 50070.5 },
      { date: '2026-09-28', reported_pnl_usd: 17.5, reported_balance_usd: 50017.5 },
    ],
    Margins: [{ root: 'MES', initial_usd: 1320, maintenance_usd: 1200, as_of: '2026-09-28' }],
  },
};

// ---------- checks ----------
/** @type {string[]} */
const failures = [];
/** @param {boolean} cond @param {string} msg */
function check(cond, msg) {
  if (!cond) failures.push(msg);
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${msg}`);
}

/**
 * @param {any} browser
 * @param {{name: string, live: boolean, utc?: boolean, dark?: boolean, width?: number, height?: number, inject?: boolean}} sc
 */
async function scenario(browser, sc) {
  const mobile = (sc.width ?? 390) < 600;
  const context = await browser.newContext({
    viewport: { width: sc.width ?? 390, height: sc.height ?? 844 },
    deviceScaleFactor: mobile ? 3 : 1,
    isMobile: mobile,
    hasTouch: mobile,
    colorScheme: sc.dark ? 'dark' : 'light',
    serviceWorkers: 'block',
  });
  const page = await context.newPage();
  await page.clock.setFixedTime(new Date(NOW_ISO));
  /** @type {string[]} */
  const errors = [];
  let dialogs = 0;
  page.on('pageerror', (/** @type {Error} */ e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (/** @type {any} */ m) => {
    const text = m.text();
    // Expected, not an error: a 404 for a not-yet-produced data file (committed scenario).
    const expected = /Failed to load resource.*404/.test(text);
    if (m.type() === 'error' && !expected) errors.push(`console: ${text}`);
  });
  page.on('dialog', async (/** @type {any} */ d) => { dialogs++; await d.dismiss(); });

  if (sc.live) {
    await context.addInitScript((/** @type {string} */ url) => {
      localStorage.setItem('cme-dash.settings.v1', JSON.stringify({ sheet_url: url, sheet_key: 'k', watched_roots: ['ES', 'MES', 'NQ', 'CL'], expiry_warn_days: 5 }));
    }, SHEET_URL);
    for (const [file, body] of Object.entries({ ...FIXTURES, ...(sc.utc ? { 'rules.json': UTC_RULES } : {}) })) {
      await page.route(`**/data/${file}?*`, (/** @type {any} */ r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) }));
    }
    await page.route('https://script.google.com/**', (/** @type {any} */ r) => r.fulfill({
      status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(SHEET),
    }));
  }
  if (sc.inject) {
    // Force core to throw: the page must show a visible error panel, not a blank page.
    await page.route('**/js/core/time.mjs', async (/** @type {any} */ r) => {
      const src = readFileSync(join(DOCS, 'js/core/time.mjs'), 'utf8')
        .replace('export function ctParts(', 'export function ctParts() { throw new Error("e2e injected core failure"); }\nfunction __origCtParts(');
      await r.fulfill({ status: 200, contentType: 'text/javascript', body: src });
    });
  }

  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForSelector('#app .shell', { timeout: 15000 });
  const tag = `[${sc.name}]`;

  if (sc.inject) {
    const fatal = await page.locator('#app [data-fatal="1"]').count();
    check(fatal === 1, `${tag} injected core failure renders the error panel`);
    check((await page.locator('#app').innerText()).includes('e2e injected core failure'), `${tag} error text is visible`);
    await page.screenshot({ path: join(OUT, `${sc.name}.png`) });
    await context.close();
    return;
  }

  const build = await page.getAttribute('#app .shell', 'data-build');
  check(build === BUILD_ID, `${tag} served build marker ${build} matches docs/js/ui/render.mjs (${BUILD_ID})`);
  check(await page.locator('#app [data-fatal]').count() === 0, `${tag} no fatal error panel`);
  for (const id of ['p-account', 'p-positions', 'p-sizer', 'p-markets', 'p-calendar', 'p-recon', 'p-settings']) {
    check(await page.locator(`#${id}`).count() === 1, `${tag} panel #${id} rendered`);
  }
  check(await page.locator('#app .panel-error').count() === 0, `${tag} no panel failed to build`);
  check(await page.locator('.chips .chip').count() === 6, `${tag} six freshness chips`);

  if (sc.live && sc.utc) {
    // UTC 2026 rules over the same Sheet (Wed 2026-09-30 14:45 CDT, before the challenge window).
    await page.waitForFunction(() => document.querySelector('#p-positions tbody tr') !== null, null, { timeout: 10000 });
    const banners = await page.locator('.banners').innerText();
    check(!/rules UNKNOWN/.test(banners), `${tag} no rules UNKNOWN banner`);
    check(/No flatten required today \(final-day flatten by 15:45 CT on 2026-10-30\)/.test(banners), `${tag} flatten is the calm info line`);
    check(await page.locator('.banners .banner-flatten').count() === 0, `${tag} no flatten banner box on a non-flatten day`);
    const acct = await page.locator('#p-account').innerText();
    // Daily 2026-09-29 balance $50,070.50 x 20% = $10,014.10.
    check(/Daily loss vs 20% lock/.test(acct) && acct.includes('$10,014.10'), `${tag} daily loss vs 20% of the prior close ($10,014.10)`);
    check(acct.includes('No drawdown rule in this challenge'), `${tag} drawdown shown as not a rule`);
    // C1 entry + exit (1 + 1) and O1 entry (2) on 2026-09-30 = 4.
    const ct = await page.locator('[data-meter="min_contracts"]').innerText();
    check(/4 \/ 10/.test(ct) && /6 more needed/.test(ct), `${tag} contracts traded today 4 / 10, 6 more needed`);
    const pos = await page.locator('#p-positions').innerText();
    check(/no contract cap \(margin-limited\)/.test(pos), `${tag} positions: no contract cap`);
    // Sizer with the fee left blank: MES 32 ticks x $1.25 = $40 + $5.00 (2 x $2.50) = $45 -> floor(500 / 45) = 11.
    await page.selectOption('#sizer-form select[name="root"]', 'MES');
    await page.fill('#sizer-form input[name="risk_budget_usd"]', '500');
    await page.fill('#sizer-form input[name="stop_ticks"]', '32');
    await page.check('#sizer-form input[name="hold"][value="intraday"]');
    const n = await page.locator('[data-live="sizer"] .sizer-n').innerText();
    check(n.trim() === '11', `${tag} sizer shows 11 contracts with the defaulted fee (got ${n})`);
    const sizerText = await page.locator('[data-live="sizer"]').innerText();
    check(/n\/a \(margin-limited\)/.test(sizerText), `${tag} sizer max contracts n/a (margin-limited)`);
    check(/fee defaulted from \$2\.50\/side commission/.test(sizerText), `${tag} sizer fee default note`);
  } else if (sc.live) {
    await page.waitForFunction(() => document.querySelector('#p-positions tbody tr') !== null, null, { timeout: 10000 });
    const sheetChip = await page.locator('.chip', { hasText: 'sheet' }).innerText();
    check(/FRESH/.test(sheetChip), `${tag} sheet chip FRESH (${sheetChip.replace(/\s+/g, ' ')})`);
    const marginsChip = await page.locator('.chip', { hasText: 'margins' }).innerText();
    check(/ERROR/.test(marginsChip), `${tag} margins chip ERROR`);
    const firstBanner = await page.locator('.banners .banner').first().innerText();
    check(/Flatten/.test(firstBanner) && /WARN/.test(firstBanner), `${tag} first banner is the amber flatten warning`);
    check(await page.locator('#app script').count() === 0, `${tag} no script element injected from Sheet notes`);
    check((await page.locator('#p-positions').innerText()).includes('<script>alert(1)</script>'), `${tag} Sheet notes shown as literal text`);

    // Sizer: MES, $500 risk, 32 ticks, $0 fee, intraday -> $40/contract -> 12 (risk binds).
    await page.selectOption('#sizer-form select[name="root"]', 'MES');
    await page.fill('#sizer-form input[name="risk_budget_usd"]', '500');
    await page.fill('#sizer-form input[name="stop_ticks"]', '32');
    await page.fill('#sizer-form input[name="fee_per_contract_usd"]', '0');
    await page.check('#sizer-form input[name="hold"][value="intraday"]');
    const n = await page.locator('[data-live="sizer"] .sizer-n').innerText();
    check(n.trim() === '12', `${tag} sizer shows 12 contracts (got ${n})`);
    const sizerText = await page.locator('[data-live="sizer"]').innerText();
    check(/SHEET/.test(sizerText) && /\$1,200\.00/.test(sizerText), `${tag} sizer uses Sheet margin fallback $1,200.00`);
    check(await page.inputValue('#sizer-form input[name="stop_ticks"]') === '32', `${tag} typed sizer input survives re-render`);
    await page.fill('#sizer-form input[name="stop_ticks"]', '');
    const unk = await page.locator('[data-live="sizer"] .sizer-n').innerText();
    check(unk.trim() === 'UNKNOWN', `${tag} blank stop -> UNKNOWN, not a number`);
    await page.fill('#sizer-form input[name="stop_ticks"]', '32');
    const acct = await page.locator('#p-account').innerText();
    check(acct.includes('$49.38'), `${tag} today's realized $49.38 shown`);
    check(dialogs === 0, `${tag} no dialog opened (XSS payload inert)`);
  } else {
    const banners = await page.locator('.banners').innerText();
    // ADR-008: the committed rules.json holds the real 2026 UTC rules, so there is no "rules UNKNOWN" banner.
    check(!/rules UNKNOWN/.test(banners), `${tag} no rules UNKNOWN banner (real rules committed)`);
    check(/No flatten required today/.test(banners), `${tag} flatten is the calm info line`);
    const ct = await page.locator('[data-meter="min_contracts"]').innerText();
    check(/UNKNOWN/.test(ct), `${tag} contracts traded today UNKNOWN without the Sheet`);
    const dl = await page.locator('[data-meter="daily_loss"]').innerText();
    check(/Daily loss vs 20% lock/.test(dl) && /UNKNOWN/.test(dl), `${tag} daily loss vs 20% lock UNKNOWN without the Sheet`);
    check(/Sheet MISSING/i.test(banners), `${tag} Sheet not configured banner shown`);
    const acct = await page.locator('#p-account').innerText();
    check(!acct.includes('$0.00'), `${tag} unknown account values are not rendered as $0.00`);
    check(await page.locator('#p-settings[open]').count() === 1, `${tag} settings open when no Sheet configured`);
  }

  const dims = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));
  check(dims.sw <= dims.iw, `${tag} no horizontal scroll (scrollWidth ${dims.sw} <= innerWidth ${dims.iw})`);
  check(errors.length === 0, `${tag} no page/console errors${errors.length ? `: ${errors.join(' | ')}` : ''}`);

  await page.screenshot({ path: join(OUT, `${sc.name}.png`) });
  await page.screenshot({ path: join(OUT, `${sc.name}-full.png`), fullPage: true });
  await context.close();
}

let exitCode = 0;
let browser;
try {
  await mkdir(OUT, { recursive: true });
  check(typeof BUILD_ID === 'string' && BUILD_ID.length > 0, 'BUILD_ID found in docs/js/ui/render.mjs');
  const executablePath = chromiumPath();
  if (!executablePath) {
    console.log('SKIP: no Chromium found in the Playwright browsers install');
    process.exit(0);
  }
  browser = await chromium.launch({ executablePath, args: ['--no-sandbox'] });
  console.log(`serving ${DOCS} on ${BASE} with ${executablePath}`);
  await scenario(browser, { name: 'iphone-committed', live: false });
  await scenario(browser, { name: 'iphone-live', live: true });
  await scenario(browser, { name: 'iphone-live-dark', live: true, dark: true });
  await scenario(browser, { name: 'iphone-live-utc', live: true, utc: true });
  await scenario(browser, { name: 'desktop-live', live: true, width: 1280, height: 900 });
  await scenario(browser, { name: 'iphone-core-failure', live: false, inject: true });
  check(served.has('/js/main.mjs') && served.has('/js/ui/render.mjs'), 'site modules were served from docs/ by this server');
} catch (e) {
  failures.push(`crashed: ${e instanceof Error ? e.stack : e}`);
  console.error(e);
} finally {
  await browser?.close();
  server.close();
}
if (failures.length > 0) {
  console.log(`\n${failures.length} FAILURE(S):\n- ${failures.join('\n- ')}`);
  exitCode = 1;
} else {
  console.log(`\nALL CHECKS PASSED. Screenshots: ${OUT}`);
}
process.exit(exitCode);
