// WP-UI view model: pure composition of core. No DOM, no fetch, no Date.now() (time comes from inputs.nowMs).
// Every displayable value carries its level/state; unknown values carry UNKNOWN_TEXT, never a number.

import { atr, lastClose } from '../core/atr.mjs';
import { contractsTradedOn, dailyNetByTradeDate, reconcile } from '../core/book.mjs';
import { dailyLossMeter, drawdownMeter, marginMeter, minContractsMeter, pctCapCents, WARN_RATIO } from '../core/compliance.mjs';
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
import { addDays, ctDate, ctParts, daysBetween, prevWeekday, tradeDate, weekdayOf } from '../core/time.mjs';

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
 * @property {string[]} [ruleErrors]              rules.json values of the wrong type (now null/UNKNOWN), from validateRulesFile
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
 * @property {boolean} [off]   dataset intentionally has no source (ADR-007): grey "OFF", never amber
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
 * Display level: a core Level, or 'na' for "not a rule in this challenge" (ADR-008; neutral, never UNKNOWN).
 * @typedef {Level|'na'} UiLevel
 */

/**
 * @typedef {object} MeterVM
 * @property {string} key
 * @property {string} label
 * @property {UiLevel} level
 * @property {string} pct_text     ratio ("42%"), or "traded / required" for the contracts meter
 * @property {number|null} fill   0..100 in steps of 5, null when unknown / not applicable
 * @property {string} used_text
 * @property {string} limit_text
 * @property {string} remaining_text
 * @property {{used: string, limit: string, left: string}} labels  captions of the three numbers
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
 * @property {string} contract_text  exact contract held (e.g. "HOZ26"), or "<root> ?" when the row has none
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
 * @property {string} std_label    caption of std_equiv ("Standard-equivalent open / max", or "Contracts open" without a cap)
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
 * @property {string} fee_note        set when the fee was defaulted from the commission rule
 * @property {string} fee_placeholder placeholder of the (blank) fee field
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
 * @property {{unknown: string[], na: string[], source_doc: string, updated_at: string}} rulesInfo
 * @property {Record<string, string>} sectionErrors  section name -> error text when that section failed to build
 */

/** @type {DatasetName[]} */
const DATASETS = ['bars', 'settlements', 'margins', 'challenge', 'calendar'];

/** @type {(keyof RuleSet)[]} */
export const RULE_KEYS = [
  'starting_balance_usd', 'daily_loss_cap_usd', 'max_drawdown_usd', 'max_contracts', 'micro_to_standard_ratio',
  'flatten_time_ct', 'hold_margin_multipliers', 'margin_basis', 'allowed_roots', 'challenge_start_date',
  'challenge_end_date', 'daily_loss_cap_pct', 'flatten_dates', 'min_contracts_per_day', 'commission_per_side_usd',
];

/**
 * Optional keys (ADR-008). Absent from a rules file = not part of that rule set: not UNKNOWN, no panel.
 * Present with a null value (and not applies:false) = UNKNOWN like any other rule.
 * @type {Set<keyof RuleSet>}
 */
const OPTIONAL_RULE_KEYS = new Set(/** @type {(keyof RuleSet)[]} */ (['daily_loss_cap_pct', 'flatten_dates', 'min_contracts_per_day', 'commission_per_side_usd']));

/**
 * True if the rule set has an entry for `key` (an optional key may be absent).
 * @param {RuleSet|null} rs
 * @param {keyof RuleSet} key
 * @returns {boolean}
 */
function hasRule(rs, key) {
  return rs !== null && typeof rs === 'object' && Object.prototype.hasOwnProperty.call(rs, key);
}

/** Penalty text for missing the daily contract minimum (RULES.md p9/p10; quoted in rules.json min_contracts_per_day.source). */
const MIN_CONTRACTS_PENALTY = '$1,000 penalty';

/** CT hour from which a shortfall against the daily contract minimum raises an amber banner. */
export const MIN_CONTRACTS_WARN_HOUR_CT = 14;

/** Sheet data counts as fresh for this long after a successful fetch. */
export const SHEET_FRESH_MIN = 15;

/** @type {Hold[]} */
const HOLDS = ['intraday', 'overnight', 'weekend'];

const LEVEL_RANK = { breach: 0, warn: 1, unknown: 2, ok: 3 };

/** Error text a job writes when its source is intentionally unset (jobs/config/sources.json, ADR-007). */
export const SOURCE_OFF_PREFIX = 'source not configured';

