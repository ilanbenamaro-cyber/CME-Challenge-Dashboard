// WP-UI view model: pure composition of core. No DOM, no fetch, no Date.now() (time comes from inputs.nowMs).
// Every displayable value carries its level/state; unknown values carry UNKNOWN_TEXT, never a number.

import { atr, lastClose } from '../core/atr.mjs';
import { dailyNetByTradeDate, reconcile } from '../core/book.mjs';
import { dailyLossMeter, drawdownMeter, marginMeter, WARN_RATIO } from '../core/compliance.mjs';
import { barsRootFor, resolveSpec, standardEquivalent } from '../core/contracts.mjs';
import { expiryBanner, nextExpiration } from '../core/expiry.mjs';
import { flattenBanner } from '../core/flatten.mjs';
import { fmtPct, fmtPrice, fmtUsd, UNKNOWN_TEXT } from '../core/format.mjs';
import { classifyFreshness, POLICIES } from '../core/freshness.mjs';
import { resolveMargin } from '../core/margin.mjs';
import { tradePnlCents, usdToCents } from '../core/money.mjs';
import { ruleValue } from '../core/rules.mjs';
import { DAILY_ROW_PREFIX, TRADES_ROW_PREFIX } from '../io/sheet.mjs';
import { sizePosition } from '../core/sizer.mjs';
import { ctDate, ctParts, daysBetween, tradeDate, weekdayOf } from '../core/time.mjs';

/** @typedef {import('../core/types.mjs').Level} Level */
/** @typedef {import('../core/types.mjs').FreshState} FreshState */
/** @typedef {import('../core/types.mjs').Freshness} Freshness */
/** @typedef {import('../core/types.mjs').DatasetName} DatasetName */
/** @typedef {import('../core/types.mjs').RulesFile} RulesFile */
/** @typedef {import('../core/types.mjs').RuleSet} RuleSet */
/** @typedef {import('../core/types.mjs').ContractsFile} ContractsFile */
/** @typedef {import('../core/types.mjs').ContractSpec} ContractSpec */
/** @typedef {import('../core/types.mjs').Trade} Trade */
/** @typedef {import('../core/types.mjs').Bar} Bar */
/** @typedef {import('../core/types.mjs').MarginRow} MarginRow */
/** @typedef {import('../core/types.mjs').CalendarEvent} CalendarEvent */
/** @typedef {import('../core/types.mjs').ExpirationEntry} ExpirationEntry */
/** @typedef {import('../core/types.mjs').Meter} Meter */
/** @typedef {import('../core/types.mjs').Hold} Hold */
/** @typedef {import('../core/types.mjs').Envelope<unknown>} AnyEnvelope */
/** @typedef {import('../io/sheet.mjs').SheetResult} SheetResult */
/** @typedef {import('../io/settings.mjs').Settings} Settings */
/** @typedef {import('../io/settings.mjs').SizerForm} SizerForm */

/**
 * @typedef {object} VMInputs
 * @property {number} nowMs
 * @property {RulesFile|null} rules
 * @property {ContractsFile|null} contracts
 * @property {Record<DatasetName, AnyEnvelope|null>} envs
 * @property {SheetResult|null} sheet            null = not loaded (or not configured)
 * @property {Settings} settings
 * @property {SizerForm} sizerForm
 * @property {Partial<Record<string, string>>} [loadErrors]  io error text per dataset / 'rules' / 'contracts'
 * @property {number|null} [loadedAtMs]           when data was last loaded
 */

/**
 * A displayable value.
 * @typedef {object} Cell
 * @property {string} text           formatted value, or UNKNOWN_TEXT
 * @property {boolean} known
 * @property {Level|null} level      null = neutral
 * @property {string|null} badge     e.g. "STALE 3h 5m"; shown next to the value
 * @property {string} note           source / as-of / reason
 * @property {'pos'|'neg'|null} sign P&L direction for colouring
 */

/**
 * @typedef {object} Chip
 * @property {string} name
 * @property {FreshState} state
 * @property {Level} level
 * @property {string} age_text
 * @property {string} reason
 * @property {string} source
 */

/**
 * @typedef {object} BannerVM
 * @property {Level} level
 * @property {'flatten'|'expiry'|'data'|'rules'|'sheet'|'limit'} kind
 * @property {string} title
 * @property {string} message
 * @property {string[]} details
 */

/**
 * @typedef {object} MeterVM
 * @property {string} key
 * @property {string} label
 * @property {Level} level
 * @property {string} pct_text
 * @property {number|null} fill   0..100 in steps of 5, null when unknown
 * @property {string} used_text
 * @property {string} limit_text
 * @property {string} remaining_text
 * @property {string} note
 * @property {string|null} badge  STALE/PARTIAL marker (with age) when an input dataset is not fresh
 */

/**
 * @typedef {object} AccountVM
 * @property {Cell} realized
 * @property {Cell} open
 * @property {Cell} equity
 * @property {Cell} peak
 * @property {Cell} margin_used
 * @property {MeterVM[]} meters
 * @property {string} trade_date
 */

/**
 * @typedef {object} PositionRow
 * @property {string} id
 * @property {string} root
 * @property {'long'|'short'} side
 * @property {number} qty
 * @property {string} entry_text
 * @property {Cell} mark
 * @property {Cell} pnl
 * @property {string} notes
 * @property {string[]} flags
 */

/**
 * @typedef {object} PositionsVM
 * @property {boolean} known
 * @property {string} reason
 * @property {PositionRow[]} rows
 * @property {Cell} std_equiv
 * @property {string|null} badge   STALE marker when the Sheet data behind the list is not fresh
 */

/**
 * @typedef {object} SizerVM
 * @property {SizerForm} form
 * @property {string[]} roots
 * @property {'ok'|'zero'|'unknown'} status
 * @property {Level} level
 * @property {string} contracts_text
 * @property {string} binding_text
 * @property {{key: 'risk'|'margin'|'max_contracts', label: string, text: string, binding: boolean}[]} limits
 * @property {string} per_contract_risk_text
 * @property {Cell} margin
 * @property {Cell} available
 * @property {string} multiplier_text
 * @property {Cell} atr
 * @property {string[]} reasons
 * @property {string[]} warnings
 * @property {string|null} badge   STALE/PARTIAL marker (with age) when an input dataset is not fresh
 */

/**
 * @typedef {object} MarketRow
 * @property {string} root
 * @property {string} name
 * @property {Cell} last
 * @property {Cell} atr
 * @property {Cell} settle
 * @property {Cell} margin
 */

/**
 * @typedef {object} EventVM
 * @property {string} date
 * @property {string} when
 * @property {string} title
 * @property {'high'|'medium'|'low'} impact
 * @property {number} days
 * @property {string} source
 */

/**
 * @typedef {object} ExpiryVM
 * @property {string} root
 * @property {Level} level
 * @property {string} contract_text
 * @property {string} date_text
 * @property {string} days_text
 * @property {string} source
 */

/**
 * @typedef {object} CalendarVM
 * @property {EventVM[]|null} events   null = calendar unavailable
 * @property {string} events_note
 * @property {string|null} badge
 * @property {ExpiryVM[]} expirations
 */

/**
 * @typedef {object} ReconRowVM
 * @property {string} date
 * @property {Level} level
 * @property {string} computed_text
 * @property {string} reported_text
 * @property {string} diff_text
 * @property {string[]} errors
 * @property {{pnl_text: string, balance_text: string, rank_text: string}|null} challenge
 */

/**
 * @typedef {object} ReconVM
 * @property {boolean} known
 * @property {string} reason
 * @property {ReconRowVM[]} rows
 * @property {boolean} challenge_shown
 * @property {string} challenge_note
 * @property {string[]} notes
 */

