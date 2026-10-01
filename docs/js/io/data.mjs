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

/** @param {unknown} v @returns {boolean} */
const isPosNum = (v) => typeof v === 'number' && Number.isFinite(v) && v > 0;
/** @param {unknown} v @returns {boolean} */
const isStr = (v) => typeof v === 'string';
/** @param {unknown} v @returns {boolean} */
const isMultiplier = (v) => v === null || (typeof v === 'number' && Number.isFinite(v) && v > 0);

/**
 * Expected type of each rule value (plan/schemas/rules.schema.json). null is always allowed (UNKNOWN).
 * hold_margin_multipliers is checked member by member below.
 * @type {Record<string, {want: string, ok: (v: unknown) => boolean}>}
 */
const RULE_TYPES = {
  starting_balance_usd: { want: 'a number > 0', ok: isPosNum },
  daily_loss_cap_usd: { want: 'a number > 0', ok: isPosNum },
  max_drawdown_usd: { want: 'a number > 0', ok: isPosNum },
  max_contracts: { want: 'a whole number >= 1', ok: (v) => typeof v === 'number' && Number.isSafeInteger(v) && v >= 1 },
  micro_to_standard_ratio: { want: 'a number > 0', ok: isPosNum },
  flatten_time_ct: { want: 'a "HH:MM" string', ok: (v) => isStr(v) && /^([01]\d|2[0-3]):[0-5]\d$/.test(/** @type {string} */ (v)) },
  margin_basis: { want: '"initial" or "maintenance"', ok: (v) => v === 'initial' || v === 'maintenance' },
  allowed_roots: {
    want: 'an array of root strings like "ES"',
    ok: (v) => Array.isArray(v) && v.every((x) => isStr(x) && /^[A-Z0-9]{1,4}$/.test(x)),
  },
  challenge_start_date: { want: 'a string', ok: isStr },
  challenge_end_date: { want: 'a string', ok: isStr },
  // ADR-008 optional keys.
  daily_loss_cap_pct: { want: 'a number > 0 and <= 1', ok: (v) => isPosNum(v) && /** @type {number} */ (v) <= 1 },
  flatten_dates: {
    want: 'an array of "YYYY-MM-DD" strings',
    ok: (v) => Array.isArray(v) && v.every((x) => isStr(x) && /^\d{4}-\d{2}-\d{2}$/.test(x)),
  },
  min_contracts_per_day: { want: 'a whole number >= 0', ok: (v) => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 },
  commission_per_side_usd: { want: 'a number >= 0', ok: (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0 },
};
const HOLD_KEYS = ['intraday', 'overnight', 'weekend'];

/**
 * @param {unknown} v
 * @returns {string}
 */
function shown(v) {
  try {
    const t = JSON.stringify(v);
    return t === undefined ? String(v) : t.length > 40 ? `${t.slice(0, 40)}…` : t;
  } catch {
    return String(v);
  }
}

/**
 * Validate the rules file (pure). Values are NOT defaulted or coerced: a malformed entry or a value of the
 * wrong type becomes `{value: null}` (UNKNOWN) and is listed in `errors`. Unknown keys are dropped and listed.
 * `applies` (ADR-008) is kept when it is a boolean; any other type is listed and dropped (the rule then counts as
 * applicable, so a null value shows UNKNOWN rather than silently "not a rule").
 * @param {unknown} json
 * @returns {{rules: RulesFile|null, errors: string[]}}
 */
export function validateRulesFile(json) {
  if (!isObj(json) || json.schema_version !== 1 || !isObj(json.rules)) return { rules: null, errors: ['rules.json has an unexpected shape'] };
  /** @type {string[]} */
  const errors = [];
  /** @type {Record<string, unknown>} */
  const rules = {};
  for (const [k, v] of Object.entries(json.rules)) {
    const spec = RULE_TYPES[k];
    if (!spec && k !== 'hold_margin_multipliers') {
      errors.push(`${k}: not a known rule (ignored)`);
      continue;
    }
    if (!isObj(v) || !('value' in v)) {
      errors.push(`${k}: entry must be an object with "value" and "source"; treated as UNKNOWN`);
      rules[k] = { value: null, source: null };
      continue;
    }
    let source = v.source ?? null;
    if (source !== null && !isStr(source)) {
      errors.push(`${k}.source: expected a string or null, got ${shown(source)}`);
      source = null;
    }
    /** @type {unknown} */
    let value = v.value ?? null;
    if (value !== null && k === 'hold_margin_multipliers') {
      if (!isObj(value)) {
        errors.push(`${k}: expected an object {intraday, overnight, weekend}, got ${shown(value)}; treated as UNKNOWN`);
        value = null;
      } else {
        const src = value;
        /** @type {Record<string, number|null>} */
        const out = {};
        for (const h of HOLD_KEYS) {
          const m = src[h] ?? null;
          if (isMultiplier(m)) out[h] = /** @type {number|null} */ (m);
          else {
            errors.push(`${k}.${h}: expected a number > 0 or null, got ${shown(m)}; treated as UNKNOWN`);
            out[h] = null;
          }
        }
        for (const extra of Object.keys(src).filter((x) => !HOLD_KEYS.includes(x))) errors.push(`${k}.${extra}: not a known hold (ignored)`);
        value = out;
      }
    } else if (value !== null && spec && !spec.ok(value)) {
      errors.push(`${k}: expected ${spec.want}, got ${shown(value)}; treated as UNKNOWN`);
      value = null;
    }
    /** @type {{value: unknown, source: unknown, applies?: boolean}} */
    const entry = { value, source };
    if ('applies' in v) {
      if (typeof v.applies === 'boolean') entry.applies = v.applies;
      else errors.push(`${k}.applies: expected true or false, got ${shown(v.applies)} (ignored)`);
    }
    rules[k] = entry;
  }
  return {
    rules: /** @type {RulesFile} */ (/** @type {unknown} */ ({
      schema_version: 1,
      updated_at: typeof json.updated_at === 'string' ? json.updated_at : '',
      source_doc: typeof json.source_doc === 'string' ? json.source_doc : '',
      rules,
    })),
    errors,
  };
}

/**
 * Validate the rules file shape (pure). Same as `validateRulesFile(json).rules`.
 * @param {unknown} json
 * @returns {RulesFile|null}
 */
export function parseRulesFile(json) {
  return validateRulesFile(json).rules;
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
