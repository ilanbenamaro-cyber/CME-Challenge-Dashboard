/** @typedef {import('./types.mjs').Trade} Trade */
/** @typedef {import('./types.mjs').DailyRow} DailyRow */
/** @typedef {import('./types.mjs').ReconRow} ReconRow */
/** @typedef {import('./types.mjs').ContractsFile} ContractsFile */

import { resolveSpec } from './contracts.mjs';
import { tradePnlCents, usdToCents } from './money.mjs';
import { parseInstant, tradeDate } from './time.mjs';

/** Map key used for closed trades whose exit and entry times are both unparsable. */
export const UNKNOWN_DATE_KEY = 'unknown';

/** @param {unknown} e @returns {string} */
function errMessage(e) {
  return e instanceof Error ? e.message : String(e);
}

/**
 * Net P&L per CME trade date (tradeDate(exit_time)) for closed trades.
 * A trade that cannot be priced (unknown root, off-tick, bad time) contributes an error string to
 * its date and makes that date's total null.
 * A closed trade whose exit_time is missing or unparsable is attributed to tradeDate(entry_time)
 * (or to UNKNOWN_DATE_KEY if that is unparsable too) so the error stays visible.
 * Times must carry an explicit offset; offset-less strings are treated as unparsable.
 * @param {Trade[]} trades
 * @param {ContractsFile|null} contracts
 * @returns {Map<string, {net_cents: number|null, errors: string[]}>}
 */
export function dailyNetByTradeDate(trades, contracts) {
  /** @type {Map<string, {net_cents: number|null, errors: string[]}>} */
  const out = new Map();
  /**
   * @param {string} date
   * @returns {{net_cents: number|null, errors: string[]}}
   */
  const slot = (date) => {
    let s = out.get(date);
    if (!s) {
      s = { net_cents: 0, errors: [] };
      out.set(date, s);
    }
    return s;
  };

  for (const t of trades) {
    if (t.exit === null || t.exit === undefined) continue; // open trade
    const exitMs = parseInstant(t.exit_time);
    if (exitMs === null) {
      const entryMs = parseInstant(t.entry_time);
      const s = slot(entryMs === null ? UNKNOWN_DATE_KEY : tradeDate(entryMs));
      s.net_cents = null;
      s.errors.push(`trade ${t.id}: exit_time missing or unparsable (${String(t.exit_time)})`);
      continue;
    }
    const s = slot(tradeDate(exitMs));
    const spec = resolveSpec(t.root, contracts);
    if (!spec) {
      s.net_cents = null;
      s.errors.push(`trade ${t.id}: unknown root ${t.root}`);
      continue;
    }
    try {
      const pnl = tradePnlCents(t, spec);
      if (s.net_cents !== null) s.net_cents += pnl.net_cents;
    } catch (e) {
      s.net_cents = null;
      s.errors.push(`trade ${t.id}: ${errMessage(e)}`);
    }
  }
  return out;
}

/**
 * Reconciliation rows for the union of dates, sorted descending, at most `limit` rows.
 * A date with no closed trades has computed_cents 0. A reported row that is missing, null,
 * non-finite, or duplicated for its date gives reported_cents null (level unknown) with an error.
 * @param {Map<string, {net_cents: number|null, errors: string[]}>} computed
 * @param {DailyRow[]} reported
 * @param {number} limit
 * @returns {ReconRow[]}
 */
export function reconcile(computed, reported, limit) {
  /** @type {Map<string, DailyRow[]>} */
  const byDate = new Map();
  for (const r of Array.isArray(reported) ? reported : []) {
    if (!r || typeof r.date !== 'string') continue;
    const list = byDate.get(r.date) ?? [];
    list.push(r);
    byDate.set(r.date, list);
  }
  const dates = [...new Set([...computed.keys(), ...byDate.keys()])].sort((a, b) => (a < b ? 1 : a > b ? -1 : 0));
  const n = Number.isFinite(limit) ? Math.max(0, Math.floor(limit)) : 0;

  return dates.slice(0, n).map((date) => {
    const c = computed.get(date);
    /** @type {string[]} */
    const errors = c ? [...c.errors] : [];
    const computedCents = c ? c.net_cents : 0;
    if (date === UNKNOWN_DATE_KEY) errors.push('trade date unknown');

    /** @type {number|null} */
    let reportedCents = null;
    const rows = byDate.get(date) ?? [];
    if (rows.length === 0) {
      errors.push('no reported P&L for this date');
    } else if (rows.length > 1) {
      errors.push(`${rows.length} reported rows for this date`);
    } else {
      const v = rows[0]?.reported_pnl_usd;
      if (v === null || v === undefined) errors.push('reported P&L missing');
      else if (typeof v !== 'number' || !Number.isFinite(v)) errors.push(`reported P&L not a number: ${String(v)}`);
      else reportedCents = usdToCents(v);
    }
    if (computedCents === null && errors.length === 0) errors.push('computed P&L unknown');

    if (computedCents === null || reportedCents === null) {
      return { date, computed_cents: computedCents, reported_cents: reportedCents, diff_cents: null, level: 'unknown', errors };
    }
    const diff = computedCents - reportedCents;
    return {
      date,
      computed_cents: computedCents,
      reported_cents: reportedCents,
      diff_cents: diff,
      level: Math.abs(diff) <= 1 ? 'ok' : 'warn',
      errors,
    };
  });
}

/**
 * Contracts traded on CME trade date `date` (ADR-008): for every trade, its qty counts once if the entry falls on
 * that trade date and once more if the exit does (an entry or an exit each count toward the daily minimum).
 * Returns null if any entry_time / exit_time cannot be parsed (the count would be unreliable).
 * @param {Trade[]} trades
 * @param {string} date "YYYY-MM-DD"
 * @returns {number|null}
 */
export function contractsTradedOn(trades, date) {
  let n = 0;
  for (const t of trades) {
    const entryMs = parseInstant(t.entry_time);
    if (entryMs === null) return null;
    if (tradeDate(entryMs) === date) n += t.qty;
    if (t.exit_time !== null && t.exit_time !== undefined && t.exit_time !== '') {
      const exitMs = parseInstant(t.exit_time);
      if (exitMs === null) return null;
      if (tradeDate(exitMs) === date) n += t.qty;
    }
  }
  return n;
}
