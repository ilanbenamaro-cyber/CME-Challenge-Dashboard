// WP-UI io layer: per-browser settings in localStorage. Every storage access is wrapped in try/catch
// (private mode, blocked storage): the site must work with defaults when storage is unavailable.
/** @typedef {import('../core/types.mjs').Hold} Hold */

/**
 * @typedef {object} Settings
 * @property {string} sheet_url
 * @property {string} sheet_key
 * @property {string[]} watched_roots
 * @property {number} expiry_warn_days
 */

/**
 * Sizer form state. Numbers are null when the field is blank or not a number.
 * @typedef {object} SizerForm
 * @property {string} root
 * @property {number|null} risk_budget_usd
 * @property {number|null} stop_ticks
 * @property {number|null} fee_per_contract_usd
 * @property {Hold} hold
 */

const SETTINGS_KEY = 'cme-dash.settings.v1';
const SIZER_KEY = 'cme-dash.sizer.v1';

/** @returns {Settings} */
export function defaultSettings() {
  return { sheet_url: '', sheet_key: '', watched_roots: ['ES', 'MES', 'NQ', 'MNQ'], expiry_warn_days: 5 };
}

/** @returns {SizerForm} */
export function defaultSizerForm() {
  return { root: 'MES', risk_budget_usd: null, stop_ticks: null, fee_per_contract_usd: null, hold: 'intraday' };
}

/**
 * @param {unknown} v
 * @returns {v is Record<string, unknown>}
 */
function isObj(v) {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * Parse a comma/space separated root list: upper-cased, deduplicated, 1–4 alphanumerics each.
 * @param {unknown} v
 * @returns {string[]|null} null if nothing valid
 */
export function parseRoots(v) {
  const parts = Array.isArray(v) ? v.map(String) : typeof v === 'string' ? v.split(/[\s,;]+/) : [];
  /** @type {string[]} */
  const out = [];
  for (const p of parts) {
    const r = p.trim().toUpperCase();
    if (/^[A-Z0-9]{1,4}$/.test(r) && !out.includes(r)) out.push(r);
  }
  return out.length > 0 ? out.slice(0, 12) : null;
}

/**
 * Coerce untrusted stored/form data into valid Settings, field by field (pure).
 * @param {unknown} raw
 * @returns {Settings}
 */
export function sanitizeSettings(raw) {
  const d = defaultSettings();
  if (!isObj(raw)) return d;
  const days = typeof raw.expiry_warn_days === 'number' ? raw.expiry_warn_days : Number(raw.expiry_warn_days);
  return {
    sheet_url: typeof raw.sheet_url === 'string' ? raw.sheet_url.trim().slice(0, 500) : d.sheet_url,
    sheet_key: typeof raw.sheet_key === 'string' ? raw.sheet_key.trim().slice(0, 200) : d.sheet_key,
    watched_roots: parseRoots(raw.watched_roots) ?? d.watched_roots,
    expiry_warn_days: Number.isInteger(days) && days >= 0 && days <= 60 ? days : d.expiry_warn_days,
  };
}

/**
 * @param {unknown} v
 * @returns {number|null}
 */
function numOrNull(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * Coerce untrusted sizer form data (pure).
 * @param {unknown} raw
 * @returns {SizerForm}
 */
export function sanitizeSizerForm(raw) {
  const d = defaultSizerForm();
  if (!isObj(raw)) return d;
  const root = typeof raw.root === 'string' && /^[A-Za-z0-9]{1,4}$/.test(raw.root.trim()) ? raw.root.trim().toUpperCase() : d.root;
  const hold = raw.hold === 'intraday' || raw.hold === 'overnight' || raw.hold === 'weekend' ? raw.hold : d.hold;
  return {
    root,
    risk_budget_usd: numOrNull(raw.risk_budget_usd),
    stop_ticks: numOrNull(raw.stop_ticks),
    fee_per_contract_usd: numOrNull(raw.fee_per_contract_usd),
    hold,
  };
}

/**
 * @param {string} key
 * @returns {unknown}
 */
function readJson(key) {
  try {
    const s = globalThis.localStorage?.getItem(key);
    return s ? JSON.parse(s) : null;
  } catch {
    return null;
  }
}

/**
 * @param {string} key
 * @param {unknown} value
 * @returns {boolean} false if storage is unavailable
 */
function writeJson(key, value) {
  try {
    globalThis.localStorage?.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

/** @returns {Settings} */
export function loadSettings() {
  return sanitizeSettings(readJson(SETTINGS_KEY));
}

/**
 * @param {Settings} s
 * @returns {void}
 */
export function saveSettings(s) {
  writeJson(SETTINGS_KEY, sanitizeSettings(s));
}

/** @returns {SizerForm} */
export function loadSizerForm() {
  return sanitizeSizerForm(readJson(SIZER_KEY));
}

/**
 * @param {SizerForm} f
 * @returns {void}
 */
export function saveSizerForm(f) {
  writeJson(SIZER_KEY, sanitizeSizerForm(f));
}
