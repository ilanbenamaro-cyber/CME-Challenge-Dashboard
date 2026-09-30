// WP-UI: HTML-string helpers. Every piece of dynamic text in the rendered page goes through escapeHtml.

/** @type {Record<string, string>} */
const ENTITIES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '`': '&#96;' };

/**
 * Escape text for use in HTML element content and double- or single-quoted attribute values.
 * Non-strings are stringified first (null/undefined → '').
 * @param {unknown} v
 * @returns {string}
 */
export function escapeHtml(v) {
  const s = v === null || v === undefined ? '' : String(v);
  return s.replace(/[&<>"'`]/g, (c) => ENTITIES[c] ?? c);
}

/**
 * Tagged template that escapes every interpolated value unless it is a `Raw` fragment.
 * @param {TemplateStringsArray} strings
 * @param {...unknown} values
 * @returns {Raw}
 */
export function html(strings, ...values) {
  let out = strings[0] ?? '';
  values.forEach((v, i) => {
    out += toHtml(v) + (strings[i + 1] ?? '');
  });
  return new Raw(out);
}

/** Trusted, already-escaped HTML fragment. Only `html` and `join` create these. */
export class Raw {
  /** @param {string} s */
  constructor(s) {
    /** @readonly */
    this.s = s;
  }

  toString() {
    return this.s;
  }
}

/**
 * @param {unknown} v
 * @returns {string}
 */
function toHtml(v) {
  if (v instanceof Raw) return v.s;
  if (Array.isArray(v)) return v.map(toHtml).join('');
  if (v === false || v === null || v === undefined) return '';
  return escapeHtml(v);
}

/**
 * Join fragments (each escaped unless Raw).
 * @param {unknown[]} parts
 * @param {string} [sep]
 * @returns {Raw}
 */
export function join(parts, sep = '') {
  return new Raw(parts.map(toHtml).join(escapeHtml(sep)));
}
