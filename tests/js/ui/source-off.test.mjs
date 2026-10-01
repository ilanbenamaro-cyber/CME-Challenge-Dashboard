// ADR-007: an intentionally switched-off source is grey "OFF", not an amber failure; a real failure stays amber.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildViewModel } from '../../../docs/js/ui/viewmodel.mjs';
import { renderApp } from '../../../docs/js/ui/render.mjs';
import { inputs, NOW } from './fixtures.mjs';

/** @param {string[]} errors */
const errEnv = (errors) => /** @type {any} */ ({
  schema_version: 1, dataset: 'settlements', generated_at: new Date(NOW).toISOString(), data_as_of: null,
  source: 'test', status: 'error', errors, data: null,
});

test('source not configured -> grey OFF chip and an unknown-level note, no amber banner', () => {
  const base = inputs();
  const vm = buildViewModel({ ...base, envs: { ...base.envs, settlements: errEnv(['source not configured (settlements url_template/products in jobs/config/sources.json)']) } });
  const chip = vm.chips.find((c) => c.name === 'settlements');
  assert.equal(chip?.off, true);
  assert.equal(chip?.level, 'unknown');
  const b = vm.banners.filter((x) => x.title.startsWith('settlements'));
  assert.deepEqual(b.map((x) => [x.level, x.title]), [['unknown', 'settlements OFF']]);
  assert.match(renderApp(vm), /<span class="chip-state">OFF<\/span>/);
});

test('a real job failure stays an amber ERROR', () => {
  const base = inputs();
  const vm = buildViewModel({ ...base, envs: { ...base.envs, settlements: errEnv(['HTTP 403 from www.cmegroup.com']) } });
  const chip = vm.chips.find((c) => c.name === 'settlements');
  assert.equal(chip?.off, false);
  assert.equal(chip?.level, 'warn');
  assert.deepEqual(vm.banners.filter((x) => x.title.startsWith('settlements')).map((x) => [x.level, x.title]), [['warn', 'settlements ERROR']]);
});
