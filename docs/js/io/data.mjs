// WP-UI io layer: the only module (with sheet.mjs / settings.mjs) allowed to touch the network or storage.
/** @typedef {import('../core/types.mjs').DatasetName} DatasetName */
/** @typedef {import('../core/types.mjs').RulesFile} RulesFile */
/** @typedef {import('../core/types.mjs').ContractsFile} ContractsFile */
/** @typedef {import('../core/types.mjs').ContractSpec} ContractSpec */
/**
 * @template T
 * @typedef {import('../core/types.mjs').Envelope<T>} Envelope
 */

/** Datasets loaded as D7 envelopes, in display order. */
/** @type {DatasetName[]} */
export const DATASETS = ['bars', 'settlements', 'margins', 'challenge', 'calendar'];

const FETCH_TIMEOUT_MS = 20000;

/**
 * @param {unknown} e
 * @returns {string}
 */
function errText(e) {
  if (e instanceof Error) return e.name === 'AbortError' ? 'timed out' : e.message;
  return String(e);
}

/**
 * GET a same-origin JSON file, bypassing caches.
 * @param {string} path
 * @returns {Promise<{json: unknown, error: string|null}>}
 */
async function getJson(path) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(`${path}?t=${Date.now()}`, { cache: 'no-store', signal: ctl.signal });
    if (!res.ok) return { json: null, error: `HTTP ${res.status}` };
    const text = await res.text();
    try {
      return { json: JSON.parse(text), error: null };
    } catch {
      return { json: null, error: 'invalid JSON' };
    }
  } catch (e) {
    return { json: null, error: `network: ${errText(e)}` };
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

/**
 * Load `data/<name>.json`. The envelope is returned as-is when it is an object with the D7 keys, so
 * core `classifyFreshness` can judge it (a wrong schema_version becomes `invalid`, not a crash).
 * Network, HTTP, JSON or shape errors give `env: null` plus the error text.
 * @param {DatasetName} name
 * @returns {Promise<{env: Envelope<unknown>|null, error: string|null}>}
 */
export async function loadEnvelope(name) {
  const { json, error } = await getJson(`data/${name}.json`);
  if (error !== null) return { env: null, error };
  const env = asEnvelope(json);
  return env ? { env, error: null } : { env: null, error: 'not a D7 envelope' };
}

/**
 * Minimal structural check of a D7 envelope (pure; exported for tests).
 * @param {unknown} json
 * @returns {Envelope<unknown>|null}
 */
export function asEnvelope(json) {
  if (!isObj(json)) return null;
  if (typeof json.status !== 'string' || !Array.isArray(json.errors) || !('data' in json) || !('data_as_of' in json)) {
    return null;
  }
  return /** @type {Envelope<unknown>} */ (/** @type {unknown} */ (json));
}

/**
 * Load a human-maintained static file.
 * @param {'rules'|'contracts'} name
 * @returns {Promise<{json: unknown|null, error: string|null}>}
 */
export async function loadStatic(name) {
  const { json, error } = await getJson(`data/${name}.json`);
  return { json: error === null ? json : null, error };
}

/**
 * Validate the rules file shape (pure). Values are NOT defaulted: a malformed rule entry becomes
 * `{value: null}` so it renders UNKNOWN.
 * @param {unknown} json
 * @returns {RulesFile|null}
 */
export function parseRulesFile(json) {
  if (!isObj(json) || json.schema_version !== 1 || !isObj(json.rules)) return null;
  /** @type {Record<string, unknown>} */
  const rules = {};
  for (const [k, v] of Object.entries(json.rules)) {
    if (isObj(v) && 'value' in v) {
      rules[k] = { value: v.value ?? null, source: typeof v.source === 'string' ? v.source : null };
    } else {
      rules[k] = { value: null, source: null };
    }
  }
  return /** @type {RulesFile} */ (/** @type {unknown} */ ({
    schema_version: 1,
    updated_at: typeof json.updated_at === 'string' ? json.updated_at : '',
    source_doc: typeof json.source_doc === 'string' ? json.source_doc : '',
    rules,
  }));
}

/**
 * Validate the contracts file shape (pure). Malformed specs are dropped (their roots become unknown).
 * @param {unknown} json
 * @returns {ContractsFile|null}
 */
export function parseContractsFile(json) {
  if (!isObj(json) || json.schema_version !== 1 || !Array.isArray(json.contracts)) return null;
  /** @type {ContractSpec[]} */
  const contracts = [];
  for (const c of json.contracts) {
    if (!isObj(c)) continue;
    const ok = typeof c.root === 'string' && typeof c.name === 'string'
      && typeof c.tick_size === 'number' && c.tick_size > 0
      && typeof c.tick_value_usd === 'number' && c.tick_value_usd > 0
      && (c.parent === null || typeof c.parent === 'string')
      && (c.expiry_rule === 'quarterly_third_friday' || c.expiry_rule === 'manual')
      && typeof c.months === 'string';
    if (ok) contracts.push(/** @type {ContractSpec} */ (/** @type {unknown} */ (c)));
  }
  return { schema_version: 1, contracts };
}
