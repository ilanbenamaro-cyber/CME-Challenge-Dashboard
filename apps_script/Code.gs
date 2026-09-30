/**
 * CME Challenge Dashboard: read-only JSON endpoint over the trade-log Google Sheet (D6).
 *
 * GET <web app /exec URL>?key=<SHEET_KEY>
 *   -> {schema_version: 1, generated_at, tabs: {Trades: [...], Daily: [...], Margins?: [...]}}
 *   -> {error: "unauthorized"} when the key is absent or wrong.
 *
 * Response shape: plan/schemas/sheet.schema.json. Cells are passed through raw: blank cells are "",
 * and the dashboard (docs/js/io/sheet.mjs) validates and coerces them. This script never writes to the Sheet.
 */

var REQUIRED_TABS = ['Trades', 'Daily'];
var OPTIONAL_TABS = ['Margins'];
var TZ = 'America/Chicago';
var DATETIME_FMT = "yyyy-MM-dd'T'HH:mm:ssXXX";
var DATE_FMT = 'yyyy-MM-dd';

function doGet(e) {
  var provided = e && e.parameter && typeof e.parameter.key === 'string' ? e.parameter.key : '';
  var expected = PropertiesService.getScriptProperties().getProperty('SHEET_KEY') || '';
  if (!expected || !provided || !constantTimeEquals_(provided, expected)) {
    return json_({ error: 'unauthorized' });
  }
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var tabs = {};
    REQUIRED_TABS.forEach(function (name) {
      var sheet = ss.getSheetByName(name);
      if (!sheet) throw new Error('missing tab ' + name);
      tabs[name] = readTab_(sheet, name);
    });
    OPTIONAL_TABS.forEach(function (name) {
      var sheet = ss.getSheetByName(name);
      if (sheet) tabs[name] = readTab_(sheet, name);
    });
    return json_({
      schema_version: 1,
      generated_at: Utilities.formatDate(new Date(), TZ, DATETIME_FMT),
      tabs: tabs,
    });
  } catch (err) {
    return json_({ error: 'read failed: ' + String(err && err.message ? err.message : err) });
  }
}

/**
 * Header row -> keys; one object per non-empty data row.
 * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet
 * @param {string} tabName
 * @return {Object[]}
 */
function readTab_(sheet, tabName) {
  var values = sheet.getDataRange().getValues();
  if (values.length < 2) return [];
  var header = values[0].map(function (h) { return String(h).trim(); });
  var rows = [];
  for (var r = 1; r < values.length; r++) {
    var row = values[r];
    var blank = row.every(function (c) { return c === '' || c === null; });
    if (blank) continue;
    var obj = {};
    for (var c = 0; c < header.length; c++) {
      var key = header[c];
      if (!key) continue;
      obj[key] = cell_(row[c], tabName === 'Daily' && key === 'date');
    }
    rows.push(obj);
  }
  return rows;
}

/**
 * Raw cell -> JSON value. Dates become ISO-8601 with offset (America/Chicago); Daily.date becomes yyyy-MM-dd.
 * Blank stays "" (never 0).
 */
function cell_(value, dateOnly) {
  if (value === null || value === undefined) return '';
  if (Object.prototype.toString.call(value) === '[object Date]') {
    if (isNaN(value.getTime())) return '';
    return Utilities.formatDate(value, TZ, dateOnly ? DATE_FMT : DATETIME_FMT);
  }
  return value;
}

/**
 * Compare two strings in time independent of where they differ, by comparing SHA-256 digests byte by byte.
 */
function constantTimeEquals_(a, b) {
  var da = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, a, Utilities.Charset.UTF_8);
  var db = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, b, Utilities.Charset.UTF_8);
  var diff = da.length ^ db.length;
  for (var i = 0; i < da.length && i < db.length; i++) {
    diff |= da[i] ^ db[i];
  }
  return diff === 0;
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
