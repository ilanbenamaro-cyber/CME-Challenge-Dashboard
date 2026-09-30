// WP-UI io layer: Google Sheet (Apps Script web app) reader. Simple GET, no custom headers (no CORS preflight).
/** @typedef {import('../core/types.mjs').SheetData} SheetData */
/** @typedef {import('../core/types.mjs').Trade} Trade */
/** @typedef {import('../core/types.mjs').DailyRow} DailyRow */
/** @typedef {import('../core/types.mjs').MarginRow} MarginRow */

/**
 * @typedef {object} SheetResult
 * @property {SheetData|null} data
 * @property {string[]} rowErrors   one entry per rejected row; Trades rows start with TRADES_ROW_PREFIX
 * @property {string|null} error
 * @property {number|null} fetchedAtMs  time of the last successful fetch
 */

/** Prefix of every Trades row error (the view model uses it to invalidate today's P&L). */
export const TRADES_ROW_PREFIX = 'Trades row ';

const URL_RE = /^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec$/;
const FETCH_TIMEOUT_MS = 20000;

/**
 * True for an Apps Script web-app URL of the form https://script.google.com/macros/s/<id>/exec.
 * @param {string} url
 * @returns {boolean}
 */
export function isValidSheetUrl(url) {
  return URL_RE.test(url.trim());
}

/**
 * Fetch and normalise the Sheet. Never throws.
 * @param {string} url
 * @param {string} key
 * @returns {Promise<SheetResult>}
 */
