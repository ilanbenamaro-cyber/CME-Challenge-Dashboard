// WP-UI renderer: ViewModel -> HTML strings. All dynamic text is escaped (via the `html` tag / escapeHtml):
// Sheet ids and notes are untrusted. No inline styles or handlers (CSP style-src/script-src 'self').

import { escapeHtml, html, Raw } from './html.mjs';

/** @typedef {import('./viewmodel.mjs').ViewModel} ViewModel */
/** @typedef {import('./viewmodel.mjs').Cell} Cell */
/** @typedef {import('./viewmodel.mjs').Chip} Chip */
/** @typedef {import('./viewmodel.mjs').BannerVM} BannerVM */
/** @typedef {import('./viewmodel.mjs').MeterVM} MeterVM */
/** @typedef {import('./viewmodel.mjs').AccountVM} AccountVM */
/** @typedef {import('./viewmodel.mjs').PositionsVM} PositionsVM */
/** @typedef {import('./viewmodel.mjs').SizerVM} SizerVM */
/** @typedef {import('./viewmodel.mjs').MarketRow} MarketRow */
/** @typedef {import('./viewmodel.mjs').CalendarVM} CalendarVM */
/** @typedef {import('./viewmodel.mjs').ReconVM} ReconVM */
/** @typedef {import('../core/types.mjs').Level} Level */

/** Build marker: the e2e smoke test reads this constant from disk and expects it in the served page. */
export const BUILD_ID = 'wp-ui-2026-09-30.3';

export { escapeHtml };

/** Level → icon + word, so state never relies on colour alone. */
const LEVEL_UI = {
  ok: { icon: '✓', word: 'OK' },
  warn: { icon: '▲', word: 'WARN' },
  breach: { icon: '✕', word: 'BREACH' },
  unknown: { icon: '?', word: 'UNKNOWN' },
};

/**
 * Level pill: icon + text.
 * @param {Level} level
 * @param {string} [text]
 * @returns {Raw}
 */
export function levelPill(level, text) {
  const u = LEVEL_UI[level];
  return html`<span class="lvl lvl-${level}"><span class="ico" aria-hidden="true">${u.icon}</span>${text ?? u.word}</span>`;
}

/**
 * @param {Cell} c
 * @param {{big?: boolean, noNote?: boolean}} [opt]
 * @returns {Raw}
 */
export function renderCell(c, opt = {}) {
  const cls = ['val', c.known ? '' : 'val-unknown', c.sign ? `val-${c.sign}` : '', opt.big ? 'val-big' : '', c.level && c.known ? `val-lvl-${c.level}` : '']
    .filter(Boolean).join(' ');
  const unk = c.known ? '' : html`<span class="ico" aria-hidden="true">?</span>`;
  return html`<span class="${cls}">${unk}${c.text}</span>${c.badge ? html` <span class="badge">${c.badge}</span>` : ''}${
    !opt.noNote && c.note ? html`<span class="note">${c.note}</span>` : ''}`;
}

/**
 * @param {Chip} c
 * @returns {Raw}
 */
function renderChip(c) {
  const u = LEVEL_UI[c.level];
  const title = `${c.name}: ${c.state}${c.age_text ? `, ${c.age_text} old` : ''} — ${c.reason} · ${c.source}`;
  return html`<li class="chip chip-${c.level}" title="${title}"><span class="ico" aria-hidden="true">${u.icon}</span><span class="chip-name">${c.name}</span> <span class="chip-state">${c.state.toUpperCase()}</span>${
    c.age_text ? html` <span class="chip-age">${c.age_text}</span>` : ''}</li>`;
}

/**
 * @param {ViewModel} vm
 * @returns {Raw}
 */
