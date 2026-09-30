// FROZEN INTERFACE (G1). Planner-owned. Changes require an ADR in .workflows/_shared/outbox.md.
// Type-only module: no runtime exports besides the marker below.

/** @typedef {'ok'|'warn'|'breach'|'unknown'} Level */

/** @typedef {'fresh'|'stale'|'partial'|'error'|'missing'|'invalid'} FreshState */

/** @typedef {'bars'|'settlements'|'margins'|'challenge'|'calendar'} DatasetName */

/**
 * D7 envelope written by every job.
 * @template T
 * @typedef {object} Envelope
 * @property {1} schema_version
 * @property {string} dataset
 * @property {string} generated_at   ISO-8601 UTC, time of the job run
 * @property {string|null} data_as_of ISO-8601 UTC, validity time of `data` (last good); null if never succeeded
 * @property {string} source          human-readable source (URL or "databento:GLBX.MDP3 ohlcv-1h")
 * @property {'ok'|'partial'|'error'} status
 * @property {string[]} errors
 * @property {T|null} data            null only if the job has never succeeded
 */

/**
 * @typedef {object} ContractSpec
 * @property {string} root            e.g. "ES", "MES"
 * @property {string} name
 * @property {number} tick_size       price units per tick, e.g. 0.25
 * @property {number} tick_value_usd  USD per tick per contract, e.g. 12.5
 * @property {string|null} parent     standard root for a micro (bars alias), else null
 * @property {'quarterly_third_friday'|'manual'} expiry_rule
 * @property {string} months          listed contract month codes, e.g. "HMUZ" or "FGHJKMNQUVXZ"
 * @property {string} source
 */

/**
 * @typedef {object} ContractsFile
 * @property {1} schema_version
 * @property {ContractSpec[]} contracts
 */

/**
 * A rule value is known iff `value !== null`.
 * @template V
 * @typedef {{value: V|null, source: string|null, note?: string}} Rule
 */

/**
 * @typedef {object} RuleSet
 * @property {Rule<number>} starting_balance_usd
 * @property {Rule<number>} daily_loss_cap_usd
 * @property {Rule<number>} max_drawdown_usd
 * @property {Rule<number>} max_contracts
 * @property {Rule<number>} micro_to_standard_ratio
 * @property {Rule<string>} flatten_time_ct          "HH:MM" 24h, America/Chicago
 * @property {Rule<{intraday: number|null, overnight: number|null, weekend: number|null}>} hold_margin_multipliers
 * @property {Rule<'initial'|'maintenance'>} margin_basis
 * @property {Rule<string[]>} allowed_roots
 * @property {Rule<string>} challenge_start_date
 * @property {Rule<string>} challenge_end_date
 */

/**
 * @typedef {object} RulesFile
 * @property {1} schema_version
 * @property {string} updated_at
 * @property {string} source_doc
 * @property {RuleSet} rules
 */

/** @typedef {'intraday'|'overnight'|'weekend'} Hold */

/**
 * Row of the Sheet `Trades` tab after io normalisation.
 * @typedef {object} Trade
 * @property {string} id
 * @property {string} root
 * @property {'long'|'short'} side
 * @property {number} qty             positive integer
 * @property {number} entry
 * @property {number|null} exit       null = open
 * @property {string} entry_time      ISO-8601 with offset
 * @property {string|null} exit_time
 * @property {number} fees_usd        total round-turn fees for the row, >= 0
 * @property {string} [notes]
 */

/** @typedef {{date: string, reported_pnl_usd: number|null, reported_balance_usd: number|null}} DailyRow */

/** @typedef {{root: string, initial_usd: number|null, maintenance_usd: number|null, as_of: string|null}} MarginRow */

/**
 * @typedef {object} SheetData
 * @property {Trade[]} trades
 * @property {DailyRow[]} daily
 * @property {MarginRow[]} margins
 */

/** @typedef {{t: string, o: number, h: number, l: number, c: number, v: number}} Bar  t = ISO-8601 UTC bar open */

/** @typedef {{roots: Record<string, {symbol: string, bars: Bar[]}>, aliases: Record<string, string>, cost_usd: number}} BarsData */

/** @typedef {{rows: {root: string, contract_code: string, settle: number, trade_date: string}[]}} SettlementsData */

/** @typedef {{rows: MarginRow[]}} MarginsData */

/** @typedef {{rows: {date: string, account: string, pnl_usd: number|null, balance_usd: number|null, rank: number|null}[]}} ChallengeData */

/**
 * @typedef {object} CalendarEvent
 * @property {string} date      YYYY-MM-DD (CT)
 * @property {string|null} time_ct "HH:MM" or null (all-day / unknown)
 * @property {string} title
 * @property {'high'|'medium'|'low'} impact
 * @property {string} source
 */

/** @typedef {{root: string, contract_code: string, date: string, source: string}} ExpirationEntry */

/** @typedef {{events: CalendarEvent[], expirations: ExpirationEntry[]}} CalendarData */

/**
 * @typedef {object} PnlCents
 * @property {number} gross_cents
 * @property {number} fees_cents
 * @property {number} net_cents
 */

/**
 * @typedef {object} SizerInput
 * @property {ContractSpec} spec
 * @property {number} risk_budget_usd
 * @property {number} stop_ticks                positive integer
 * @property {number} fee_per_contract_usd      round-turn, >= 0
 * @property {number|null} available_margin_usd
 * @property {number|null} margin_per_contract_usd  exchange margin on the rules' margin_basis, before hold multiplier
 * @property {Hold} hold
 * @property {RuleSet} rules
 */

/**
 * @typedef {object} SizerResult
 * @property {'ok'|'unknown'|'zero'} status   zero = inputs known but no contract fits
 * @property {number|null} contracts          null iff status === 'unknown'
 * @property {'risk'|'margin'|'max_contracts'|null} binding  tightest limit; ties resolve risk > margin > max_contracts
 * @property {number} per_contract_risk_cents stop_ticks*tick_value_cents + fee cents
 * @property {{risk: number|null, margin: number|null, max_contracts: number|null}} limits
 * @property {string[]} reasons               why unknown/zero; empty when ok
 */

/**
 * @typedef {object} Meter
 * @property {Level} level
 * @property {number|null} used_ratio
 * @property {number|null} used_cents
 * @property {number|null} limit_cents
 * @property {number|null} remaining_cents
 * @property {string} reason
 */

/**
 * @typedef {object} Freshness
 * @property {FreshState} state
 * @property {number|null} age_min
 * @property {string} reason
 */

/** @typedef {{kind: 'daily'} | {kind: 'intraday', max_age_min: number}} FreshPolicy */

/**
 * @typedef {object} Banner
 * @property {Level} level
 * @property {string} message
 * @property {number|null} value   minutes_left (flatten) / days_left (expiry)
 */

/**
 * @typedef {object} ReconRow
 * @property {string} date
 * @property {number|null} computed_cents
 * @property {number|null} reported_cents
 * @property {number|null} diff_cents   computed - reported
 * @property {Level} level              ok = |diff| <= 1 cent; warn = mismatch; unknown = either side missing/erroneous
 * @property {string[]} errors
 */

export const TYPES_VERSION = 1;
