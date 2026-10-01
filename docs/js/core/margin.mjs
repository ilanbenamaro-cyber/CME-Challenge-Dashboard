/** @typedef {import('./types.mjs').MarginRow} MarginRow */

/**
 * @param {MarginRow[]|null} rows
 * @param {string} root
 * @param {'initial'|'maintenance'} basis
 * @returns {number|null}
 */
function valueFor(rows, root, basis) {
  if (!Array.isArray(rows)) return null;
  const row = rows.find((r) => r && r.root === root);
  if (!row) return null;
  const v = basis === 'initial' ? row.initial_usd : row.maintenance_usd;
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/**
 * Pick the margin per contract for `root` on `basis`.
 * Prefer the CME row when `cmeFresh` is true and its value on `basis` is non-null; otherwise the
 * Sheet override row; otherwise unknown. Never aliases micros to parents.
 * @param {string} root
 * @param {'initial'|'maintenance'|null} basis
 * @param {MarginRow[]|null} cmeRows
 * @param {boolean} cmeFresh
 * @param {MarginRow[]|null} sheetRows
 * @returns {{value_usd: number|null, source: 'cme'|'sheet'|null, reason: string}}
 */
export function resolveMargin(root, basis, cmeRows, cmeFresh, sheetRows) {
  if (basis !== 'initial' && basis !== 'maintenance') {
    return { value_usd: null, source: null, reason: 'margin basis rule unknown' };
  }
  if (cmeFresh) {
    const v = valueFor(cmeRows, root, basis);
    if (v !== null) return { value_usd: v, source: 'cme', reason: `CME ${basis} margin` };
  }
  const s = valueFor(sheetRows, root, basis);
  if (s !== null) {
    const why = cmeFresh ? `no CME ${basis} margin for ${root}` : 'CME margins not fresh';
    return { value_usd: s, source: 'sheet', reason: `Sheet override (${why})` };
  }
  return {
    value_usd: null,
    source: null,
    reason: `no ${basis} margin for ${root} (CME ${cmeFresh ? 'has no value' : 'not fresh'}, no Sheet override)`,
  };
}