export function renderTop(vm) {
  return html`<header class="top" data-live="top">
  <div class="top-row">
    <div class="brand"><h1>CME Challenge Risk</h1><span class="sub">read-only risk console</span></div>
    <div class="clock"><span class="clock-now">${vm.clock.ct_text}</span><span class="clock-td">trade date ${vm.clock.trade_date}</span></div>
    <button type="button" class="btn btn-refresh" data-action="refresh" title="Reload data files and the Sheet">Refresh<span class="loaded"> · ${vm.clock.loaded_text}</span></button>
  </div>
  <ul class="chips" aria-label="Data freshness">${vm.chips.map(renderChip)}</ul>
</header>`;
}

/**
 * @param {BannerVM} b
 * @returns {Raw}
 */
function renderBanner(b) {
  const u = LEVEL_UI[b.level];
  const role = b.level === 'breach' ? 'alert' : 'status';
  return html`<div class="banner banner-${b.level} banner-${b.kind}" role="${role}">
  <span class="banner-ico" aria-hidden="true">${u.icon}</span>
  <div class="banner-body">
    <p class="banner-title"><strong>${b.title}</strong> <span class="banner-lvl">${u.word}</span></p>
    <p class="banner-msg">${b.message}</p>
    ${b.details.length > 0 ? html`<ul class="banner-details">${b.details.map((d) => html`<li>${d}</li>`)}</ul>` : ''}
  </div>
</div>`;
}

/**
 * @param {BannerVM[]} banners
 * @returns {Raw}
 */
export function renderBanners(banners) {
  const action = banners.filter((b) => b.level !== 'ok');
  const info = banners.filter((b) => b.level === 'ok');
  return html`<section class="banners" data-live="banners" aria-label="Alerts">
  ${action.length === 0 ? html`<p class="all-clear">${levelPill('ok', 'No alerts')}</p>` : action.map(renderBanner)}
  ${info.length > 0 ? html`<ul class="infoline">${info.map((b) => html`<li>${levelPill('ok', b.title)} ${b.message}</li>`)}</ul>` : ''}
</section>`;
}

/**
 * @param {string} live
 * @param {string} title
 * @param {string} msg
 * @returns {Raw}
 */
function errorPanel(live, title, msg) {
  return html`<section class="panel panel-error" data-live="${live}"><h2>${title}</h2>
  <p>${levelPill('unknown', 'PANEL UNAVAILABLE')} This panel could not be built, so its values are UNKNOWN.</p>
  <p class="note mono">${msg}</p></section>`;
}

/**
 * @param {MeterVM} m
 * @returns {Raw}
 */
function renderMeter(m) {
  const fill = m.fill === null ? html`<div class="fill fill-unknown"></div>` : html`<div class="fill fill-${m.level} f-${m.fill}"></div>`;
  return html`<div class="meter meter-${m.level}" data-meter="${m.key}">
  <div class="meter-head"><span class="meter-label">${m.label}</span>${levelPill(m.level, m.level === 'unknown' ? 'UNKNOWN' : `${LEVEL_UI[m.level].word} ${m.pct_text}`)}</div>
  <div class="bar" role="img" aria-label="${m.label}: ${m.pct_text}">${fill}</div>
  <dl class="meter-nums">
    <div><dt>used</dt><dd>${m.used_text}</dd></div>
    <div><dt>limit</dt><dd>${m.limit_text}</dd></div>
    <div><dt>left</dt><dd>${m.remaining_text}</dd></div>
  </dl>
  ${m.note ? html`<p class="note">${m.note}</p>` : ''}
</div>`;
}

/**
 * @param {string} label
 * @param {Cell} c
 * @returns {Raw}
 */
function kpi(label, c) {
  return html`<div class="kpi"><span class="kpi-label">${label}</span>${renderCell(c, { big: true })}</div>`;
}

/**
 * @param {ViewModel} vm
 * @returns {Raw}
 */