/**
 * @typedef {object} ViewModel
 * @property {{ct_text: string, today: string, trade_date: string, loaded_text: string}} clock
 * @property {Chip[]} chips
 * @property {BannerVM[]} banners
 * @property {AccountVM|null} account
 * @property {PositionsVM|null} positions
 * @property {SizerVM|null} sizer
 * @property {MarketRow[]|null} markets
 * @property {CalendarVM|null} calendar
 * @property {ReconVM|null} recon
 * @property {{sheet_url: string, watched_roots_text: string, expiry_warn_days: number, sheet_configured: boolean}} settings
 * @property {{unknown: string[], source_doc: string, updated_at: string}} rulesInfo
 * @property {Record<string, string>} sectionErrors  section name -> error text when that section failed to build
 */

/** @type {DatasetName[]} */
const DATASETS = ['bars', 'settlements', 'margins', 'challenge', 'calendar'];

/** @type {(keyof RuleSet)[]} */
export const RULE_KEYS = [
  'starting_balance_usd', 'daily_loss_cap_usd', 'max_drawdown_usd', 'max_contracts', 'micro_to_standard_ratio',
  'flatten_time_ct', 'hold_margin_multipliers', 'margin_basis', 'allowed_roots', 'challenge_start_date',
  'challenge_end_date',
];

/** Sheet data counts as fresh for this long after a successful fetch. */
export const SHEET_FRESH_MIN = 15;

/** @type {Hold[]} */
const HOLDS = ['intraday', 'overnight', 'weekend'];

const LEVEL_RANK = { breach: 0, warn: 1, unknown: 2, ok: 3 };

/**
 * Display level of a freshness state.
 * @param {FreshState} s
 * @returns {Level}
 */
export function freshLevel(s) {
  switch (s) {
    case 'fresh': return 'ok';
    case 'partial':
    case 'stale':
    case 'error': return 'warn';
    case 'invalid': return 'breach';
    default: return 'unknown';
  }
}

/**
 * "42m", "3h 5m", "2d 4h".
 * @param {number|null} min
 * @returns {string}
 */
export function fmtAge(min) {
  if (min === null || !Number.isFinite(min)) return '';
  const m = Math.max(0, Math.floor(min));
  if (m < 60) return `${m}m`;
  if (m < 1440) return `${Math.floor(m / 60)}h ${m % 60}m`;
  return `${Math.floor(m / 1440)}d ${Math.floor((m % 1440) / 60)}h`;
}

const WEEKDAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** @param {number} n */
const pad2 = (n) => String(n).padStart(2, '0');

/**
 * "Wed 30 Sep 14:45 CT".
 * @param {number} ms
 * @returns {string}
 */
function ctClock(ms) {
  const p = ctParts(ms);
  return `${WEEKDAY[p.weekday]} ${p.day} ${MONTH[p.month - 1]} ${pad2(p.hour)}:${pad2(p.minute)} CT`;
}

/**
 * "14:45 CT".
 * @param {number} ms
 * @returns {string}
 */
function ctTime(ms) {
  const p = ctParts(ms);
  return `${pad2(p.hour)}:${pad2(p.minute)} CT`;
}

/**
 * @param {unknown} e
 * @returns {string}
 */
function errMsg(e) {
  return e instanceof Error ? e.message : String(e);
}

/**
 * @param {unknown} v
 * @returns {v is Record<string, unknown>}
 */