/**
 * True when an envelope's only problem is that its source is intentionally switched off: shown as a calm grey
 * "OFF" (still UNKNOWN data), not as an amber failure that trains the user to ignore banners.
 * @param {AnyEnvelope|null|undefined} env
 * @returns {boolean}
 */
export function isSourceOff(env) {
  return !!env && env.status === 'error' && Array.isArray(env.errors) && env.errors.length > 0
    && env.errors.every((/** @type {unknown} */ e) => typeof e === 'string' && e.startsWith(SOURCE_OFF_PREFIX));
}

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
  if (openKnownRows(ctx).length === 0) return inputsBadge(ctx, ['sheet']);
  const parts = [inputsBadge(ctx, ['sheet']), openMarksBadge(ctx) ?? inputsBadge(ctx, ['bars'])].filter(Boolean);
  return parts.length > 0 ? parts.join(' · ') : null;
}

/**
 * Badge of the oldest non-fresh position mark ("bars STALE 8h 12m"), or null when every open position is marked
 * from fresh bars. Uses each mark's own freshness (series and envelope), so a fresh envelope with one stale
 * contract series still shows the age.
 * @param {Ctx} ctx
 * @returns {string|null}
 */
function openMarksBadge(ctx) {
  /** @type {Freshness|null} */
  let worst = null;
  for (const t of ctx.open ?? []) {
    const m = positionMark(ctx, t);
    if (m.price === null || m.fr.state === 'fresh') continue;
    if (worst === null || (m.fr.age_min ?? 0) > (worst.age_min ?? 0)) worst = m.fr;
  }
  const b = worst ? staleBadge(worst) : null;
  return b ? `bars ${b}` : null;
}

/** States whose `data` may be displayed (with a badge when not fresh). */
const DISPLAYABLE = new Set(['fresh', 'partial', 'stale', 'error']);

// ---------------------------------------------------------------------------------------------
// Defensive readers for envelope data (the files are bot-written but the site must not crash on them).

/**
 * Well-formed bars of one series entry ({bars: [...]}), sorted ascending by t; null if none.
 * @param {unknown} entry
 * @returns {Bar[]|null}
 */