export function renderAccount(vm) {
  const a = vm.account;
  if (!a) return errorPanel('account', 'Account', vm.sectionErrors.account ?? 'unavailable');
  return html`<section class="panel" id="p-account" data-live="account">
  <h2>Account <span class="h-sub">trade date ${a.trade_date}</span></h2>
  <div class="kpis">
    ${kpi("Today's realized", a.realized)}
    ${kpi('Open P&L', a.open)}
    ${kpi('Equity', a.equity)}
    ${kpi('Peak (EOD)', a.peak)}
    ${kpi('Margin in use', a.margin_used)}
  </div>
  <div class="meters">${a.meters.map(renderMeter)}</div>
</section>`;
}

/**
 * @param {ViewModel} vm
 * @returns {Raw}
 */
export function renderPositions(vm) {
  const p = vm.positions;
  if (!p) return errorPanel('positions', 'Positions', vm.sectionErrors.positions ?? 'unavailable');
  const body = !p.known
    ? html`<p class="empty">${levelPill('unknown')} ${p.reason}</p>`
    : p.rows.length === 0
      ? html`<p class="empty">${p.reason}</p>`
      : html`<div class="table-wrap"><table class="grid">
  <thead><tr><th>ID</th><th>Root</th><th>Side</th><th class="num">Qty</th><th class="num">Entry</th><th class="num">Mark</th><th class="num">Open P&amp;L</th><th>Notes</th></tr></thead>
  <tbody>${p.rows.map((r) => html`<tr${r.flags.length ? html` class="row-breach"` : ''}>
    <td class="mono">${r.id}</td><td>${r.root}</td><td class="side-${r.side}">${r.side.toUpperCase()}</td><td class="num">${r.qty}</td>
    <td class="num">${r.entry_text}</td><td class="num">${renderCell(r.mark, { noNote: true })}</td><td class="num">${renderCell(r.pnl)}</td>
    <td class="notes">${r.notes}${r.flags.length ? html`<span class="note">${levelPill('breach')} ${r.flags.join('; ')}</span>` : ''}</td></tr>`)}</tbody>
</table></div>`;
  return html`<section class="panel" id="p-positions" data-live="positions">
  <h2>Positions</h2>
  <div class="pos-summary"><span class="kpi-label">Standard-equivalent open / max</span> ${
    p.std_equiv.level ? levelPill(p.std_equiv.level, p.std_equiv.text) : renderCell(p.std_equiv)}<span class="note">${p.std_equiv.note}</span></div>
  ${body}
</section>`;
}

/** @type {{value: import('../core/types.mjs').Hold, label: string}[]} */
const HOLD_OPTIONS = [
  { value: 'intraday', label: 'Intraday' },
  { value: 'overnight', label: 'Overnight' },
  { value: 'weekend', label: 'Weekend' },
];

/**
 * @param {number|null} v
 * @returns {string}
 */
function numVal(v) {
  return v === null ? '' : String(v);
}

/**
 * The sizer form (static between renders so typing is never interrupted).
 * @param {SizerVM} s
 * @returns {Raw}
 */
export function renderSizerForm(s) {
  const f = s.form;
  return html`<form id="sizer-form" class="form sizer-form" autocomplete="off" novalidate>
  <label class="field"><span>Root</span><select name="root">${s.roots.map((r) => html`<option value="${r}"${r === f.root ? html` selected` : ''}>${r}</option>`)}</select></label>
  <label class="field"><span>Risk budget $</span><input name="risk_budget_usd" type="number" inputmode="decimal" min="0" step="any" value="${numVal(f.risk_budget_usd)}" placeholder="e.g. 250"></label>
  <label class="field"><span>Stop (ticks)</span><input name="stop_ticks" type="number" inputmode="numeric" min="1" step="1" value="${numVal(f.stop_ticks)}" placeholder="e.g. 16"></label>
  <label class="field"><span>Fee / contract RT $</span><input name="fee_per_contract_usd" type="number" inputmode="decimal" min="0" step="any" value="${numVal(f.fee_per_contract_usd)}" placeholder="0 if none"></label>
  <fieldset class="field seg"><legend>Hold</legend>${HOLD_OPTIONS.map((h) => html`<label class="seg-opt"><input type="radio" name="hold" value="${h.value}"${h.value === f.hold ? html` checked` : ''}><span>${h.label}</span></label>`)}</fieldset>
</form>`;
}

