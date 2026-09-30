# Official Challenge Rules

> **HUMAN ACTION REQUIRED (pre-flight step 3):** paste the official challenge rules below, verbatim, with
> the URL and the retrieval date. Then copy each numeric/time rule into `docs/data/rules.json` with a
> `source` that quotes the section. Until then every rule in `rules.json` is `null`, and the dashboard
> shows it as UNKNOWN on purpose.

Source URL: _(paste)_
Retrieved: _(date)_

## Rules text

_(paste here)_

## Rule → rules.json mapping checklist

| rules.json key | Meaning | Unit | Filled? |
|---|---|---|---|
| `starting_balance_usd` | Account starting balance | USD | ☐ |
| `daily_loss_cap_usd` | Max loss in one trade date (realized + open) | USD, positive | ☐ |
| `max_drawdown_usd` | Max drawdown from peak balance | USD, positive | ☐ |
| `max_contracts` | Max open contracts (standard-equivalent) | contracts | ☐ |
| `micro_to_standard_ratio` | How many micros count as one standard contract | number | ☐ |
| `flatten_time_ct` | Positions must be flat by this CT time | `HH:MM` | ☐ |
| `hold_margin_multipliers` | Margin multiplier per hold type | `{intraday, overnight, weekend}` | ☐ |
| `margin_basis` | Which exchange margin the challenge uses | `initial`/`maintenance` | ☐ |
| `allowed_roots` | Tradable products | array of roots | ☐ |
| `challenge_start_date` / `challenge_end_date` | Challenge window | `YYYY-MM-DD` | ☐ |