function seriesBars(entry) {
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
 * Front-month continuous bars for a bars-root (Markets panel only; never used to mark a position).
 * @param {AnyEnvelope|null} env
 * @param {string} barsRoot
 * @returns {Bar[]|null} null if the envelope has no bars for this root
 */
function barsOf(env, barsRoot) {
  const d = env?.data;
  if (!isObj(d) || !isObj(d.roots)) return null;
  return seriesBars(d.roots[barsRoot]);
}

/**
 * One exact contract's series from bars.data.contracts (ADR-010), or null when absent or malformed.
 * The series' root must be the expected bars root (a mislabelled series is not used).
 * @param {AnyEnvelope|null} env
 * @param {string} code      contract code, e.g. "HOZ26"
 * @param {string} barsRoot  expected series root (parent for micros)
 * @returns {{bars: Bar[], raw_symbol: string}|null}
 */
function contractSeriesOf(env, code, barsRoot) {
  const d = env?.data;
  if (!isObj(d) || !isObj(d.contracts)) return null;
  const entry = d.contracts[code];
  if (!isObj(entry) || entry.root !== barsRoot) return null;
  const bars = seriesBars(entry);
  if (!bars) return null;
  return { bars, raw_symbol: typeof entry.raw_symbol === 'string' ? entry.raw_symbol : '' };
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

/** Label for a front-month last price (Markets panel; positions are marked by exact contract, ADR-010). */
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
 * @typedef {object} Mark
 * @property {number|null} price
 * @property {boolean} usable      true only when the price may be used for open P&L
 * @property {Bar[]|null} bars
 * @property {ContractSpec|null} spec
 * @property {string} reason       why the mark is not usable ('' when usable)
 * @property {Freshness} fr        freshness the mark is shown with
 * @property {string} label        what the price is, e.g. "HOZ26 (HOZ6) bar close" or "ES.c.0 front-month continuous (.c.0)"
 * @property {boolean} exact       true for an exact-contract mark (ADR-010)
 */

/**
 * Mark from one bars series. Usable only if both the envelope and the series itself are fresh (or the
 * envelope partial).
 * @param {Ctx} ctx
 * @param {ContractSpec} spec
 * @param {Bar[]} bars  non-empty, ascending
 * @param {string} name  series name for reasons, e.g. "HOZ26" or "ES"
 * @param {string} label
 * @param {boolean} exact
 * @returns {Mark}
 */
function seriesMark(ctx, spec, bars, name, label, exact) {
  const f = ctx.fr.bars;
  const last = /** @type {Bar} */ (bars[bars.length - 1]);
  const price = lastClose(bars);
  const rf = rootFreshness(ctx, last);
  if (rf.state !== 'fresh') {
    // The series itself is older than the policy: show the worse (older) of the two ages.
    const worse = (f.state === 'stale' || f.state === 'error') && (f.age_min ?? -1) >= (rf.age_min ?? -1) ? f : { ...rf, state: /** @type {FreshState} */ ('stale') };
    return { price, usable: false, bars, spec, reason: `${name} bars ${worse.state.toUpperCase()} (last bar closed ${fmtAge(rf.age_min)} ago) — open P&L not marked`, fr: worse, label, exact };
  }
  const usable = f.state === 'fresh' || f.state === 'partial';
  return { price, usable, bars, spec, reason: usable ? '' : `bars ${f.state.toUpperCase()} — open P&L not marked`, fr: f, label, exact };
}

/**
 * Front-month continuous last price for a root (Markets panel and ATR only). Never marks a position (ADR-010).
 * @param {Ctx} ctx
 * @param {string} root
 * @returns {Mark}
 */
function markFor(ctx, root) {
  const f = ctx.fr.bars;
  const spec = resolveSpec(root, ctx.contracts);
  if (!spec) return { price: null, usable: false, bars: null, spec: null, reason: `${root} not in contracts.json`, fr: f, label: CONT_LABEL, exact: false };
  const br = barsRootFor(root, ctx.contracts);
  const label = br ? `${br}.c.0 ${CONT_LABEL}` : CONT_LABEL;
  if (!br || !DISPLAYABLE.has(f.state)) return { price: null, usable: false, bars: null, spec, reason: `bars ${f.state.toUpperCase()}`, fr: f, label, exact: false };
  const bars = barsOf(ctx.envs.bars, br);
  if (!bars) return { price: null, usable: false, bars: null, spec, reason: `no bars for ${br}`, fr: f, label, exact: false };
  return seriesMark(ctx, spec, bars, br, label, false);
}

/** Months of each root the bars job publishes exact-contract series for (ADR-010: <ROOT>.c.0..c.2). */
const CONTRACT_MONTHS_NOTE = 'bars cover the first 3 listed months';

/**
 * Bars contract code for a trade's contract: micros use their parent's contract (MESZ26 -> ESZ26).
 * @param {string} contract  e.g. "MESZ26"
 * @param {string} root      the trade's root, e.g. "MES"
 * @param {string} barsRoot  e.g. "ES"
 * @returns {string}
 */
export function barsContractCode(contract, root, barsRoot) {
  return contract.startsWith(root) ? `${barsRoot}${contract.slice(root.length)}` : contract;
}

/**
 * Mark for an open position from its own contract's bars only (ADR-010). No contract or no series -> UNKNOWN;
 * never the front month.
 * @param {Ctx} ctx
 * @param {Trade} t
 * @returns {Mark}
 */
function positionMark(ctx, t) {
  const f = ctx.fr.bars;
  const spec = resolveSpec(t.root, ctx.contracts);
  const contract = t.contract ?? null;
  const label = contract ?? `${t.root} (contract not set)`;
  if (!spec) return { price: null, usable: false, bars: null, spec: null, reason: `${t.root} not in contracts.json`, fr: f, label, exact: true };
  if (contract === null) {
    return { price: null, usable: false, bars: null, spec, reason: `contract not set — add the contract (e.g. ${t.root}Z26) to this Trades row`, fr: f, label, exact: true };
  }
  const br = barsRootFor(t.root, ctx.contracts) ?? t.root;
  const code = barsContractCode(contract, t.root, br);
  if (!DISPLAYABLE.has(f.state)) return { price: null, usable: false, bars: null, spec, reason: `bars ${f.state.toUpperCase()}`, fr: f, label, exact: true };
  const series = contractSeriesOf(ctx.envs.bars, code, br);
  if (!series) {
    const via = code === contract ? '' : `, which ${contract} is marked with`;
    return { price: null, usable: false, bars: null, spec, reason: `no bars for ${code}${via} (${CONTRACT_MONTHS_NOTE})`, fr: f, label, exact: true };
  }
  const desc = `${code}${series.raw_symbol ? ` (${series.raw_symbol})` : ''} bar close`;
  return seriesMark(ctx, spec, series.bars, code, code === contract ? desc : `${contract} via ${desc}`, true);
}

/**
 * Mark cell (price + STALE badge when the bars are stale).
 * @param {Ctx} ctx
 * @param {Mark} m
 * @returns {Cell}
 */
function markCell(ctx, m) {
  if (m.price === null || !m.spec) return unknownCell(m.reason);
  const last = m.bars?.[m.bars.length - 1];
  const when = last ? `${last.t.slice(0, 16).replace('T', ' ')}Z` : '';
  return cell({
    text: fmtPrice(m.price, m.spec.tick_size),
    known: true,
    badge: staleBadge(m.fr),
    level: m.usable ? null : 'warn',
    note: m.exact
      ? `${m.label}${when ? ` · last 1h bar ${when}` : ''}`
      : when ? `last 1h close, bar ${when} · ${m.label}` : m.label,
  });
}

/**
 * Open P&L of one open trade in cents (net of the row's fees, as for closed trades), or null with a reason.
 * Ilan's decision B (2026-10-05): a stale mark (delayed Databento data) still prices the position; the value
 * carries a STALE badge with its age everywhere it flows (positions, open P&L, equity, meters). Only a missing or
 * unusable mark (no series, invalid data, no contract) gives UNKNOWN.
 * @param {Ctx} ctx
 * @param {Trade} t
 * @returns {{cents: number|null, reason: string, mark: Mark}}
 */
function openPnl(ctx, t) {
  const m = positionMark(ctx, t);
  if (!m.spec) return { cents: null, reason: m.reason, mark: m };
  if (m.price === null) return { cents: null, reason: m.reason || 'no mark', mark: m };
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
  const sheetWhyText = sheetWhy(ctx);
  // Realized today + all closed trades.
  let realized = /** @type {number|null} */ (null);
  let realizedReason = '';
  let closedTotal = /** @type {number|null} */ (null);
  let closedReason = '';
  if (ctx.trades === null) {
    realizedReason = closedReason = sheetWhyText;
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
  else if (daily === null) peakReason = `peak UNKNOWN: ${sheetWhyText}`;
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
    labels: USD_LABELS,
    note: m.level === 'unknown' && m.reason ? `${note}${note ? ' · ' : ''}${m.reason}` : note,
    badge,
  };
}

const USD_LABELS = { used: 'used', limit: 'limit', left: 'left' };

/**
 * A meter for a rule that is not part of this challenge (ADR-008): neutral, no numbers, never UNKNOWN.
 * @param {string} key
 * @param {string} label
 * @param {string} note
 * @returns {MeterVM}
 */
function naMeter(key, label, note) {
  return { key, label, level: 'na', pct_text: 'n/a', fill: null, used_text: '', limit_text: '', remaining_text: '', labels: USD_LABELS, note, badge: null };
}

/**
 * Why Sheet-derived values are unavailable.
 * @param {Ctx} ctx
 * @returns {string}
 */
function sheetWhy(ctx) {
  return ctx.fr.sheet.state === 'missing' ? 'Sheet not loaded' : `Sheet ${ctx.fr.sheet.state}: ${ctx.fr.sheet.reason}`;
}

/**
 * First CME trade date of the challenge: challenge_start_date rolled forward off a weekend (a Sunday-evening
 * start belongs to Monday's trade date). null if the rule is unknown or malformed.
 * @param {RuleSet|null} rs
 * @returns {string|null}
 */
function firstTradeDate(rs) {
  const r = ruleValue(rs, 'challenge_start_date');
  if (!r.known || typeof r.value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(r.value)) return null;
  try {
    let d = r.value;
    while (weekdayOf(d) === 0 || weekdayOf(d) === 6) d = addDays(d, 1);
    return d;
  } catch {
    return null;
  }
}

/**
 * True if trade date `td` lies inside the challenge window (first trade date .. challenge_end_date).
 * false when either end is unknown.
 * @param {Ctx} ctx
 * @returns {boolean}
 */
function inChallengeWindow(ctx) {
  const first = firstTradeDate(ctx.rs);
  const end = ruleValue(ctx.rs, 'challenge_end_date');
  return first !== null && end.known && typeof end.value === 'string' && ctx.td >= first && ctx.td <= end.value;
}

/**
 * Base of the percentage daily-loss cap (ADR-008): the prior trade date's closing balance from the Sheet Daily tab
 * (latest row dated before today's trade date, and on/after the first trade date, with a reported balance).
 * No such row -> the starting balance (balances reset before the live competition). UNKNOWN when the Sheet is not loaded, a Daily row was rejected, or the prior close is missing.
 * @param {Ctx} ctx
 * @returns {{cents: number|null, text: string, reason: string}}
 */
function priorCloseBase(ctx) {
  const data = ctx.sheet?.data ?? null;
  if (data === null) return { cents: null, text: '', reason: sheetWhy(ctx) };
  const dailyBad = (ctx.sheet?.rowErrors ?? []).filter((e) => e.startsWith(DAILY_ROW_PREFIX)).length;
  if (dailyBad > 0) return { cents: null, text: '', reason: `${dailyBad} invalid Daily row${dailyBad === 1 ? '' : 's'} in the Sheet` };
  // RULES p6: balances reset before the live competition, so practice-period rows never set the base.
  const firstTd = firstTradeDate(ctx.rs);
  const prior = data.daily
    .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d.date) && d.date < ctx.td && (firstTd === null || d.date >= firstTd))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  if (prior.length === 0) {
    const sb = ruleValue(ctx.rs, 'starting_balance_usd');
    if (!sb.known) return { cents: null, text: '', reason: 'no Daily close yet and starting_balance_usd rule UNKNOWN' };
    const cents = usdToCents(sb.value);
    return { cents, text: `${fmtUsd(cents)} (starting balance; no Daily close yet)`, reason: '' };
  }
  const withBal = prior.filter((d) => isNum(d.reported_balance_usd));
  const last = withBal[withBal.length - 1];
  if (!last) {
    const latest = prior[prior.length - 1];
    return { cents: null, text: '', reason: `Daily close for ${latest ? latest.date : '?'} has no reported balance` };
  }
  const expected = prevWeekday(ctx.td);
  const first = firstTradeDate(ctx.rs);
  // Unknown start date: check anyway (a missing close shows UNKNOWN rather than an old balance).
  if (last.date < expected && (first === null || ctx.td > first)) {
    return { cents: null, text: '', reason: `Daily close for ${expected} missing` };
  }
  const cents = usdToCents(/** @type {number} */ (last.reported_balance_usd));
  return { cents, text: `prior close ${fmtUsd(cents)}`, reason: '' };
}