/**
 * The live sizer result.
 * @param {ViewModel} vm
 * @returns {Raw}
 */
export function renderSizerResult(vm) {
  const s = vm.sizer;
  if (!s) return html`<div class="sizer-result" data-live="sizer">${levelPill('unknown', 'SIZER UNAVAILABLE')} <span class="note mono">${vm.sectionErrors.sizer ?? ''}</span></div>`;
  return html`<div class="sizer-result sizer-${s.status}" data-live="sizer">
  <div class="sizer-main">
    <div class="sizer-count"><span class="kpi-label">Contracts</span><span class="sizer-n${s.status === 'unknown' ? ' val-unknown' : ''}" data-contracts="${s.contracts_text}">${s.contracts_text}</span>${levelPill(s.level, s.status === 'zero' ? 'NONE FIT' : s.status === 'ok' ? 'OK' : 'UNKNOWN')}</div>
    <p class="sizer-binding">${s.binding_text}</p>
  </div>
  <table class="limits"><tbody>
    ${s.limits.map((l) => html`<tr${l.binding ? html` class="binding"` : ''}><th>${l.label}${l.binding ? html` <span class="bind-tag">binding</span>` : ''}</th><td class="num${l.text === 'UNKNOWN' ? ' val-unknown' : ''}">${l.text}</td></tr>`)}
    <tr><th>Risk / contract</th><td class="num">${s.per_contract_risk_text}</td></tr>
    <tr><th>Margin / contract</th><td class="num">${renderCell(s.margin)}</td></tr>
    <tr><th>Hold multiplier</th><td class="num${s.multiplier_text === 'UNKNOWN' ? ' val-unknown' : ''}">${s.multiplier_text}</td></tr>
    <tr><th>Available margin</th><td class="num">${renderCell(s.available)}</td></tr>
    <tr><th>Stop hint ATR(14)</th><td class="num">${renderCell(s.atr)}</td></tr>
  </tbody></table>
  ${s.reasons.length > 0 ? html`<ul class="reasons">${s.reasons.map((r) => html`<li>${r}</li>`)}</ul>` : ''}
  ${s.warnings.length > 0 ? html`<ul class="reasons reasons-warn">${s.warnings.map((r) => html`<li>${levelPill('warn')} ${r}</li>`)}</ul>` : ''}
</div>`;
}

/**
 * @param {ViewModel} vm
 * @returns {Raw}
 */
export function renderSizer(vm) {
  return html`<section class="panel" id="p-sizer">
  <h2>Position sizer <span class="h-sub">sizes a new position; never sends anything</span></h2>
  ${vm.sizer ? renderSizerForm(vm.sizer) : ''}
  ${renderSizerResult(vm)}
</section>`;
}

/**
 * @param {ViewModel} vm
 * @returns {Raw}
 */
export function renderMarkets(vm) {
  const rows = vm.markets;
  if (!rows) return errorPanel('markets', 'Markets', vm.sectionErrors.markets ?? 'unavailable');
  /** @param {string} label @param {Cell} c */
  const item = (label, c) => html`<div class="mk"><dt>${label}</dt><dd>${renderCell(c)}</dd></div>`;
  return html`<section class="panel" id="p-markets" data-live="markets">
  <h2>Markets <span class="h-sub">watched roots</span></h2>
  ${rows.length === 0 ? html`<p class="empty">No watched roots (Settings)</p>` : ''}
  <div class="cards">${rows.map((r) => html`<article class="card">
    <h3><span class="root">${r.root}</span> <span class="h-sub">${r.name}</span></h3>
    <dl class="mk-grid">${item('Last', r.last)}${item('ATR(14) 1h', r.atr)}${item('Settle', r.settle)}${item('Margin', r.margin)}</dl>
  </article>`)}</div>
</section>`;
}

