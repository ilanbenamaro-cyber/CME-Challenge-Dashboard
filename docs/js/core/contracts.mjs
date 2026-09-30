/** @typedef {import('./types.mjs').ContractSpec} ContractSpec */
/** @typedef {import('./types.mjs').ContractsFile} ContractsFile */

/**
 * @param {string} root
 * @param {ContractsFile|null} file
 * @returns {ContractSpec|null}
 */
export function resolveSpec(root, file) {
  if (!file || !Array.isArray(file.contracts)) return null;
  return file.contracts.find((c) => c.root === root) ?? null;
}

/**
 * Root whose bars represent `root` (micros alias to parent; standards map to themselves).
 * Returns null for an unknown root.
 * @param {string} root
 * @param {ContractsFile|null} file
 * @returns {string|null}
 */
export function barsRootFor(root, file) {
  const spec = resolveSpec(root, file);
  if (!spec) return null;
  return spec.parent ?? spec.root;
}

/**
 * Standard-equivalent contract count: micros (spec.parent !== null) divided by `microRatio`.
 * Returns null if any root is unknown or a micro is present and microRatio is null.
 * A non-finite or non-positive microRatio is treated as unknown.
 * @param {{root: string, qty: number}[]} positions
 * @param {ContractsFile|null} file
 * @param {number|null} microRatio
 * @returns {number|null}
 */
export function standardEquivalent(positions, file, microRatio) {
  let total = 0;
  for (const p of positions) {
    const spec = resolveSpec(p.root, file);
    if (!spec) return null;
    if (typeof p.qty !== 'number' || !Number.isFinite(p.qty)) return null;
    if (spec.parent !== null) {
      if (microRatio === null || !Number.isFinite(microRatio) || microRatio <= 0) return null;
      total += p.qty / microRatio;
    } else {
      total += p.qty;
    }
  }
  return total;
}