/**
 * The daily-loss cap the meter uses: the fixed-dollar rule, or (when that rule does not apply) the percentage rule
 * on the prior close. `override` is passed to core dailyLossMeter (undefined = use daily_loss_cap_usd).
 * @param {Ctx} ctx
 * @returns {{na: boolean, override: number|null|undefined, label: string, note: string, reason: string}}
 */
function dailyLossCap(ctx) {
  const assume = 'assumes loss = −(realized today + open P&L since entry)';
  const usd = ruleValue(ctx.rs, 'daily_loss_cap_usd');
  if (usd.known || !usd.na) {
    return { na: false, override: undefined, label: 'Daily loss vs cap', note: `${assume}; confirm against RULES.md`, reason: '' };
  }
  const pct = ruleValue(ctx.rs, 'daily_loss_cap_pct');
  if (!pct.known && pct.na) return { na: true, override: undefined, label: 'Daily loss', note: 'No daily loss rule in this challenge', reason: '' };
  if (!pct.known) return { na: false, override: null, label: 'Daily loss vs % lock', note: assume, reason: `daily loss cap UNKNOWN: ${pct.reason}` };
  const pctText = `${Number((pct.value * 100).toFixed(4))}%`;
  const label = `Daily loss vs ${pctText} lock`;
  const base = priorCloseBase(ctx);
  if (base.cents === null) return { na: false, override: null, label, note: assume, reason: `cap base UNKNOWN: ${base.reason}` };
  const cap = pctCapCents(ctx.rs, base.cents);
  if (cap === null) return { na: false, override: null, label, note: assume, reason: `cap UNKNOWN: ${pctText} of ${base.text} is not a positive amount` };
  return { na: false, override: cap, label, note: `${pctText} of ${base.text} = cap ${fmtUsd(cap)} · ${assume}`, reason: '' };
}

