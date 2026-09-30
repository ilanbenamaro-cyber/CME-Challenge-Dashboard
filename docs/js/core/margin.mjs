/** @typedef {import('./types.mjs').MarginRow} MarginRow */

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
export function resolveMargin(root, basis, cmeRows, cmeFresh, sheetRows) { throw new Error('not implemented'); }
