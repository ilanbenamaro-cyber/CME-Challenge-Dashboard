/** @typedef {import('./types.mjs').ContractSpec} ContractSpec */
/** @typedef {import('./types.mjs').ContractsFile} ContractsFile */

/**
 * @param {string} root
 * @param {ContractsFile|null} file
 * @returns {ContractSpec|null}
 */
export function resolveSpec(root, file) { throw new Error('not implemented'); }

/**
 * Root whose bars represent `root` (micros alias to parent; standards map to themselves).
 * Returns null for an unknown root.
 * @param {string} root
 * @param {ContractsFile|null} file
 * @returns {string|null}
 */
export function barsRootFor(root, file) { throw new Error('not implemented'); }

/**
 * Standard-equivalent contract count: micros (spec.parent !== null) divided by `microRatio`.
 * Returns null if any root is unknown or a micro is present and microRatio is null.
 * @param {{root: string, qty: number}[]} positions
 * @param {ContractsFile|null} file
 * @param {number|null} microRatio
 * @returns {number|null}
 */
export function standardEquivalent(positions, file, microRatio) { throw new Error('not implemented'); }