/**
 * Contracts traded today vs the daily minimum (ADR-008). null when the rule set has no min_contracts_per_day entry.
 * @param {Ctx} ctx
 * @returns {{vm: MeterVM, traded: number|null, required: number|null, remaining: number|null}|null}
 */
function contractsToday(ctx) {
  if (!hasRule(ctx.rs, 'min_contracts_per_day')) return null;
  /** @type {number|null} */
  let traded = null;
  let why = '';
  if (ctx.trades === null) why = sheetWhy(ctx);
  else if (ctx.tradeRowErrors.length > 0) {
    const n = ctx.tradeRowErrors.length;
    why = `${n} invalid Trades row${n === 1 ? '' : 's'} in the Sheet`;
  } else {
    traded = contractsTradedOn(ctx.trades, ctx.td);
    if (traded === null) why = 'a trade time cannot be parsed';
  }
  const m = minContractsMeter(traded, ctx.rs);
  const label = 'Contracts traded today';
  if (m.level === 'na') return { vm: naMeter('min_contracts', label, 'No daily contract minimum in this challenge'), traded: null, required: null, remaining: null };
  const t = m.traded;
  const req = m.required;
  const known = m.level !== 'unknown' && t !== null && req !== null;
  const ratio = known && t !== null && req !== null ? (req > 0 ? t / req : 1) : null;
  let note = '';
  if (m.level === 'unknown') note = why || m.reason;
  else if (m.level === 'warn') note = `${m.remaining} more needed — ${MIN_CONTRACTS_PENALTY} if under ${req} by the close`;
  else note = `daily minimum of ${req} met`;
  note += ` · entries + exits on trade date ${ctx.td}`;
  return {
    vm: {
      key: 'min_contracts',
      label,
      level: m.level,
      pct_text: known ? `${t} / ${req}` : UNKNOWN_TEXT,
      fill: ratio === null ? null : Math.min(100, Math.max(0, Math.round((ratio * 100) / 5) * 5)),
      used_text: t === null || m.level === 'unknown' ? UNKNOWN_TEXT : String(t),
      limit_text: req === null ? UNKNOWN_TEXT : String(req),
      remaining_text: m.remaining === null ? UNKNOWN_TEXT : String(m.remaining),
      labels: { used: 'traded', limit: 'minimum', left: 'needed' },
      note,
      badge: inputsBadge(ctx, ['sheet']),
    },
    traded: known ? t : null,
    required: req,
    remaining: m.remaining,
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
  const open = usdCell(money.open, money.open === null ? money.openReason : ctx.open && ctx.open.length > 0 ? 'each position marked at the last 1h close of its own contract' : 'flat');
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

  const capInfo = dailyLossCap(ctx);
  /** @type {Meter} */
  let loss;
  if (money.realized === null) {
    loss = dailyLossMeter(0, null, ctx.rs, capInfo.override);
    const why = [`today's realized P&L UNKNOWN (${money.realizedReason})`];
    if (capInfo.reason) why.push(capInfo.reason);
    loss = { ...loss, level: 'unknown', used_cents: null, used_ratio: null, remaining_cents: null, reason: why.join('; ') };
  } else {
    loss = dailyLossMeter(money.realized, money.open, ctx.rs, capInfo.override);
    if (loss.level === 'unknown') {
      /** @type {string[]} */
      const why = [];
      if (money.open === null) why.push(`open P&L UNKNOWN (${money.openReason})`);
      if (capInfo.reason) why.push(capInfo.reason);
      if (why.length > 0) loss = { ...loss, reason: why.join('; ') };
    }
  }
  const lossVM = capInfo.na ? naMeter('daily_loss', capInfo.label, capInfo.note) : meterVM(loss, 'daily_loss', capInfo.label, capInfo.note, acctBadge);
  const ddRule = ruleValue(ctx.rs, 'max_drawdown_usd');
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
  const ct = contractsToday(ctx);
  return {
    realized,
    open,
    equity,
    peak,
    margin_used: marginUsed,
    trade_date: ctx.td,
    meters: [
      lossVM,
      !ddRule.known && ddRule.na
        ? naMeter('drawdown', 'Drawdown', 'No drawdown rule in this challenge')
        : meterVM(dd, 'drawdown', 'Drawdown vs max', 'assumes EOD trailing: peak = max(start, EOD balances)', acctBadge),
      meterVM(mm, 'margin', 'Margin in use vs equity', `${ctx.form.hold} hold multiplier`, acctBadge),
      ...(ct ? [ct.vm] : []),
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
  // ADR-008: no contract-count rule -> show the open contract count, never "/ UNKNOWN".
  const noCap = !maxRule.known && maxRule.na;
  const stdLabel = noCap ? 'Contracts open' : 'Standard-equivalent open / max';
  if (ctx.open === null) {
    const why = ctx.trades === null ? ctx.fr.sheet.reason : ctx.openWhy;
    return { known: false, reason: `Positions UNKNOWN — ${why}`, rows: [], std_label: stdLabel, std_equiv: unknownCell(why), badge: null };
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
      contract_text: t.contract ?? `${t.root} ?`,
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
  if (noCap) {
    const count = ctx.open.reduce((n, t) => n + t.qty, 0);
    std = cell({ text: `${count} contract${count === 1 ? '' : 's'}`, known: true, level: null, note: 'no contract cap (margin-limited)' });
  } else if (se === null) {
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
  return { known: true, reason: rows.length === 0 ? 'Flat — no open positions in the Sheet' : '', rows, std_label: stdLabel, std_equiv: std, badge };
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

  // ADR-008: a blank fee defaults to the round trip of the challenge commission (2 sides).
  const commission = ruleValue(ctx.rs, 'commission_per_side_usd');
  const sideCents = commission.known && isNum(commission.value) && commission.value >= 0 ? usdToCents(commission.value) : null;
  let fee = f.fee_per_contract_usd;
  let feeNote = '';
  if (fee === null && sideCents !== null) {
    fee = (2 * sideCents) / 100;
    feeNote = `fee defaulted from ${fmtUsd(sideCents)}/side commission (${fmtUsd(2 * sideCents)} round trip)`;
  }
  const feePlaceholder = sideCents === null ? '0 if none' : `${(2 * sideCents) / 100} (2 × commission)`;
  const maxRule = ruleValue(ctx.rs, 'max_contracts');
  const maxNA = !maxRule.known && maxRule.na;
  const MAX_NA_TEXT = 'n/a (margin-limited)';

  const base = {
    form: f,
    roots,
    per_contract_risk_text: UNKNOWN_TEXT,
    margin,
    available,
    multiplier_text: mult === null ? UNKNOWN_TEXT : `×${mult}`,
    atr: atrCell(ctx, f.root),
    warnings,
    fee_note: feeNote,
    fee_placeholder: feePlaceholder,
    badge,
  };
  /** @type {string[]} */
  const inputProblems = [];
  if (!spec) inputProblems.push(`${f.root} not in contracts.json`);
  if (!isNum(f.risk_budget_usd) || f.risk_budget_usd < 0) inputProblems.push('enter a risk budget (USD, ≥ 0)');
  if (!isNum(f.stop_ticks) || !Number.isInteger(f.stop_ticks) || f.stop_ticks <= 0) inputProblems.push('enter the stop distance in whole ticks (> 0)');
  if (!isNum(fee) || fee < 0) inputProblems.push('enter the round-turn fee per contract (USD, 0 if none)');
  if (!ctx.rs) inputProblems.push('rules.json unavailable');
  const unknownLimits = [
    { key: /** @type {const} */ ('risk'), label: 'Risk', text: UNKNOWN_TEXT, binding: false },
    { key: /** @type {const} */ ('margin'), label: 'Margin', text: UNKNOWN_TEXT, binding: false },
    { key: /** @type {const} */ ('max_contracts'), label: 'Max contracts', text: maxNA ? MAX_NA_TEXT : UNKNOWN_TEXT, binding: false },
  ];
  if (inputProblems.length > 0 || !spec || !ctx.rs) {
    return { ...base, status: 'unknown', level: 'unknown', contracts_text: UNKNOWN_TEXT, binding_text: '', limits: unknownLimits, reasons: inputProblems };
  }
  const res = sizePosition({
    spec,
    risk_budget_usd: /** @type {number} */ (f.risk_budget_usd),
    stop_ticks: /** @type {number} */ (f.stop_ticks),
    fee_per_contract_usd: /** @type {number} */ (fee),
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
      text: key === 'max_contracts' && maxNA ? MAX_NA_TEXT : v === null ? UNKNOWN_TEXT : String(v),
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

const MONTH_CODES = 'FGHJKMNQUVXZ';

/**
 * Sort key of a contract code such as "ESZ26": [year*12 + month, code]. Codes that do not end in a month
 * letter and a 1–2 digit year sort after all parsable ones, then by text.
 * @param {string} code
 * @returns {number}
 */
function contractOrdinal(code) {
  const m = /([FGHJKMNQUVXZ])(\d{1,2})$/.exec(code);
  if (!m || !m[1] || !m[2]) return Number.POSITIVE_INFINITY;
  return Number(m[2]) * 12 + MONTH_CODES.indexOf(m[1]);
}

/**
 * Total order for settlement rows: root ascending, then trade_date descending (latest first), then
 * contract month ascending (front month first), then contract_code text. Returns 0 only on ties of all keys.
 * @param {{root: string, contract_code: string, trade_date: string}} a
 * @param {{root: string, contract_code: string, trade_date: string}} b
 * @returns {number}
 */
export function compareSettleRows(a, b) {
  if (a.root !== b.root) return a.root < b.root ? -1 : 1;
  if (a.trade_date !== b.trade_date) return a.trade_date > b.trade_date ? -1 : 1;
  const oa = contractOrdinal(a.contract_code);
  const ob = contractOrdinal(b.contract_code);
  if (oa !== ob) return oa < ob ? -1 : 1;
  if (a.contract_code !== b.contract_code) return a.contract_code < b.contract_code ? -1 : 1;
  return 0;
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
    const rows = settle.filter((r) => r.root === root).sort(compareSettleRows);
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
 * Rules that are unknown (including individual hold multipliers). Not-applicable rules (applies:false) and
 * optional keys absent from the file are not unknown.
 * @param {RuleSet|null} rs
 * @returns {string[]}
 */
function unknownRules(rs) {
  /** @type {string[]} */
  const out = [];
  for (const k of RULE_KEYS) {
    if (OPTIONAL_RULE_KEYS.has(k) && !hasRule(rs, k)) continue;
    const r = ruleValue(rs, k);
    if (!r.known) {
      if (!r.na) out.push(k);
    }
    else if (k === 'hold_margin_multipliers') {
      const v = /** @type {Record<string, unknown>} */ (r.value);
      for (const h of HOLDS) if (!isNum(v[h])) out.push(`${k}.${h}`);
    }
  }
  return out;
}

/**
 * Rules marked applies:false ("not a rule in this challenge").
 * @param {RuleSet|null} rs
 * @returns {string[]}
 */
function naRules(rs) {
  return RULE_KEYS.filter((k) => {
    const r = ruleValue(rs, k);
    return !r.known && r.na;
  });
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
  const fd = ruleValue(ctx.rs, 'flatten_dates');
  // ADR-008: not a flatten day -> a calm info line, whatever the positions (they do not matter today).
  const noFlattenToday = fb.level === 'ok' && fb.value === null && fd.known && Array.isArray(fd.value) && !fd.value.includes(ctx.td);
  if (noFlattenToday) {
    out.push({ level: 'ok', kind: 'flatten', title: 'Flatten', message: fb.message, details: [] });
  } else if (positionsUnknown) {
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
    if (m.key === 'min_contracts') continue; // own, time-gated banner below
    if (m.level === 'breach' || m.level === 'warn') {
      out.push({ level: m.level, kind: 'limit', title: m.label, message: `${m.pct_text} used — ${m.used_text} of ${m.limit_text}, ${m.remaining_text} left`, details: [] });
    }
  }
  // Daily contract minimum: amber once the afternoon is under way on a challenge trade date (ADR-008).
  const ct = account?.meters.find((m) => m.key === 'min_contracts');
  if (ct && ct.level === 'warn' && ctx.today === ctx.td && ctParts(ctx.now).hour >= MIN_CONTRACTS_WARN_HOUR_CT && inChallengeWindow(ctx)) {
    out.push({
      level: 'warn',
      kind: 'limit',
      title: 'Contracts traded today',
      message: `${ct.pct_text} traded — ${ct.remaining_text} more needed; ${MIN_CONTRACTS_PENALTY} if under ${ct.limit_text} by the close`,
      details: [],
    });
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
    if (name !== 'sheet' && isSourceOff(ctx.envs[name])) {
      out.push({ level: 'unknown', kind: 'data', title: `${name} OFF`, message: `no permitted automated source (ADR-007) — ${DATA_IMPACT[name]}`, details: [] });
      continue;
    }
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
    const bad = inp.ruleErrors ?? [];
    if (bad.length > 0) {
      out.push({
        level: 'warn',
        kind: 'rules',
        title: `rules.json: ${bad.length} invalid value${bad.length === 1 ? '' : 's'}`,
        message: 'Wrongly typed values are treated as UNKNOWN, never coerced — fix docs/data/rules.json',
        details: bad.slice(0, 8).concat(bad.length > 8 ? [`…and ${bad.length - 8} more`] : []),
      });
    }
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
    const off = name !== 'sheet' && isSourceOff(env);
    return {
      name,
      state: f.state,
      off,
      level: off ? 'unknown' : freshLevel(f.state),
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
      na: guard(errors, 'rules', () => naRules(ctx.rs)) ?? [],
      source_doc: inputs.rules?.source_doc ?? 'plan/RULES.md',
      updated_at: inputs.rules?.updated_at ?? UNKNOWN_TEXT,
    },
    sectionErrors: errors,
  };
}