export async function loadSheet(url, key) {
  const u = url.trim();
  if (!isValidSheetUrl(u)) {
    return { data: null, rowErrors: [], error: 'Sheet URL must look like https://script.google.com/macros/s/…/exec', fetchedAtMs: null };
  }
  if (key.trim() === '') return { data: null, rowErrors: [], error: 'Sheet key is empty (Settings)', fetchedAtMs: null };
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), FETCH_TIMEOUT_MS);
  try {
    const q = `${u}?key=${encodeURIComponent(key.trim())}&t=${Date.now()}`;
    const res = await fetch(q, { method: 'GET', redirect: 'follow', credentials: 'omit', signal: ctl.signal });
    if (!res.ok) return { data: null, rowErrors: [], error: `HTTP ${res.status}`, fetchedAtMs: null };
    const text = await res.text();
    /** @type {unknown} */
    let raw;
    try {
      raw = JSON.parse(text);
    } catch {
      return { data: null, rowErrors: [], error: 'response is not JSON (check the web app is deployed for "Anyone")', fetchedAtMs: null };
    }
    const n = normalizeSheet(raw);
    return { ...n, fetchedAtMs: n.error === null ? Date.now() : null };
  } catch (e) {
    const msg = e instanceof Error ? (e.name === 'AbortError' ? 'timed out' : e.message) : String(e);
    return { data: null, rowErrors: [], error: `network: ${msg}`, fetchedAtMs: null };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * @param {unknown} v
 * @returns {v is Record<string, unknown>}
 */
function isObj(v) {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

const NUM_RE = /^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i;

/**
 * Cell → number. `''`/null/undefined → null (blank). Numeric strings (optional `$` and thousands commas)
 * are coerced. Anything else → NaN, which callers treat as a row error. Never returns 0 for junk.
 * @param {unknown} v
 * @returns {number|null}
 */
export function coerceNumber(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : NaN;
  if (typeof v !== 'string') return NaN;
  const s = v.trim();
  if (s === '') return null;
  const neg = s.startsWith('-');
  const body = s.replace(/^[-+]/, '').replace(/^\$/, '').replace(/,(?=\d{3}(\D|$))/g, '');
  if (!NUM_RE.test(body)) return NaN;
  const n = Number(body);
  if (!Number.isFinite(n)) return NaN;
  return neg ? -n : n;
}

/**
 * Cell → trimmed string; `''`/null/undefined → null.
 * @param {unknown} v
 * @returns {string|null}
 */
function cellText(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  if (typeof v !== 'string') return null;
  const s = v.trim();
  return s === '' ? null : s;
}

/**
 * @param {Record<string, unknown>} row
 * @returns {boolean}
 */
function isBlankRow(row) {
  return Object.values(row).every((v) => v === '' || v === null || v === undefined);
}

/**
 * @param {string|null} t
 * @returns {boolean}
 */
function isIsoTime(t) {
  // Must carry Z or an explicit offset: an offset-less time is ambiguous (core rejects it too).
  return t !== null
    && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/.test(t)
    && !Number.isNaN(Date.parse(t));
}

/**
 * Normalise one Trades row. Returns the Trade or a reason string.
 * @param {Record<string, unknown>} r
 * @returns {Trade|string}
 */
function normTrade(r) {
  const root = cellText(r.root);
  const sideRaw = cellText(r.side);
  const side = sideRaw === null ? null : sideRaw.toLowerCase();
  const qty = coerceNumber(r.qty);
  const entry = coerceNumber(r.entry);
  const exit = coerceNumber(r.exit);
  const fees = coerceNumber(r.fees_usd);
  const entryTime = cellText(r.entry_time);
  const exitTime = cellText(r.exit_time);
  if (root === null || !/^[A-Za-z0-9]{1,4}$/.test(root)) return 'root missing or malformed';
  if (side !== 'long' && side !== 'short') return 'side must be long or short';
  if (qty === null || Number.isNaN(qty) || !Number.isInteger(qty) || qty <= 0) return 'qty must be a positive whole number';
  if (entry === null || Number.isNaN(entry) || entry <= 0) return 'entry is not a price';
  if (Number.isNaN(exit) || (exit !== null && exit <= 0)) return 'exit is not a price';
  if (fees === null) return 'fees_usd is blank (enter 0 if none)';
  if (Number.isNaN(fees) || fees < 0) return 'fees_usd is not a non-negative number';
  if (!isIsoTime(entryTime)) return 'entry_time is not ISO-8601';
  if (exitTime !== null && !isIsoTime(exitTime)) return 'exit_time is not ISO-8601';
  if ((exit === null) !== (exitTime === null)) return 'exit and exit_time must both be blank (open) or both set';
  /** @type {Trade} */
  const t = {
    id: '',
    root: root.toUpperCase(),
    side,
    qty,
    entry,
    exit,
    entry_time: /** @type {string} */ (entryTime),
    exit_time: exitTime,
    fees_usd: fees,
  };
  const notes = cellText(r.notes);
  if (notes !== null) t.notes = notes;
  return t;
}

/**
 * Normalise a raw Apps Script response (pure). Blank cells → null; numeric strings are coerced; a
 * non-coercible value makes that row invalid (listed in `rowErrors` with its id and excluded). It never
 * becomes 0. A `{error}` response → `error`.
 * @param {unknown} raw
 * @returns {{data: SheetData|null, rowErrors: string[], error: string|null}}
 */
export function normalizeSheet(raw) {
  if (!isObj(raw)) return { data: null, rowErrors: [], error: 'unexpected response (not an object)' };
  if (typeof raw.error === 'string') return { data: null, rowErrors: [], error: `Sheet: ${raw.error}` };
  if (raw.schema_version !== 1) return { data: null, rowErrors: [], error: 'unexpected schema_version from Sheet' };
  const tabs = raw.tabs;
  if (!isObj(tabs) || !Array.isArray(tabs.Trades) || !Array.isArray(tabs.Daily)) {
    return { data: null, rowErrors: [], error: 'Sheet response lacks Trades/Daily tabs' };
  }
  /** @type {string[]} */
  const rowErrors = [];

  /** @type {Trade[]} */
  const trades = [];
  const seen = new Set();
  tabs.Trades.forEach((row, i) => {
    const label = `#${i + 2}`; // spreadsheet row number (row 1 = header)
    if (!isObj(row)) {
      rowErrors.push(`${TRADES_ROW_PREFIX}${label}: not an object`);
      return;
    }
    if (isBlankRow(row)) return;
    const id = cellText(row.id);
    const name = id === null ? label : `${id}`;
    if (id === null) {
      rowErrors.push(`${TRADES_ROW_PREFIX}${label}: id is blank`);
      return;
    }
    if (seen.has(id)) {
      rowErrors.push(`${TRADES_ROW_PREFIX}${name}: duplicate id`);
      return;
    }
    seen.add(id);
    const t = normTrade(row);
    if (typeof t === 'string') {
      rowErrors.push(`${TRADES_ROW_PREFIX}${name}: ${t}`);
      return;
    }
    t.id = id;
    trades.push(t);
  });

  /** @type {DailyRow[]} */
  const daily = [];
  tabs.Daily.forEach((row, i) => {
    const label = `#${i + 2}`;
    if (!isObj(row) || isBlankRow(row)) {
      if (!isObj(row)) rowErrors.push(`Daily row ${label}: not an object`);
      return;
    }
    const date = cellText(row.date);
    const pnl = coerceNumber(row.reported_pnl_usd);
    const bal = coerceNumber(row.reported_balance_usd);
    if (date === null || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      rowErrors.push(`Daily row ${label}: date must be YYYY-MM-DD`);
    } else if (Number.isNaN(pnl) || Number.isNaN(bal)) {
      rowErrors.push(`Daily row ${date}: reported value is not a number`);
    } else {
      daily.push({ date, reported_pnl_usd: pnl, reported_balance_usd: bal });
    }
  });

  /** @type {MarginRow[]} */
  const margins = [];
  if (Array.isArray(tabs.Margins)) {
    tabs.Margins.forEach((row, i) => {
      const label = `#${i + 2}`;
      if (!isObj(row) || isBlankRow(row)) {
        if (!isObj(row)) rowErrors.push(`Margins row ${label}: not an object`);
        return;
      }
      const root = cellText(row.root);
      const ini = coerceNumber(row.initial_usd);
      const mnt = coerceNumber(row.maintenance_usd);
      if (root === null || !/^[A-Za-z0-9]{1,4}$/.test(root)) {
        rowErrors.push(`Margins row ${label}: root missing or malformed`);
      } else if (Number.isNaN(ini) || Number.isNaN(mnt) || (ini !== null && ini <= 0) || (mnt !== null && mnt <= 0)) {
        rowErrors.push(`Margins row ${root}: margin is not a positive number`);
      } else {
        margins.push({ root: root.toUpperCase(), initial_usd: ini, maintenance_usd: mnt, as_of: cellText(row.as_of) });
      }
    });
  }

  return { data: { trades, daily, margins }, rowErrors, error: null };
}
