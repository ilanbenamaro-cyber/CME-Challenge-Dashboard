# Official Challenge Rules

**2026 CME Group University Trading Challenge — Competition Rules, Regulations and Requirements**

Source URL: https://www.cmegroup.com/events/university-trading-challenge/files/2026-university-trading-challenge-rules-regulations.pdf
Retrieved: 2026-10-01 (PDF provided by Ilan; CME blocks automated download, ADR-007)

Verbatim excerpts of the rule-bearing pages only (© 2026 CME Group, "CME GROUP PUBLIC"). The full PDF is authoritative.

## Competition Dates (p6)

```
Competition Dates
Trading hours vary per contract. Please refer to contract specifications for open and closing times.

PRACTICE / REGISTRATION PERIOD
• Teams will be given a trading login after their registration has been confirmed so that they can become familiar with the
  CQG software. All account balances will reset before the live competition begins.
• We suggest that all team members log into the software before the live competition begins. This is your
  opportunity to explore use of the software prior to the competition opening.
LIVE COMPETITION
• Begins Sunday, October 4 at 5:00 p.m. CT
• Concludes Friday, October 30 at 4:00 p.m. CT


The top five *eligible teams receive a cash prize and are determined by the final account balance at the conclusion of
trading. All open contract commissions and penalties will be calculated and applied to determine final balance.
Eligibility to receive competition prizes is only open to residents in the United States (US), Canada (CA) excluding
Quebec, United Kingdom (UK), Germany (DE), Netherlands (NL), Switzerland (CH), Republic of Korea (KR), Taiwan (TW),
and Japan (JP).
```

## Competition Contracts (p7)

```
Competition Contracts

Teams will be able to trade all the supported CME Group futures products through CME Globex on CQG’s trading
applications during the competition.
CME Globex is an open access marketplace that allows you to directly enter your own trades and participate in the trading
process, including viewing the book of orders and real-time price data. To access CME Globex, participants will use
CQG’s CME Group certified trading applications and connectivity.
Competition products are not limited to specific contract months. Teams are responsible to be aware of first notice day and
expiration days. View our product and expiration browser here. Teams are penalized $1,000 for each contract not
liquidated by expiration. All profits for these trades are expunged.


View the CME Group product slate here: https://www.cmegroup.com/markets/products.html
```

## General Rules for Trading (p9)

```
General Rules for Trading
• Beginning account balances: - $1,000,000
• Teams are required to execute at least 10 contracts per day in one competition product or a combination of the competition products. Daily
  required minimum is 10 contracts, can be an entry (long or short) or an exit. It can also be any combination of 10 contracts which can result in
  open positions. Note: this means team volume traded each day must be a minimum of 10 contracts. If a spread trade is made in one of the
  exchange traded spreads, volume is the number of those spread contracts traded.
• We are accepting calendar spread trading when the spread is an exchange traded spread. Syntax for the spreads are symbols followed by S1
  for calendar spreads and W1 for reverse calendar spreads followed by the first month of the spread. For Example: CLES1V20 is buying the
  October Crude Oil Futures contract and selling the November Crude Oil Futures contract. Calendar spreads always buy the front month and sell
  the back month. The calendar spread symbols are CLES1, NGES1, GCES1, ZCES1, ZSES1, GLES1, MPOS1. Reverse calendar spreads
  always sell the front month and buy the back months. The reverse calendar spreads symbols are EPW1 and EU6W1.The system will
  automatically offset the margin on the position. All accounts should maintain proper margin at all times. Margin rates may fluctuate during the
  competition. Rates are available at CME Group's Performance Bonds/Margins FAQ. Note: if a spread is “legged” the position will be margined
  as if it was two separate positions.
• The number of contracts traded is limited to the margin requirements posted in the rules.
• A commission of $2.50 is charged per traded contract per side.
• If a team loses 20% of its available account balance in one day, the account is locked for the remainder of the trading day.
• All accounts should maintain proper margin at all times. Margin rates may fluctuate during the competition. Rates are available at
  http://www.cmegroup.com/clearing/cme-clearing-overview/performance-bonds.html
• If a team’s available balance drops below the required margin level, only orders that reduce or exit a position will be accepted.
• On the last day of the competition, teams must have all positions closed 15 minutes prior to the market close or they will be auto-liquidated by
  the system
• Algorithmic trading is not permitted.

PLEASE NOTE: Any errors, omissions, or discrepancies in competition related materials and team trading activity that occur before, during or after
the competition are subject to resolution by CME Group and CQG only. No exceptions.
```

## Penalties (p10)

```
Penalties

• Teams are penalized $1,000 per trading day for every day they execute less than 10 contracts.

• Teams are penalized $1,000 for each contract not liquidated by expiration. All profits for these trades are expunged. \

Open Position Penalty Policy

• Teams will be penalized $1,000 per open contract, plus commissions, for any positions still open 15 minutes prior to the
  close of market on the last day of the competition. Any remaining open positions will be automatically liquidated.
```

## Challenge Specific Definitions (p13)

```
• Trade – Teams are required to execute at least 10 contracts per day in one competition product or a combination of the
  competition products. Daily required minimum is 10 contracts, can be an entry (long or short) or an exit. It can also be
  any combination of 10 contracts which can result in open positions. Teams are penalized $1,000 per trading day for
  every day they execute less than 10 contracts. Note: this means team volume traded each day must be a minimum of
  10 contracts.

• Open equity – the unrealized gain or loss of an open position.

• Marked to market – Calculating the total equity or open equity based on the most recent day’s settlement price. The
  settlement price is not the last trade of day.

• Daily account value – based on the closed trades at the end of the day and does not reflect open trade equity of
  positions.

• Commission – $2.50 per contract side (= $5.00 per trade). When trading the required ten contracts per day the
  account will be charged a minimum of $25.00 commission per day.
```

## Rule → rules.json mapping

| rules.json key | Value | From |
|---|---|---|
| `starting_balance_usd` | 1,000,000 | p9 |
| `daily_loss_cap_pct` | 0.20 of prior trade date's closing balance | p9 (base chosen by Ilan) |
| `daily_loss_cap_usd` | not a rule (`applies:false`) | — |
| `max_drawdown_usd` | not a rule | — |
| `max_contracts`, `micro_to_standard_ratio` | not a rule (margin-limited) | p9 |
| `flatten_time_ct` / `flatten_dates` | 15:45 CT on 2026-10-30 only | p6, p9, p10 |
| `hold_margin_multipliers` | 1 / 1 / 1 | p9 (no hold distinction) |
| `margin_basis` | initial | rules silent; chosen by Ilan |
| `allowed_roots` | not a rule (all supported products) | p7 |
| `min_contracts_per_day` | 10 (entries + exits) | p9, p10, p13 |
| `commission_per_side_usd` | 2.50 | p9 |
| `challenge_start_date` / `challenge_end_date` | 2026-10-04 (Sun 17:00 CT) / 2026-10-30 (16:00 CT) | p6 |
