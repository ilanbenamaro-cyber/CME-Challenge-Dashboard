# Outbox

## Phase 0 recon — 2026-09-30 (build session, sandboxed)

### Facts
- `www.cmegroup.com:443` → CONNECT refused by the build sandbox egress proxy (403, org policy). No HTTP status,
  content-type, rendering mode, robots.txt or terms stance could be observed for the margins, settlements or
  challenge pages.
- Databento Python client 0.87.0 (PyPI) signatures, checked by introspection:
  - `Historical(key=None, gateway=...)`
  - `metadata.get_cost(dataset, start, end=None, mode=..., symbols=None, schema='trades', stype_in='raw_symbol', limit=None) -> float`
  - `timeseries.get_range(dataset, start, end=None, symbols=None, schema='trades', stype_in='raw_symbol', stype_out='instrument_id', limit=None, path=None) -> DBNStore`
- PyPI, npm reachable.

### Unknowns (need a run from an unrestricted network or GitHub Actions)
- All three CME pages: server-rendered vs JS, login wall, robots/terms, table structure.
- Projected Databento cost: `get_cost` requires `DATABENTO_API_KEY`, which is not available in the build session.
  Planned request per hourly run: 4 parent roots × ohlcv-1h × 3 days lookback → expected well under $0.01, UNVERIFIED.
- GitHub Actions cron limits: minimum 5-minute interval, best-effort timing (known; not re-verified via docs here).

### Plan consequence
CME scrapers are written against configurable URLs with defensive parsers and must fail closed (status:error,
last good data kept). The Sheet `Margins` tab is the manual fallback for margins. See PLAN.md risk R1.
