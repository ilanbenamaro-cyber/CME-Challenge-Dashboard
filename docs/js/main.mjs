// WP-UI entry point: load via io, build the view model, render, wire forms. No inline handlers (CSP).
// Robustness contract: whatever fails, the page shows a visible error panel, never a blank page.

import { DATASETS, loadEnvelope, loadStatic, parseContractsFile, validateRulesFile } from './io/data.mjs';
import { loadSheet } from './io/sheet.mjs';
import { loadSettings, loadSizerForm, sanitizeSettings, sanitizeSizerForm, saveSettings, saveSizerForm } from './io/settings.mjs';
import { renderApp, renderFatal } from './ui/render.mjs';
import { buildViewModel } from './ui/viewmodel.mjs';

/** @typedef {import('./core/types.mjs').DatasetName} DatasetName */
/** @typedef {import('./core/types.mjs').Envelope<unknown>} AnyEnvelope */
/** @typedef {import('./io/sheet.mjs').SheetResult} SheetResult */

const RENDER_EVERY_MS = 30 * 1000;
const RELOAD_EVERY_MS = 5 * 60 * 1000;

const state = {
  settings: loadSettings(),
  sizerForm: loadSizerForm(),
  /** @type {import('./core/types.mjs').RulesFile|null} */
  rules: null,
  /** @type {import('./core/types.mjs').ContractsFile|null} */
  contracts: null,
  /** @type {Record<DatasetName, AnyEnvelope|null>} */
  envs: { bars: null, settlements: null, margins: null, challenge: null, calendar: null },
  /** @type {Partial<Record<string, string>>} */
  loadErrors: {},
  /** rules.json values of the wrong type (treated as UNKNOWN). */
  /** @type {string[]} */
  ruleErrors: [],
  /** @type {SheetResult|null} */
  sheet: null,
  /** URL the current `sheet` came from (last good data is kept only for the same URL). */
  sheetUrl: '',
  /** @type {number|null} */
  loadedAtMs: null,
  loading: false,
  loadedOnce: false,
};

/** @returns {HTMLElement|null} */
function appEl() {
  return document.getElementById('app');
}

/**
 * @param {unknown} err
 */
function showFatal(err) {
  const app = appEl();
  if (app) app.innerHTML = renderFatal(err);
  console.error(err);
}

/** Build and render the page; patch live regions so forms keep focus and typed text. */
function render() {
  const app = appEl();
  if (!app || !state.loadedOnce) return;
  /** @type {string} */
  let markup;
  try {
    const vm = buildViewModel({
      nowMs: Date.now(),
      rules: state.rules,
      contracts: state.contracts,
      envs: state.envs,
      sheet: state.sheet,
      settings: state.settings,
      sizerForm: state.sizerForm,
      loadErrors: state.loadErrors,
      ruleErrors: state.ruleErrors,
      loadedAtMs: state.loadedAtMs,
    });
    markup = renderApp(vm);
  } catch (e) {
    showFatal(e);
    return;
  }
  const tpl = document.createElement('template');
  tpl.innerHTML = markup;
  const needMount = !app.querySelector('.shell:not([data-fatal])')
    || (tpl.content.querySelector('#sizer-form') !== null && app.querySelector('#sizer-form') === null);
  if (needMount) {
    app.replaceChildren(tpl.content);
    const key = app.querySelector('#settings-form input[name="sheet_key"]');
    if (key instanceof HTMLInputElement) key.value = state.settings.sheet_key;
    return;
  }
  for (const fresh of Array.from(tpl.content.querySelectorAll('[data-live]'))) {
    const name = fresh.getAttribute('data-live');
    const cur = name ? app.querySelector(`[data-live="${CSS.escape(name)}"]`) : null;
    if (cur) cur.replaceWith(fresh);
  }
}

/** Fetch the Sheet (if configured). Keeps last good data from the same URL when a refetch fails. */
async function reloadSheet() {
  const { sheet_url: url, sheet_key: key } = state.settings;
  if (url.trim() === '') {
    state.sheet = null;
    state.sheetUrl = '';
    return;
  }
  const res = await loadSheet(url, key);
  if (res.error !== null && state.sheet?.data && state.sheetUrl === url) {
    state.sheet = { ...state.sheet, error: res.error };
  } else {
    state.sheet = res;
    state.sheetUrl = url;
  }
}

/**
 * @param {boolean} busy
 */
function setBusy(busy) {
  for (const b of Array.from(document.querySelectorAll('[data-action="refresh"]'))) {
    if (b instanceof HTMLButtonElement) {
      b.disabled = busy;
      b.classList.toggle('busy', busy);
    }
  }
}

