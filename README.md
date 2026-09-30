# CME Challenge Dashboard

A phone-first **research and risk** dashboard for a CME futures trading challenge. It never places
orders and never connects to CQG.

- Site: static ES modules in `docs/`, served by GitHub Pages from `main:/docs`
- Data: `jobs/` (Python) refreshed by GitHub Actions → `docs/data/*.json`
- Trade log: Google Sheet → Apps Script JSON endpoint (see `apps_script/README.md`)

See `plan/PLAN.md` for the architecture and `plan/REQUEST.md` for the (reconstructed) requirements.

## Develop
```
npm ci && pip install -r requirements.txt
npm test          # typecheck + node tests + pytest
npm run test:e2e  # headless iPhone-viewport smoke test
```

## Human setup checklist (pre-flight)
1. Paste the official rules into `plan/RULES.md`, then fill `docs/data/rules.json` (each value with `source`).
2. Add repo secret `DATABENTO_API_KEY`.
3. Enable Pages: Settings → Pages → Deploy from branch `main`, folder `/docs`.
4. Create the Sheet (tabs `Trades`, `Daily`, optional `Margins`), deploy `apps_script/Code.gs`, set `SHEET_KEY`.
5. Open the site → Settings → paste the Apps Script `/exec` URL and key (stored only in your browser).
6. Run the `refresh` workflow once manually (`workflow_dispatch`) and check the data chips.