/**
 * @param {ViewModel} vm
 * @returns {Raw}
 */
export function renderCalendar(vm) {
  const c = vm.calendar;
  if (!c) return errorPanel('calendar', 'Calendar', vm.sectionErrors.calendar ?? 'unavailable');
  return html`<section class="panel" id="p-calendar" data-live="calendar">
  <h2>Calendar ${c.badge ? html`<span class="badge">${c.badge}</span>` : ''}</h2>
  <h3 class="h3">Next events</h3>
  ${c.events === null ? html`<p class="empty">${levelPill('unknown')} ${c.events_note}</p>`
    : c.events.length === 0 ? html`<p class="empty">${c.events_note}</p>`
      : html`<ul class="events">${c.events.map((e) => html`<li class="event impact-${e.impact}">
      <span class="ev-when">${e.when}</span><span class="ev-title">${e.title}</span>
      <span class="ev-meta"><span class="impact">${e.impact.toUpperCase()}</span> · in ${e.days}d · <span class="note-inline">${e.source}</span></span></li>`)}</ul>`}
  <h3 class="h3">Next expirations</h3>
  <div class="table-wrap"><table class="grid">
    <thead><tr><th>Root</th><th>Contract</th><th>Date</th><th class="num">Days</th><th>Status</th></tr></thead>
    <tbody>${c.expirations.map((x) => html`<tr><td>${x.root}</td><td class="mono${x.contract_text === 'UNKNOWN' ? ' val-unknown' : ''}">${x.contract_text}</td>
      <td${x.date_text === 'UNKNOWN' ? html` class="val-unknown"` : ''}>${x.date_text}</td><td class="num">${x.days_text}</td><td>${levelPill(x.level)}</td></tr>
      <tr class="subrow"><td colspan="5" class="note">${x.source}</td></tr>`)}</tbody>
  </table></div>
</section>`;
}

/**
 * @param {ViewModel} vm
 * @returns {Raw}
 */
export function renderRecon(vm) {
  const r = vm.recon;
  if (!r) return errorPanel('recon', 'Reconciliation', vm.sectionErrors.recon ?? 'unavailable');
  const ch = r.challenge_shown;
  const table = html`<div class="table-wrap"><table class="grid recon">
  <thead>
    ${ch ? html`<tr><th></th><th colspan="4" class="grp">Trades vs Sheet Daily</th><th colspan="3" class="grp">Challenge results</th></tr>` : ''}
    <tr><th>Trade date</th><th class="num">Computed</th><th class="num">Reported</th><th class="num">Diff</th><th>Status</th>${
      ch ? html`<th class="num">P&amp;L</th><th class="num">Balance</th><th class="num">Rank</th>` : ''}</tr>
  </thead>
  <tbody>${r.rows.map((x) => html`<tr class="row-${x.level}">
    <td class="mono">${x.date}</td><td class="num">${x.computed_text}</td><td class="num">${x.reported_text}</td><td class="num">${x.diff_text}</td><td>${levelPill(x.level)}</td>
    ${x.challenge ? html`<td class="num">${x.challenge.pnl_text}</td><td class="num">${x.challenge.balance_text}</td><td class="num">${x.challenge.rank_text}</td>` : ''}
  </tr>${x.errors.length > 0 ? html`<tr class="subrow"><td colspan="${ch ? 8 : 5}" class="note">${x.errors.join('; ')}</td></tr>` : ''}`)}</tbody>
</table></div>`;
  return html`<section class="panel" id="p-recon" data-live="recon">
  <h2>Reconciliation <span class="h-sub">last 10 trade dates · trade date rolls 17:00 CT</span></h2>
  ${r.notes.map((n) => html`<p class="note">${levelPill('warn')} ${n}</p>`)}
  ${r.challenge_note ? html`<p class="note">${r.challenge_note}</p>` : ''}
  ${!r.known ? html`<p class="empty">${levelPill('unknown')} ${r.reason}</p>` : r.rows.length === 0 ? html`<p class="empty">${r.reason}</p>` : table}
</section>`;
}

