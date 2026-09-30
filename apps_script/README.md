# Apps Script: Sheet endpoint (D6)

A read-only web app that returns the trade-log Sheet as JSON for the dashboard. The response shape is
`plan/schemas/sheet.schema.json`. The script never writes to the Sheet, and it has nothing to do with any
broker: it only reads your own log.

## Sheet layout

The first row of each tab is the header. The column names must match exactly.

| Tab | Columns |
|---|---|
| `Trades` | `id, root, side, qty, entry, exit, entry_time, exit_time, fees_usd, notes` |
| `Daily` | `date, reported_pnl_usd, reported_balance_usd` |
| `Margins` (optional) | `root, initial_usd, maintenance_usd, as_of` |

Set the spreadsheet time zone (File → Settings) to **America/Chicago**. Date cells are formatted in that zone,
and a date-only cell (e.g. `Daily.date`) could shift by a day if the spreadsheet uses another zone.

## Deploy

1. Open the Sheet, then go to **Extensions → Apps Script**.
2. Replace `Code.gs` with `apps_script/Code.gs`. In **Project Settings**, tick "Show appsscript.json" and
   replace it with `apps_script/appsscript.json`.
3. **Project Settings → Script Properties → Add property**: name `SHEET_KEY`, value a long random string
   (e.g. 32+ characters from a password manager). This is the shared secret.
4. **Deploy → New deployment → Web app**:
   - Execute as: **Me**
   - Who has access: **Anyone**
5. Authorise when prompted. The manifest asks only for read access to spreadsheets
   (`spreadsheets.readonly`). If Google rejects that scope for your setup, remove the `oauthScopes` block
   and re-authorise. The code still performs reads only.
6. Copy the **/exec** URL.
7. In the dashboard, open **Settings** and paste the /exec URL and the `SHEET_KEY` value. They are stored in
   the browser's `localStorage` only.

**Never commit the /exec URL or the key to this repository.** The boundary tests scan for both.

## Check it

Open `<exec URL>?key=<your key>` in a browser. You should see `{"schema_version":1,...}`. With a wrong or
missing key you should see `{"error":"unauthorized"}`.

## Notes

- The web app answers at `script.google.com` and then redirects to `script.googleusercontent.com`. The site
  CSP must allow both in `connect-src`.
- The dashboard fetches with a plain GET and no custom headers. That avoids a CORS preflight, which Apps
  Script does not answer.
- After editing `Code.gs`, use **Deploy → Manage deployments → Edit → New version**, or the /exec URL keeps
  serving the old code.
- To rotate the key, change the `SHEET_KEY` Script Property and update the dashboard settings. No redeploy is needed.