function isObj(v) {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * @param {unknown} v
 * @returns {v is number}
 */
function isNum(v) {
  return typeof v === 'number' && Number.isFinite(v);
}

/**
 * @param {Partial<Cell>} c
 * @returns {Cell}
 */
function cell(c) {
  return { text: UNKNOWN_TEXT, known: false, level: null, badge: null, note: '', sign: null, ...c };
}

/**
 * @param {string} note
 * @returns {Cell}
 */
function unknownCell(note) {
  return cell({ text: UNKNOWN_TEXT, known: false, level: 'unknown', note });
}

/**
 * Money cell with sign colouring.
 * @param {number|null} cents
 * @param {string} note
 * @returns {Cell}
 */
function usdCell(cents, note) {
  if (cents === null) return unknownCell(note);
  return cell({ text: fmtUsd(cents), known: true, sign: cents > 0 ? 'pos' : cents < 0 ? 'neg' : null, note });
}

/**
 * Badge for a value from data in the given freshness state ("STALE 3h 5m", "ERROR — last good 1d 2h").
 * @param {Freshness} f
 * @returns {string|null}
 */
function staleBadge(f) {
  if (f.state === 'stale') return `STALE ${fmtAge(f.age_min)}`.trim();
  if (f.state === 'error') return f.age_min === null ? 'ERROR' : `STALE ${fmtAge(f.age_min)} (job error)`;
  if (f.state === 'partial') return 'PARTIAL';
  return null;
}

/**
 * Combined badge for a value derived from several datasets: one "<name> STALE <age>" part per input
 * that is not fresh (e.g. "Sheet STALE 1h 30m (job error) · bars PARTIAL"), or null when all are fresh.
 * @param {Ctx} ctx
 * @param {(DatasetName|'sheet')[]} names
 * @returns {string|null}
 */
function inputsBadge(ctx, names) {
  /** @type {string[]} */
  const parts = [];
  for (const n of names) {
    if (n === 'sheet' && ctx.trades === null) continue; // no Sheet data at all: values are UNKNOWN, not stale
    const b = staleBadge(ctx.fr[n]);
    if (b) parts.push(`${n === 'sheet' ? 'Sheet' : n} ${b}`);
  }
  return parts.length > 0 ? parts.join(' · ') : null;
}

/**
 * Inputs behind account-level figures (equity, margin in use, meters, sizer): the Sheet, plus bars when
 * open positions are marked.
 * @param {Ctx} ctx
 * @returns {string|null}
 */
function accountBadge(ctx) {
  return inputsBadge(ctx, openKnownRows(ctx).length > 0 ? ['sheet', 'bars'] : ['sheet']);
}

/** States whose `data` may be displayed (with a badge when not fresh). */
const DISPLAYABLE = new Set(['fresh', 'partial', 'stale', 'error']);

// ---------------------------------------------------------------------------------------------
// Defensive readers for envelope data (the files are bot-written but the site must not crash on them).

/**
 * Bars for a bars-root, filtered to well-formed entries and sorted ascending by t.
 * @param {AnyEnvelope|null} env
 * @param {string} barsRoot
 * @returns {Bar[]|null} null if the envelope has no bars for this root
 */
function barsOf(env, barsRoot) {
  const d = env?.data;
  if (!isObj(d) || !isObj(d.roots)) return null;
  const entry = d.roots[barsRoot];
  if (!isObj(entry) || !Array.isArray(entry.bars)) return null;
  /** @type {Bar[]} */
  const out = [];
  for (const b of entry.bars) {
    if (isObj(b) && typeof b.t === 'string' && isNum(b.o) && isNum(b.h) && isNum(b.l) && isNum(b.c)) {
      out.push({ t: b.t, o: b.o, h: b.h, l: b.l, c: b.c, v: isNum(b.v) ? b.v : 0 });
    }
  }
  out.sort((a, b) => (a.t < b.t ? -1 : a.t > b.t ? 1 : 0));
  return out.length > 0 ? out : null;
}

/**
 * @param {AnyEnvelope|null} env
 * @returns {MarginRow[]|null}
 */
function marginRowsOf(env) {
  const d = env?.data;
  if (!isObj(d) || !Array.isArray(d.rows)) return null;
  /** @type {MarginRow[]} */
  const out = [];
  for (const r of d.rows) {
    if (!isObj(r) || typeof r.root !== 'string') continue;
    out.push({
      root: r.root,
      initial_usd: isNum(r.initial_usd) ? r.initial_usd : null,
      maintenance_usd: isNum(r.maintenance_usd) ? r.maintenance_usd : null,
      as_of: typeof r.as_of === 'string' ? r.as_of : null,
    });
  }
  return out;
}

/**
 * @param {AnyEnvelope|null} env
 * @returns {{root: string, contract_code: string, settle: number, trade_date: string}[]}
 */
function settleRowsOf(env) {
  const d = env?.data;
  if (!isObj(d) || !Array.isArray(d.rows)) return [];
  /** @type {{root: string, contract_code: string, settle: number, trade_date: string}[]} */
  const out = [];
  for (const r of d.rows) {
    if (isObj(r) && typeof r.root === 'string' && isNum(r.settle) && typeof r.trade_date === 'string') {
      out.push({ root: r.root, contract_code: typeof r.contract_code === 'string' ? r.contract_code : '', settle: r.settle, trade_date: r.trade_date });
    }
  }
  return out;
}

/**
 * @param {AnyEnvelope|null} env
 * @returns {{date: string, pnl_usd: number|null, balance_usd: number|null, rank: number|null}[]}
 */
function challengeRowsOf(env) {
  const d = env?.data;
  if (!isObj(d) || !Array.isArray(d.rows)) return [];
  /** @type {{date: string, pnl_usd: number|null, balance_usd: number|null, rank: number|null}[]} */
  const out = [];
  for (const r of d.rows) {
    if (isObj(r) && typeof r.date === 'string') {
      out.push({
        date: r.date,
        pnl_usd: isNum(r.pnl_usd) ? r.pnl_usd : null,
        balance_usd: isNum(r.balance_usd) ? r.balance_usd : null,
        rank: isNum(r.rank) ? r.rank : null,
      });
    }
  }
  return out;
}

/**
 * @param {AnyEnvelope|null} env
 * @returns {{events: CalendarEvent[], expirations: ExpirationEntry[]}|null}
 */
function calendarOf(env) {
  const d = env?.data;
  if (!isObj(d)) return null;
  const DATE = /^\d{4}-\d{2}-\d{2}$/;
  /** @type {CalendarEvent[]} */
  const events = [];
  for (const e of Array.isArray(d.events) ? d.events : []) {
    if (isObj(e) && typeof e.date === 'string' && DATE.test(e.date) && typeof e.title === 'string') {
      const impact = e.impact === 'high' || e.impact === 'medium' || e.impact === 'low' ? e.impact : 'low';
      const time = typeof e.time_ct === 'string' && /^\d{2}:\d{2}$/.test(e.time_ct) ? e.time_ct : null;
      events.push({ date: e.date, time_ct: time, title: e.title, impact, source: typeof e.source === 'string' ? e.source : '' });
    }
  }
  /** @type {ExpirationEntry[]} */
  const expirations = [];
  for (const x of Array.isArray(d.expirations) ? d.expirations : []) {
    if (isObj(x) && typeof x.root === 'string' && typeof x.date === 'string' && DATE.test(x.date)) {
      expirations.push({ root: x.root, contract_code: typeof x.contract_code === 'string' ? x.contract_code : x.root, date: x.date, source: typeof x.source === 'string' ? x.source : '' });
    }
  }
  return { events, expirations };
}

// ---------------------------------------------------------------------------------------------

/**
 * Shared, already-derived facts every section uses.
 * @typedef {object} Ctx
 * @property {number} now
 * @property {string} today          CT calendar date
 * @property {string} td             CME trade date
 * @property {RuleSet|null} rs
 * @property {ContractsFile|null} contracts
 * @property {Record<DatasetName, AnyEnvelope|null>} envs
 * @property {Record<DatasetName|'sheet', Freshness>} fr
 * @property {SheetResult|null} sheet
 * @property {Trade[]|null} trades       null = Sheet data unavailable
 * @property {string[]} tradeRowErrors
 * @property {Trade[]|null} open        null = the set of open positions is UNKNOWN (no Sheet, or any invalid Trades row)
 * @property {string} openWhy            why `open` is null ('' when known)
 * @property {'initial'|'maintenance'|null} basis
 * @property {MarginRow[]|null} cmeRows
 * @property {boolean} cmeFresh
 * @property {MarginRow[]|null} sheetMargins
 * @property {Settings} settings
 * @property {SizerForm} form
 */

/**
 * @param {VMInputs} inp
 * @returns {Freshness}
 */
function sheetFreshness(inp) {
  const { settings, sheet, nowMs } = inp;
  if (settings.sheet_url.trim() === '') {
    return { state: 'missing', age_min: null, reason: 'Sheet not configured — add the Apps Script URL and key in Settings' };
  }
  if (sheet === null) return { state: 'missing', age_min: null, reason: 'Sheet not loaded yet' };
  const age = sheet.fetchedAtMs === null ? null : Math.floor((nowMs - sheet.fetchedAtMs) / 60000);
  if (sheet.error !== null) {
    return { state: 'error', age_min: sheet.data ? age : null, reason: sheet.error };
  }
  if (sheet.data === null || age === null) return { state: 'missing', age_min: null, reason: 'no Sheet data' };
  if (age > SHEET_FRESH_MIN) return { state: 'stale', age_min: age, reason: `last fetched ${fmtAge(age)} ago (max ${SHEET_FRESH_MIN}m)` };
  if (sheet.rowErrors.length > 0) return { state: 'partial', age_min: age, reason: `${sheet.rowErrors.length} invalid row(s)` };
  return { state: 'fresh', age_min: age, reason: 'fresh' };
}

/**
 * @param {VMInputs} inp
 * @returns {Ctx}
 */
function buildCtx(inp) {
  const now = inp.nowMs;
  const rs = inp.rules?.rules ?? null;
  /** @type {Record<string, Freshness>} */
  const fr = {};
  for (const name of DATASETS) {
    try {
      fr[name] = classifyFreshness(inp.envs[name] ?? null, now, POLICIES[name]);
    } catch (e) {
      fr[name] = { state: 'invalid', age_min: null, reason: `freshness check failed: ${errMsg(e)}` };
    }
    const le = inp.loadErrors?.[name];
    const f = fr[name];
    if (f && f.state === 'missing' && le) f.reason = `${f.reason} (${le})`;
  }
  fr.sheet = sheetFreshness(inp);
  const frTyped = /** @type {Record<DatasetName|'sheet', Freshness>} */ (fr);

  const sheetData = inp.sheet?.data ?? null;
  const trades = sheetData ? sheetData.trades : null;
  const rowErrors = inp.sheet?.rowErrors ?? [];
  const tradeRowErrors = rowErrors.filter((e) => e.startsWith(TRADES_ROW_PREFIX));
  const basisRule = ruleValue(rs, 'margin_basis');
  // Any rejected Trades row could be an open position, so the open set is only known when every row is valid.
  const n = tradeRowErrors.length;
  const openWhy = trades === null
    ? (frTyped.sheet.state === 'missing' ? 'Sheet not loaded' : `Sheet ${frTyped.sheet.state}: ${frTyped.sheet.reason}`)
    : n > 0 ? `open positions UNKNOWN (${n} invalid Sheet row${n === 1 ? '' : 's'})` : '';
  const basis = basisRule.known && (basisRule.value === 'initial' || basisRule.value === 'maintenance') ? basisRule.value : null;

  return {
    now,
    today: ctDate(now),
    td: tradeDate(now),
    rs,
    contracts: inp.contracts,
    envs: inp.envs,
    fr: frTyped,
    sheet: inp.sheet,
    trades,
    tradeRowErrors,
    open: trades && n === 0 ? trades.filter((t) => t.exit === null) : null,
    openWhy,
    basis,
    cmeRows: marginRowsOf(inp.envs.margins ?? null),
    cmeFresh: frTyped.margins.state === 'fresh',
    sheetMargins: sheetData ? sheetData.margins : null,
    settings: inp.settings,
    form: inp.sizerForm,
  };
}

/** Label for any mark or last price taken from bars (P1-5: may differ from a held back month during the roll). */
export const CONT_LABEL = 'front-month continuous (.c.0)';

/** Duration of one bar in the bars envelope (1h bars; `t` is the bar's open time). */
const BAR_MS = 60 * 60 * 1000;

/**
 * Freshness of one root's own series: a synthetic envelope whose data_as_of is the last bar's close
 * (t + 1h, capped at now for a still-forming bar), classified with the bars policy. The envelope's
 * data_as_of is the newest bar across all roots, so a lagging root would otherwise look fresh.
 * @param {Ctx} ctx
 * @param {Bar} last
 * @returns {Freshness}
 */
function rootFreshness(ctx, last) {
  const t = Date.parse(last.t);
  if (!Number.isFinite(t)) return { state: 'invalid', age_min: null, reason: `bar time unparsable: ${last.t}` };
  const close = Math.min(t + BAR_MS, ctx.now);
  /** @type {AnyEnvelope} */
  const synthetic = {
    schema_version: 1, dataset: 'bars', generated_at: new Date(close).toISOString(), data_as_of: new Date(close).toISOString(),
    source: 'last bar close', status: 'ok', errors: [], data: null,
  };
  try {
    return classifyFreshness(synthetic, ctx.now, POLICIES.bars);
  } catch (e) {
    return { state: 'invalid', age_min: null, reason: `freshness check failed: ${errMsg(e)}` };
  }
}

/**
 * Mark price for a root from the bars envelope. Usable (for open P&L) only if both the envelope and the
 * root's own series are fresh (or the envelope partial); `fr` is the freshness the mark is shown with.
 * @param {Ctx} ctx
 * @param {string} root
 * @returns {{price: number|null, usable: boolean, bars: Bar[]|null, spec: ContractSpec|null, reason: string, fr: Freshness, symbol: string}}
 */
function markFor(ctx, root) {
  const f = ctx.fr.bars;
  const spec = resolveSpec(root, ctx.contracts);
  if (!spec) return { price: null, usable: false, bars: null, spec: null, reason: `${root} not in contracts.json`, fr: f, symbol: '' };
  const br = barsRootFor(root, ctx.contracts);
  const symbol = br ? `${br}.c.0` : '';
  if (!br || !DISPLAYABLE.has(f.state)) return { price: null, usable: false, bars: null, spec, reason: `bars ${f.state.toUpperCase()}`, fr: f, symbol };
  const bars = barsOf(ctx.envs.bars, br);
  const last = bars?.[bars.length - 1];
  if (!bars || !last) return { price: null, usable: false, bars: null, spec, reason: `no bars for ${br}`, fr: f, symbol };
  const price = lastClose(bars);
  const rf = rootFreshness(ctx, last);
  if (rf.state !== 'fresh') {
    // The root's own series is older than the policy: show the worse (older) of the two ages.
    const worse = (f.state === 'stale' || f.state === 'error') && (f.age_min ?? -1) >= (rf.age_min ?? -1) ? f : { ...rf, state: /** @type {FreshState} */ ('stale') };
    return { price, usable: false, bars, spec, reason: `${br} bars ${worse.state.toUpperCase()} (last bar closed ${fmtAge(rf.age_min)} ago) — open P&L not marked`, fr: worse, symbol };
  }
  const usable = f.state === 'fresh' || f.state === 'partial';
  return { price, usable, bars, spec, reason: usable ? '' : `bars ${f.state.toUpperCase()} — open P&L not marked`, fr: f, symbol };
}

/**
 * Mark cell (price + STALE badge when the bars are stale).
 * @param {Ctx} ctx
 * @param {ReturnType<typeof markFor>} m
 * @returns {Cell}
 */
function markCell(ctx, m) {
  if (m.price === null || !m.spec) return unknownCell(m.reason);
  const last = m.bars?.[m.bars.length - 1];
  return cell({
    text: fmtPrice(m.price, m.spec.tick_size),
    known: true,
    badge: staleBadge(m.fr),
    level: m.usable ? null : 'warn',
    note: last ? `last 1h close, bar ${last.t.slice(0, 16).replace('T', ' ')}Z · ${m.symbol ? `${m.symbol} ` : ''}${CONT_LABEL}` : CONT_LABEL,
  });
}

/**
 * Open P&L of one open trade in cents, or null with a reason.
 * @param {Ctx} ctx
 * @param {Trade} t
 * @returns {{cents: number|null, reason: string, mark: ReturnType<typeof markFor>}}
 */
function openPnl(ctx, t) {
  const m = markFor(ctx, t.root);
  if (!m.spec) return { cents: null, reason: m.reason, mark: m };
  if (!m.usable || m.price === null) return { cents: null, reason: m.reason || 'no mark', mark: m };
  try {
    return { cents: tradePnlCents(t, m.spec, m.price).net_cents, reason: '', mark: m };
  } catch (e) {
    return { cents: null, reason: `cannot price ${t.id}: ${errMsg(e)}`, mark: m };
  }
}

/**
 * Hold multiplier for the selected hold, or null.
 * @param {Ctx} ctx
 * @returns {number|null}
 */
function holdMultiplier(ctx) {
  const r = ruleValue(ctx.rs, 'hold_margin_multipliers');
  if (!r.known) return null;
  const v = /** @type {Record<string, unknown>} */ (r.value)[ctx.form.hold];
  return isNum(v) ? v : null;
}

/**
 * Money facts shared by account, positions and sizer.
 * @typedef {object} Money
 * @property {number|null} realized
 * @property {string} realizedReason
 * @property {number|null} open
 * @property {string} openReason
 * @property {number|null} equity
 * @property {string} equityReason
 * @property {number|null} peak
 * @property {string} peakReason
 * @property {number|null} marginUsed
 * @property {string} marginReason
 */

/**
 * @param {Ctx} ctx
 * @returns {Money}
 */
function computeMoney(ctx) {
  const sheetWhy = ctx.fr.sheet.state === 'missing' ? 'Sheet not loaded' : `Sheet ${ctx.fr.sheet.state}: ${ctx.fr.sheet.reason}`;
  // Realized today + all closed trades.
  let realized = /** @type {number|null} */ (null);
  let realizedReason = '';
  let closedTotal = /** @type {number|null} */ (null);
  let closedReason = '';
  if (ctx.trades === null) {
    realizedReason = closedReason = sheetWhy;
  } else if (ctx.tradeRowErrors.length > 0) {
    realizedReason = closedReason = `${ctx.tradeRowErrors.length} invalid Trades row(s) in the Sheet`;
  } else {
    const byDate = dailyNetByTradeDate(ctx.trades, ctx.contracts);
    const today = byDate.get(ctx.td);
    if (today === undefined) realized = 0;
    else if (today.net_cents === null) realizedReason = today.errors.join('; ') || 'a trade cannot be priced';
    else realized = today.net_cents;
    let sum = 0;
    for (const v of byDate.values()) {
      if (v.net_cents === null) {
        closedReason = v.errors.join('; ') || 'a closed trade cannot be priced';
        sum = NaN;
        break;
      }
      sum += v.net_cents;
    }
    closedTotal = Number.isNaN(sum) ? null : sum;
  }

  // Open P&L.
  let open = /** @type {number|null} */ (null);
  let openReason = '';
  if (ctx.open === null) openReason = ctx.openWhy;
  else {
    let sum = 0;
    for (const t of ctx.open) {
      const p = openPnl(ctx, t);
      if (p.cents === null) {
        openReason = `${t.id} (${t.root}): ${p.reason}`;
        sum = NaN;
        break;
      }
      sum += p.cents;
    }
    open = Number.isNaN(sum) ? null : sum;
  }

  // Equity and peak (PLAN §6 #3/#4).
  const sb = ruleValue(ctx.rs, 'starting_balance_usd');
  const start = sb.known ? usdToCents(sb.value) : null;
  let equity = /** @type {number|null} */ (null);
  let equityReason = '';
  if (start === null) equityReason = 'starting_balance_usd rule UNKNOWN';
  else if (closedTotal === null) equityReason = `closed P&L UNKNOWN: ${closedReason}`;
  else if (open === null) equityReason = `open P&L UNKNOWN: ${openReason}`;
  else equity = start + closedTotal + open;

  // Peak is only known when every Daily row was accepted and carries a balance: a missing row could hold the max.
  let peak = /** @type {number|null} */ (null);
  let peakReason = '';
  const daily = ctx.sheet?.data?.daily ?? null;
  const dailyBad = (ctx.sheet?.rowErrors ?? []).filter((e) => e.startsWith(DAILY_ROW_PREFIX)).length;
  const noBalance = (daily ?? []).filter((d) => !isNum(d.reported_balance_usd)).map((d) => d.date);
  if (start === null) peakReason = 'starting_balance_usd rule UNKNOWN';
  else if (daily === null) peakReason = `peak UNKNOWN: ${sheetWhy}`;
  else if (dailyBad > 0) peakReason = `peak UNKNOWN: ${dailyBad} invalid Daily row${dailyBad === 1 ? '' : 's'} in the Sheet`;
  else if (noBalance.length > 0) {
    peakReason = `peak UNKNOWN: Daily ${noBalance.slice(0, 3).join(', ')}${noBalance.length > 3 ? ' …' : ''} has no reported balance`;
  } else {
    peak = start;
    for (const d of daily) peak = Math.max(peak, usdToCents(/** @type {number} */ (d.reported_balance_usd)));
    peakReason = 'max(starting balance, Sheet Daily EOD balances)';
  }

  // Margin in use by open positions at the selected hold multiplier.
  let marginUsed = /** @type {number|null} */ (null);
  let marginReason = '';
  if (ctx.open === null) marginReason = ctx.openWhy;
  else if (ctx.open.length === 0) marginUsed = 0;
  else {
    const mult = holdMultiplier(ctx);
    if (mult === null) marginReason = `${ctx.form.hold} hold margin multiplier UNKNOWN`;
    else {
      let sum = 0;
      for (const t of ctx.open) {
        const m = resolveMargin(t.root, ctx.basis, ctx.cmeRows, ctx.cmeFresh, ctx.sheetMargins);
        if (m.value_usd === null) {
          marginReason = `${t.root}: ${m.reason}`;
          sum = NaN;
          break;
        }
        sum += Math.round(usdToCents(m.value_usd) * mult) * t.qty;
      }
      marginUsed = Number.isNaN(sum) ? null : sum;
    }
  }
  return { realized, realizedReason, open, openReason, equity, equityReason, peak, peakReason, marginUsed, marginReason };
}

/**
 * @param {Meter} m
 * @param {string} key
 * @param {string} label
 * @param {string} note
 * @param {string|null} badge
 * @returns {MeterVM}
 */
function meterVM(m, key, label, note, badge) {
  const ratio = m.used_ratio;
  return {
    key,
    label,
    level: m.level,
    pct_text: fmtPct(ratio),
    fill: ratio === null ? null : Math.min(100, Math.max(0, Math.round((ratio * 100) / 5) * 5)),
    used_text: fmtUsd(m.used_cents),
    limit_text: fmtUsd(m.limit_cents),
    remaining_text: fmtUsd(m.remaining_cents),
    note: m.level === 'unknown' && m.reason ? `${note}${note ? ' · ' : ''}${m.reason}` : note,
    badge,
  };
}

/**
 * @param {Ctx} ctx
 * @param {Money} money
 * @returns {AccountVM}
 */
function buildAccount(ctx, money) {
  const sheetBadge = ctx.trades !== null ? staleBadge(ctx.fr.sheet) : null;
  const acctBadge = accountBadge(ctx);
  const realized = usdCell(money.realized, money.realized === null ? money.realizedReason : `closed trades, trade date ${ctx.td}`);
  realized.badge = sheetBadge;
  const open = usdCell(money.open, money.open === null ? money.openReason : ctx.open && ctx.open.length > 0 ? `marked at last 1h close, ${CONT_LABEL}` : 'flat');
  if (money.open !== null && ctx.open && ctx.open.length > 0) open.badge = acctBadge;
  const equity = usdCell(money.equity, money.equity === null ? money.equityReason : 'start + closed + open');
  equity.sign = null;
  equity.badge = acctBadge;
  const peak = usdCell(money.peak, money.peakReason);
  peak.sign = null;
  peak.badge = sheetBadge;
  const marginUsed = usdCell(money.marginUsed, money.marginUsed === null ? money.marginReason : `${ctx.form.hold} hold, ${ctx.basis ?? '?'} basis`);
  marginUsed.sign = null;
  marginUsed.badge = acctBadge;

  /** @type {Meter} */
  let loss;
  if (money.realized === null) {
    loss = dailyLossMeter(0, null, ctx.rs);
    loss = { ...loss, level: 'unknown', used_cents: null, used_ratio: null, remaining_cents: null, reason: `today's realized P&L UNKNOWN (${money.realizedReason})` };
  } else {
    loss = dailyLossMeter(money.realized, money.open, ctx.rs);
    if (loss.level === 'unknown' && money.open === null) loss = { ...loss, reason: `open P&L UNKNOWN (${money.openReason})` };
  }
  let dd = drawdownMeter(money.equity, money.peak, ctx.rs);
  if (dd.level === 'unknown' && ruleValue(ctx.rs, 'max_drawdown_usd').known) {
    /** @type {string[]} */
    const why = [];
    if (money.peak === null) why.push(money.peakReason);
    if (money.equity === null) why.push(`equity UNKNOWN (${money.equityReason})`);
    if (why.length > 0) dd = { ...dd, reason: why.join('; ') };
  }
  let mm = marginMeter(money.marginUsed, money.equity);
  if (mm.level === 'unknown') {
    const why = money.marginUsed === null ? `margin in use UNKNOWN (${money.marginReason})`
      : money.equity === null ? `equity UNKNOWN (${money.equityReason})` : 'equity is not positive';
    mm = { ...mm, reason: why };
  }
  return {
    realized,
    open,
    equity,
    peak,
    margin_used: marginUsed,
    trade_date: ctx.td,
    meters: [
      meterVM(loss, 'daily_loss', 'Daily loss vs cap', 'assumes loss = −(realized today + open P&L since entry); confirm against RULES.md', acctBadge),
      meterVM(dd, 'drawdown', 'Drawdown vs max', 'assumes EOD trailing: peak = max(start, EOD balances)', acctBadge),
      meterVM(mm, 'margin', 'Margin in use vs equity', `${ctx.form.hold} hold multiplier`, acctBadge),
    ],
  };
}

/**
 * @param {Ctx} ctx
 * @returns {PositionsVM}
 */
function buildPositions(ctx) {
  const ratioRule = ruleValue(ctx.rs, 'micro_to_standard_ratio');
  const maxRule = ruleValue(ctx.rs, 'max_contracts');
  const allowed = ruleValue(ctx.rs, 'allowed_roots');
  if (ctx.open === null) {
    const why = ctx.trades === null ? ctx.fr.sheet.reason : ctx.openWhy;
    return { known: false, reason: `Positions UNKNOWN — ${why}`, rows: [], std_equiv: unknownCell(why), badge: null };
  }
  /** @type {PositionRow[]} */
  const rows = ctx.open.map((t) => {
    const p = openPnl(ctx, t);
    const spec = p.mark.spec;
    /** @type {string[]} */
    const flags = [];
    if (!spec) flags.push(`${t.root} not in contracts.json`);
    if (allowed.known && Array.isArray(allowed.value) && !allowed.value.includes(t.root)) flags.push(`${t.root} not in allowed_roots`);
    const pnl = usdCell(p.cents, p.cents === null ? p.reason : '');
    if (p.cents !== null) pnl.badge = staleBadge(p.mark.fr);
    return {
      id: t.id,
      root: t.root,
      side: t.side,
      qty: t.qty,
      entry_text: spec ? fmtPrice(t.entry, spec.tick_size) : String(t.entry),
      mark: markCell(ctx, p.mark),
      pnl,
      notes: t.notes ?? '',
      flags,
    };
  });
  const se = standardEquivalent(ctx.open.map((t) => ({ root: t.root, qty: t.qty })), ctx.contracts, ratioRule.known ? ratioRule.value : null);
  /** @type {Cell} */
  let std;
  if (se === null) {
    std = unknownCell(ratioRule.known ? 'an open root is not in contracts.json' : 'micro_to_standard_ratio rule UNKNOWN');
  } else if (!maxRule.known) {
    std = cell({ text: `${fmtQty(se)} / ${UNKNOWN_TEXT}`, known: true, level: 'unknown', note: 'max_contracts rule UNKNOWN' });
  } else {
    const max = maxRule.value;
    const level = se > max ? 'breach' : max > 0 && se >= WARN_RATIO * max && se > 0 ? 'warn' : 'ok';
    std = cell({ text: `${fmtQty(se)} / ${fmtQty(max)}`, known: true, level, note: 'standard-equivalent contracts open vs max_contracts' });
  }
  const badge = inputsBadge(ctx, ['sheet']);
  std.badge = badge;
  return { known: true, reason: rows.length === 0 ? 'Flat — no open positions in the Sheet' : '', rows, std_equiv: std, badge };
}

/**
 * @param {number} n
 * @returns {string}
 */
function fmtQty(n) {
  return Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
}

/**
 * ATR(14) as a stop hint in ticks.
 * @param {Ctx} ctx
 * @param {string} root
 * @returns {Cell}
 */
function atrCell(ctx, root) {
  const m = markFor(ctx, root);
  if (!m.spec || !m.bars) return unknownCell(m.reason || 'no bars');
  const a = atr(m.bars, 14);
  if (a === null) return unknownCell('fewer than 15 bars');
  const ticks = a / m.spec.tick_size;
  return cell({
    text: `${ticks.toFixed(1)} ticks`,
    known: true,
    badge: staleBadge(m.fr),
    note: `ATR(14) on 1h bars = ${fmtPrice(a, m.spec.tick_size / 100)} pts`,
  });
}

/**
 * Margin cell for a root on the rules' basis.
 * @param {Ctx} ctx
 * @param {string} root
 * @returns {Cell}
 */
function marginCell(ctx, root) {
  const r = resolveMargin(root, ctx.basis, ctx.cmeRows, ctx.cmeFresh, ctx.sheetMargins);
  if (r.value_usd === null) return unknownCell(r.reason);
  const rows = r.source === 'cme' ? ctx.cmeRows : ctx.sheetMargins;
  const asOf = rows?.find((x) => x.root === root)?.as_of ?? null;
  return cell({
    text: fmtUsd(usdToCents(r.value_usd)),
    known: true,
    note: `${r.source === 'cme' ? 'CME' : 'Sheet'} ${ctx.basis ?? ''} · as of ${asOf ?? UNKNOWN_TEXT}`,
    badge: r.source === 'sheet' ? 'SHEET' : null,
  });
}

/**
 * @param {Ctx} ctx
 * @param {Money} money
 * @returns {SizerVM}
 */
function buildSizer(ctx, money) {
  const f = ctx.form;
  const roots = ctx.contracts ? ctx.contracts.contracts.map((c) => c.root) : [];
  if (!roots.includes(f.root) && f.root) roots.push(f.root);
  const spec = resolveSpec(f.root, ctx.contracts);
  const mult = holdMultiplier(ctx);
  const margin = marginCell(ctx, f.root);
  const avail = money.equity !== null && money.marginUsed !== null ? money.equity - money.marginUsed : null;
  const available = usdCell(avail, avail === null
    ? (money.equity === null ? `equity UNKNOWN (${money.equityReason})` : `margin in use UNKNOWN (${money.marginReason})`)
    : 'equity − margin in use');
  available.sign = null;
  const badge = accountBadge(ctx);
  available.badge = badge;
  /** @type {string[]} */
  const warnings = [];
  const allowed = ruleValue(ctx.rs, 'allowed_roots');
  if (allowed.known && Array.isArray(allowed.value) && !allowed.value.includes(f.root)) warnings.push(`${f.root} is not in allowed_roots`);
  if (avail !== null && avail < 0) warnings.push('available margin is negative');

  const base = {
    form: f,
    roots,
    per_contract_risk_text: UNKNOWN_TEXT,
    margin,
    available,
    multiplier_text: mult === null ? UNKNOWN_TEXT : `×${mult}`,
    atr: atrCell(ctx, f.root),
    warnings,
    badge,
  };
  /** @type {string[]} */
  const inputProblems = [];
  if (!spec) inputProblems.push(`${f.root} not in contracts.json`);
  if (!isNum(f.risk_budget_usd) || f.risk_budget_usd < 0) inputProblems.push('enter a risk budget (USD, ≥ 0)');
  if (!isNum(f.stop_ticks) || !Number.isInteger(f.stop_ticks) || f.stop_ticks <= 0) inputProblems.push('enter the stop distance in whole ticks (> 0)');
  if (!isNum(f.fee_per_contract_usd) || f.fee_per_contract_usd < 0) inputProblems.push('enter the round-turn fee per contract (USD, 0 if none)');
  if (!ctx.rs) inputProblems.push('rules.json unavailable');
  const unknownLimits = [
    { key: /** @type {const} */ ('risk'), label: 'Risk', text: UNKNOWN_TEXT, binding: false },
    { key: /** @type {const} */ ('margin'), label: 'Margin', text: UNKNOWN_TEXT, binding: false },
    { key: /** @type {const} */ ('max_contracts'), label: 'Max contracts', text: UNKNOWN_TEXT, binding: false },
  ];
  if (inputProblems.length > 0 || !spec || !ctx.rs) {
    return { ...base, status: 'unknown', level: 'unknown', contracts_text: UNKNOWN_TEXT, binding_text: '', limits: unknownLimits, reasons: inputProblems };
  }
  const res = sizePosition({
    spec,
    risk_budget_usd: /** @type {number} */ (f.risk_budget_usd),
    stop_ticks: /** @type {number} */ (f.stop_ticks),
    fee_per_contract_usd: /** @type {number} */ (f.fee_per_contract_usd),
    available_margin_usd: avail === null ? null : Math.max(0, avail) / 100,
    margin_per_contract_usd: margin.known ? resolveMargin(f.root, ctx.basis, ctx.cmeRows, ctx.cmeFresh, ctx.sheetMargins).value_usd : null,
    hold: f.hold,
    rules: ctx.rs,
  });
  /** @type {string[]} */
  const reasons = [...res.reasons];
  if (res.status === 'unknown') {
    if (avail === null) reasons.push(available.note);
    if (!margin.known) reasons.push(`margin: ${margin.note}`);
  }
  /** @type {Record<string, string>} */
  const LABEL = { risk: 'risk budget', margin: 'available margin', max_contracts: 'max contracts' };
  const limits = /** @type {const} */ (['risk', 'margin', 'max_contracts']).map((key) => {
    const v = res.limits[key];
    return {
      key,
      label: key === 'max_contracts' ? 'Max contracts' : key === 'risk' ? 'Risk' : 'Margin',
      text: v === null ? UNKNOWN_TEXT : String(v),
      binding: res.binding === key,
    };
  });
  return {
    ...base,
    status: res.status,
    level: res.status === 'ok' ? 'ok' : res.status === 'zero' ? 'warn' : 'unknown',
    contracts_text: res.contracts === null ? UNKNOWN_TEXT : String(res.contracts),
    binding_text: res.binding ? `bound by ${LABEL[res.binding] ?? res.binding}` : '',
    limits,
    per_contract_risk_text: fmtUsd(res.per_contract_risk_cents),
    reasons: [...new Set(reasons)],
  };
}

/**
 * @param {Ctx} ctx
 * @returns {MarketRow[]}
 */
function buildMarkets(ctx) {
  const settle = settleRowsOf(ctx.envs.settlements);
  const sf = ctx.fr.settlements;
  return ctx.settings.watched_roots.map((root) => {
    const m = markFor(ctx, root);
    const spec = m.spec;
    /** @type {Cell} */
    let settleCell;
    const rows = settle.filter((r) => r.root === root).sort((a, b) => (a.trade_date < b.trade_date ? 1 : -1));
    const s = rows[0];
    if (!DISPLAYABLE.has(sf.state)) settleCell = unknownCell(`settlements ${sf.state.toUpperCase()}`);
    else if (!s || !spec) settleCell = unknownCell(`no settlement for ${root}`);
    else {
      settleCell = cell({
        text: fmtPrice(s.settle, spec.tick_size),
        known: true,
        badge: staleBadge(sf),
        note: `${s.contract_code || root} · ${s.trade_date}`,
      });
    }
    return {
      root,
      name: spec ? spec.name : 'not in contracts.json',
      last: markCell(ctx, m),
      atr: atrCell(ctx, root),
      settle: settleCell,
      margin: marginCell(ctx, root),
    };
  });
}

/**
 * @param {Ctx} ctx
 * @returns {CalendarVM}
 */
function buildCalendar(ctx) {
  const f = ctx.fr.calendar;
  const cal = DISPLAYABLE.has(f.state) ? calendarOf(ctx.envs.calendar) : null;
  /** @type {EventVM[]|null} */
  let events = null;
  let note = '';
  if (cal === null) note = `Calendar ${f.state.toUpperCase()}: ${f.reason}`;
  else {
    events = cal.events
      .filter((e) => e.date >= ctx.today)
      .sort((a, b) => (a.date + (a.time_ct ?? '')).localeCompare(b.date + (b.time_ct ?? '')))
      .slice(0, 3)
      .map((e) => ({
        date: e.date,
        when: `${WEEKDAY[weekdayOf(e.date)]} ${e.date}${e.time_ct ? ` ${e.time_ct} CT` : ' (all day)'}`,
        title: e.title,
        impact: e.impact,
        days: daysBetween(ctx.today, e.date),
        source: e.source,
      }));
    if (events.length === 0) note = 'No upcoming events in calendar.json';
  }
  const calExps = cal ? cal.expirations : [];
  const roots = unionRoots(ctx);
  const expirations = roots.map((root) => {
    const x = nextExpiration(root, ctx.today, ctx.contracts, calExps);
    const b = expiryBanner(root, x, ctx.today, ctx.settings.expiry_warn_days);
    return {
      root,
      level: b.level,
      contract_text: x ? x.contract_code : UNKNOWN_TEXT,
      date_text: x ? `${WEEKDAY[weekdayOf(x.date)]} ${x.date}` : UNKNOWN_TEXT,
      days_text: b.value === null ? UNKNOWN_TEXT : `${b.value}d`,
      source: x ? x.source : 'manual expiry rule: add it to calendar.json',
    };
  });
  return { events, events_note: note, badge: staleBadge(f), expirations };
}

/**
 * Open rows among the valid Trades rows (a lower bound when some rows are invalid).
 * @param {Ctx} ctx
 * @returns {Trade[]}
 */
function openKnownRows(ctx) {
  return ctx.open ?? (ctx.trades ?? []).filter((t) => t.exit === null);
}

/**
 * Open-position roots ∪ watched roots (watched order first).
 * @param {Ctx} ctx
 * @returns {string[]}
 */
function unionRoots(ctx) {
  const out = [...ctx.settings.watched_roots];
  for (const t of openKnownRows(ctx)) if (!out.includes(t.root)) out.push(t.root);
  return out;
}

/**
 * @param {Ctx} ctx
 * @returns {ReconVM}
 */
function buildRecon(ctx) {
  const cf = ctx.fr.challenge;
  const challengeShown = cf.state === 'fresh';
  const challengeNote = challengeShown ? '' : `Challenge results ${cf.state.toUpperCase()} — showing Sheet Daily only`;
  if (ctx.trades === null || !ctx.sheet?.data) {
    return { known: false, reason: `Reconciliation UNKNOWN — ${ctx.fr.sheet.reason}`, rows: [], challenge_shown: false, challenge_note: challengeNote, notes: [] };
  }
  const computed = dailyNetByTradeDate(ctx.trades, ctx.contracts);
  const rows = reconcile(computed, ctx.sheet.data.daily, 10);
  const ch = challengeShown ? challengeRowsOf(ctx.envs.challenge) : [];
  /** @type {string[]} */
  const notes = [];
  if (ctx.tradeRowErrors.length > 0) notes.push(`${ctx.tradeRowErrors.length} invalid Trades row(s) are excluded — computed totals may be incomplete`);
  return {
    known: true,
    reason: rows.length === 0 ? 'No closed trades or Daily rows yet' : '',
    rows: rows.map((r) => {
      const unknownDate = !/^\d{4}-\d{2}-\d{2}$/.test(r.date);
      const c = ch.find((x) => x.date === r.date);
      return {
        date: unknownDate ? 'UNKNOWN DATE' : r.date,
        level: unknownDate ? 'warn' : r.level,
        computed_text: fmtUsd(r.computed_cents),
        reported_text: fmtUsd(r.reported_cents),
        diff_text: r.diff_cents === null ? UNKNOWN_TEXT : `${r.diff_cents > 0 ? '+' : ''}${fmtUsd(r.diff_cents)}`,
        errors: r.errors,
        challenge: challengeShown
          ? {
            pnl_text: c && c.pnl_usd !== null ? fmtUsd(usdToCents(c.pnl_usd)) : UNKNOWN_TEXT,
            balance_text: c && c.balance_usd !== null ? fmtUsd(usdToCents(c.balance_usd)) : UNKNOWN_TEXT,
            rank_text: c && c.rank !== null ? `#${c.rank}` : UNKNOWN_TEXT,
          }
          : null,
      };
    }),
    challenge_shown: challengeShown,
    challenge_note: challengeNote,
    notes,
  };
}

/** @type {Record<DatasetName|'sheet', string>} */
const DATA_IMPACT = {
  bars: 'marks, open P&L and ATR are UNKNOWN or STALE',
  settlements: 'settlements shown STALE or UNKNOWN',
  margins: 'margins fall back to the Sheet Margins tab where present',
  challenge: 'reconciliation shows Sheet Daily only',
  calendar: 'events and expirations may be outdated',
  sheet: 'trades, P&L, positions and reconciliation are UNKNOWN or STALE',
};

/**
 * Rules that are unknown (including individual hold multipliers).
 * @param {RuleSet|null} rs
 * @returns {string[]}
 */
function unknownRules(rs) {
  /** @type {string[]} */
  const out = [];
  for (const k of RULE_KEYS) {
    const r = ruleValue(rs, k);
    if (!r.known) out.push(k);
    else if (k === 'hold_margin_multipliers') {
      const v = /** @type {Record<string, unknown>} */ (r.value);
      for (const h of HOLDS) if (!isNum(v[h])) out.push(`${k}.${h}`);
    }
  }
  return out;
}

/**
 * @param {VMInputs} inp
 * @param {Ctx} ctx
 * @param {AccountVM|null} account
 * @param {PositionsVM|null} positions
 * @returns {BannerVM[]}
 */
function buildBanners(inp, ctx, account, positions) {
  /** @type {BannerVM[]} */
  const out = [];

  // Flatten.
  // Unknown open positions are treated as open for the timing text, but the banner is never ok/flat.
  const positionsUnknown = ctx.open === null;
  const hasOpen = ctx.open !== null && ctx.open.length > 0;
  const fb = flattenBanner(ctx.now, ctx.rs, positionsUnknown ? true : hasOpen);
  if (positionsUnknown) {
    const why = ctx.trades === null ? 'open positions UNKNOWN (Sheet unavailable)' : ctx.openWhy;
    out.push({ level: 'unknown', kind: 'flatten', title: 'Flatten', message: `${fb.message} — ${why}`, details: [] });
  } else {
    out.push({ level: fb.level, kind: 'flatten', title: fb.level === 'breach' ? 'FLATTEN NOW' : 'Flatten', message: fb.message, details: [] });
  }

  // Expiry per open ∪ watched root (only when not ok; the calendar panel shows the rest).
  const cal = DISPLAYABLE.has(ctx.fr.calendar.state) ? calendarOf(ctx.envs.calendar) : null;
  for (const root of unionRoots(ctx)) {
    const b = expiryBanner(root, nextExpiration(root, ctx.today, ctx.contracts, cal ? cal.expirations : []), ctx.today, ctx.settings.expiry_warn_days);
    const isOpen = openKnownRows(ctx).some((t) => t.root === root);
    if (b.level !== 'ok') {
      out.push({ level: b.level, kind: 'expiry', title: `Expiry ${root}${isOpen ? ' (open position)' : ''}`, message: b.message, details: [] });
    }
  }

  // Limits (meters and position count) that need action.
  for (const m of account?.meters ?? []) {
    if (m.level === 'breach' || m.level === 'warn') {
      out.push({ level: m.level, kind: 'limit', title: m.label, message: `${m.pct_text} used — ${m.used_text} of ${m.limit_text}, ${m.remaining_text} left`, details: [] });
    }
  }
  if (positions && (positions.std_equiv.level === 'breach' || positions.std_equiv.level === 'warn')) {
    out.push({ level: positions.std_equiv.level, kind: 'limit', title: 'Contracts open', message: `${positions.std_equiv.text} standard-equivalent contracts`, details: [] });
  }
  for (const r of positions?.rows ?? []) {
    if (r.flags.length > 0) out.push({ level: 'breach', kind: 'limit', title: `Position ${r.id}`, message: r.flags.join('; '), details: [] });
  }

  // Data freshness.
  for (const name of [...DATASETS, /** @type {const} */ ('sheet')]) {
    const f = ctx.fr[name];
    if (f.state === 'fresh') continue;
    const age = f.age_min === null ? '' : ` (${fmtAge(f.age_min)} old)`;
    out.push({
      level: freshLevel(f.state),
      kind: 'data',
      title: `${name === 'sheet' ? 'Sheet' : name} ${f.state.toUpperCase()}`,
      message: `${f.reason}${age} — ${DATA_IMPACT[name]}`,
      details: [],
    });
  }
  if (inp.contracts === null) {
    out.push({ level: 'breach', kind: 'data', title: 'contracts.json UNAVAILABLE', message: `${inp.loadErrors?.contracts ?? 'failed to load'} — every root is UNKNOWN`, details: [] });
  }

  // Rules.
  if (inp.rules === null) {
    out.push({ level: 'warn', kind: 'rules', title: 'Rules UNAVAILABLE', message: `rules.json failed to load (${inp.loadErrors?.rules ?? 'invalid'}) — every rule is UNKNOWN`, details: [] });
  } else {
    const unk = unknownRules(ctx.rs);
    if (unk.length > 0) {
      out.push({ level: 'warn', kind: 'rules', title: `${unk.length} rules UNKNOWN`, message: `${unk.length} rules UNKNOWN — fill plan/RULES.md → rules.json`, details: unk });
    }
  }

  // Sheet row errors.
  const rowErrors = inp.sheet?.rowErrors ?? [];
  if (rowErrors.length > 0) {
    const tradeBad = ctx.tradeRowErrors.length > 0;
    const dailyBad = rowErrors.some((e) => e.startsWith(DAILY_ROW_PREFIX));
    const affected = [tradeBad ? "today's P&L and open positions" : '', dailyBad ? 'the drawdown peak' : ''].filter(Boolean);
    out.push({
      level: 'warn',
      kind: 'sheet',
      title: `Sheet: ${rowErrors.length} invalid row${rowErrors.length === 1 ? '' : 's'}`,
      message: affected.length > 0 ? `Fix these rows — ${affected.join(' and ')} ${affected.length > 1 || tradeBad ? 'are' : 'is'} UNKNOWN until then` : 'Fix these rows in the Sheet',
      details: rowErrors.slice(0, 8).concat(rowErrors.length > 8 ? [`…and ${rowErrors.length - 8} more`] : []),
    });
  }

  return out
    .map((b, i) => ({ b, i }))
    .sort((x, y) => LEVEL_RANK[x.b.level] - LEVEL_RANK[y.b.level] || x.i - y.i)
    .map((x) => x.b);
}

/**
 * Run a section builder; on failure record the error and return null (the renderer shows an error panel).
 * @template T
 * @param {Record<string, string>} errors
 * @param {string} name
 * @param {() => T} fn
 * @returns {T|null}
 */
function guard(errors, name, fn) {
  try {
    return fn();
  } catch (e) {
    errors[name] = errMsg(e);
    return null;
  }
}

/**
 * Build the whole view model. Throws only if the shared context (clock, freshness) cannot be built;
 * individual panels that fail are reported in `sectionErrors` and rendered as error panels.
 * @param {VMInputs} inputs
 * @returns {ViewModel}
 */
export function buildViewModel(inputs) {
  const ctx = buildCtx(inputs);
  /** @type {Record<string, string>} */
  const errors = {};
  const money = guard(errors, 'money', () => computeMoney(ctx));
  const account = money ? guard(errors, 'account', () => buildAccount(ctx, money)) : null;
  if (!money) errors.account = errors.money ?? 'unavailable';
  const positions = guard(errors, 'positions', () => buildPositions(ctx));
  const sizer = money ? guard(errors, 'sizer', () => buildSizer(ctx, money)) : null;
  if (!money) errors.sizer = errors.money ?? 'unavailable';
  const markets = guard(errors, 'markets', () => buildMarkets(ctx));
  const calendar = guard(errors, 'calendar', () => buildCalendar(ctx));
  const recon = guard(errors, 'recon', () => buildRecon(ctx));
  const banners = guard(errors, 'banners', () => buildBanners(inputs, ctx, account, positions)) ?? [];

  /** @type {Chip[]} */
  const chips = [...DATASETS, /** @type {const} */ ('sheet')].map((name) => {
    const f = ctx.fr[name];
    const env = name === 'sheet' ? null : ctx.envs[name];
    return {
      name,
      state: f.state,
      level: freshLevel(f.state),
      age_text: fmtAge(f.age_min),
      reason: f.reason,
      source: name === 'sheet' ? 'Google Sheet (Apps Script)' : env?.source ?? `data/${name}.json`,
    };
  });

  return {
    clock: {
      ct_text: ctClock(ctx.now),
      today: ctx.today,
      trade_date: ctx.td,
      loaded_text: inputs.loadedAtMs ? `loaded ${ctTime(inputs.loadedAtMs)}` : 'not loaded',
    },
    chips,
    banners,
    account,
    positions,
    sizer,
    markets,
    calendar,
    recon,
    settings: {
      sheet_url: inputs.settings.sheet_url,
      watched_roots_text: inputs.settings.watched_roots.join(', '),
      expiry_warn_days: inputs.settings.expiry_warn_days,
      sheet_configured: inputs.settings.sheet_url.trim() !== '',
    },
    rulesInfo: {
      unknown: guard(errors, 'rules', () => unknownRules(ctx.rs)) ?? [],
      source_doc: inputs.rules?.source_doc ?? 'plan/RULES.md',
      updated_at: inputs.rules?.updated_at ?? UNKNOWN_TEXT,
    },
    sectionErrors: errors,
  };
}