/** Load static files, envelopes and the Sheet, then render. */
async function loadAll() {
  if (state.loading) return;
  state.loading = true;
  setBusy(true);
  try {
    const [rules, contracts, ...envs] = await Promise.all([
      loadStatic('rules'),
      loadStatic('contracts'),
      ...DATASETS.map((d) => loadEnvelope(d)),
      reloadSheet().then(() => null),
    ]);
    /** @type {Partial<Record<string, string>>} */
    const errs = {};
    const rv = rules.json === null ? null : validateRulesFile(rules.json);
    const rf = rv ? rv.rules : null;
    if (rf) {
      state.rules = rf;
      state.ruleErrors = rv ? rv.errors : [];
    } else if (!state.rules || rules.error === null) {
      state.rules = null;
      state.ruleErrors = [];
    }
    if (!rf) errs.rules = rules.error ?? 'rules.json has an unexpected shape';
    const cf = contracts.json === null ? null : parseContractsFile(contracts.json);
    if (cf) state.contracts = cf;
    else if (!state.contracts || contracts.error === null) state.contracts = null;
    if (!cf) errs.contracts = contracts.error ?? 'contracts.json has an unexpected shape';
    DATASETS.forEach((name, i) => {
      const r = /** @type {{env: AnyEnvelope|null, error: string|null}|null|undefined} */ (envs[i]);
      if (!r) return;
      if (r.env) state.envs[name] = r.env;
      else {
        // A 404 means the file does not exist (yet): drop it. A transient network error keeps the last
        // envelope, whose own data_as_of still drives its freshness chip.
        if (r.error === 'HTTP 404' || state.envs[name] === null) state.envs[name] = null;
        errs[name] = r.error ?? 'unknown error';
      }
    });
    state.loadErrors = errs;
    state.loadedAtMs = Date.now();
  } catch (e) {
    console.error(e);
  } finally {
    state.loading = false;
    state.loadedOnce = true;
    setBusy(false);
    render();
  }
}

/**
 * @param {HTMLFormElement} form
 * @param {string} name
 * @returns {string}
 */
function field(form, name) {
  const el = form.elements.namedItem(name);
  if (el instanceof HTMLInputElement || el instanceof HTMLSelectElement) return el.value;
  if (el instanceof RadioNodeList) return el.value;
  return '';
}

/**
 * @param {HTMLFormElement} form
 */
function onSizerChange(form) {
  state.sizerForm = sanitizeSizerForm({
    root: field(form, 'root'),
    risk_budget_usd: field(form, 'risk_budget_usd'),
    stop_ticks: field(form, 'stop_ticks'),
    fee_per_contract_usd: field(form, 'fee_per_contract_usd'),
    hold: field(form, 'hold'),
  });
  saveSizerForm(state.sizerForm);
  render();
}

/**
 * @param {HTMLFormElement} form
 */
async function onSettingsSubmit(form) {
  state.settings = sanitizeSettings({
    sheet_url: field(form, 'sheet_url'),
    sheet_key: field(form, 'sheet_key'),
    watched_roots: field(form, 'watched_roots'),
    expiry_warn_days: field(form, 'expiry_warn_days'),
  });
  saveSettings(state.settings);
  const status = form.querySelector('[data-role="settings-status"]');
  if (status) status.textContent = 'Saved. Loading Sheet…';
  const roots = form.elements.namedItem('watched_roots');
  if (roots instanceof HTMLInputElement) roots.value = state.settings.watched_roots.join(', ');
  render();
  await reloadSheet();
  if (status) {
    status.textContent = state.settings.sheet_url === '' ? 'Saved (no Sheet configured).'
      : state.sheet?.error ? `Sheet error: ${state.sheet.error}` : 'Saved. Sheet loaded.';
  }
  render();
}

function wire() {
  const app = appEl();
  if (!app) return;
  /** @param {Event} ev */
  const onFormEvent = (ev) => {
    const t = ev.target;
    if (!(t instanceof Element)) return;
    const form = t.closest('form');
    if (form instanceof HTMLFormElement && form.id === 'sizer-form') onSizerChange(form);
  };
  app.addEventListener('input', onFormEvent);
  app.addEventListener('change', onFormEvent);
  app.addEventListener('submit', (ev) => {
    ev.preventDefault();
    const form = ev.target;
    if (form instanceof HTMLFormElement && form.id === 'settings-form') {
      onSettingsSubmit(form).catch(showFatal);
    }
  });
  app.addEventListener('click', (ev) => {
    const t = ev.target;
    if (t instanceof Element && t.closest('[data-action="refresh"]')) {
      loadAll().catch(showFatal);
    }
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    if (state.loadedAtMs === null || Date.now() - state.loadedAtMs > RELOAD_EVERY_MS) loadAll().catch(showFatal);
    else render();
  });
  setInterval(render, RENDER_EVERY_MS);
  setInterval(() => {
    loadAll().catch(showFatal);
  }, RELOAD_EVERY_MS);
}

window.addEventListener('error', (ev) => {
  // Before the first successful render any uncaught error would leave the boot message; show it instead.
  if (!appEl()?.querySelector('.shell')) showFatal(ev.error ?? ev.message);
});
window.addEventListener('unhandledrejection', (ev) => {
  if (!appEl()?.querySelector('.shell')) showFatal(ev.reason);
});

try {
  wire();
  loadAll().catch(showFatal);
} catch (e) {
  showFatal(e);
}