/**
 * Settings form (static between renders). The key is never rendered into HTML; main.mjs sets it.
 * @param {ViewModel} vm
 * @returns {Raw}
 */
export function renderSettings(vm) {
  const s = vm.settings;
  return html`<details class="panel settings" id="p-settings"${s.sheet_configured ? '' : html` open`}>
  <summary><h2>Settings</h2><span class="h-sub">stored only in this browser</span></summary>
  <form id="settings-form" class="form" autocomplete="off" novalidate>
    <label class="field field-wide"><span>Apps Script URL</span><input name="sheet_url" type="url" inputmode="url" spellcheck="false" value="${s.sheet_url}" placeholder="https://script.google.com/macros/s/…/exec"></label>
    <label class="field field-wide"><span>Sheet key</span><input name="sheet_key" type="password" autocomplete="off" spellcheck="false" placeholder="shared secret"></label>
    <label class="field"><span>Watched roots</span><input name="watched_roots" type="text" autocapitalize="characters" spellcheck="false" value="${s.watched_roots_text}"></label>
    <label class="field"><span>Expiry warn (days)</span><input name="expiry_warn_days" type="number" inputmode="numeric" min="0" max="60" step="1" value="${s.expiry_warn_days}"></label>
    <div class="form-actions"><button type="submit" class="btn btn-primary">Save &amp; reload Sheet</button><span class="form-status" data-role="settings-status" aria-live="polite"></span></div>
  </form>
  ${renderRulesInfo(vm)}
</details>`;
}

/**
 * @param {ViewModel} vm
 * @returns {Raw}
 */
export function renderRulesInfo(vm) {
  const r = vm.rulesInfo;
  return html`<div class="rules-info" data-live="rules">
  <h3 class="h3">Challenge rules</h3>
  <p class="note">Source: ${r.source_doc} · rules.json updated ${r.updated_at}. Rules are never inferred.</p>
  ${r.unknown.length === 0 ? html`<p>${levelPill('ok', 'All rules known')}</p>`
    : html`<p>${levelPill('unknown', `${r.unknown.length} UNKNOWN`)}</p><ul class="rule-list">${r.unknown.map((k) => html`<li class="mono">${k}</li>`)}</ul>`}
</div>`;
}

/**
 * The whole app.
 * @param {ViewModel} vm
 * @returns {string}
 */
export function renderApp(vm) {
  return html`<div class="shell" data-build="${BUILD_ID}">
${renderTop(vm)}
${renderBanners(vm.banners)}
<div class="panels">
${renderAccount(vm)}
${renderPositions(vm)}
${renderSizer(vm)}
${renderMarkets(vm)}
${renderCalendar(vm)}
${renderRecon(vm)}
${renderSettings(vm)}
</div>
<footer class="foot">Research and risk tooling only. Read-only: this page never sends trades or instructions to any broker or exchange. Unknown values show UNKNOWN, never zero.</footer>
</div>`.toString();
}

/**
 * Full-page error panel shown when the view model cannot be built at all. Never a blank page.
 * @param {unknown} err
 * @returns {string}
 */
export function renderFatal(err) {
  const msg = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
  return html`<div class="shell" data-build="${BUILD_ID}" data-fatal="1">
<section class="panel panel-fatal" role="alert">
  <h1>Dashboard error</h1>
  <p>${levelPill('breach', 'NO DATA SHOWN')} The dashboard could not compute its view, so every value is UNKNOWN. Do not rely on this page until it recovers.</p>
  <p class="mono note">${msg}</p>
  <p><button type="button" class="btn" data-action="refresh">Retry</button></p>
</section>
</div>`.toString();
}
