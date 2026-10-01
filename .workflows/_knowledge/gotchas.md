# Gotchas

- `bash ~/.claude/memory.sh` prints a stale ASTROPHYSICS narrative. Ignore it for this project.
- Float prices: 78.43/0.01 = 7842.999…; always Math.round to ticks and check the residual (money.priceToTicks).
- CME trade date rolls at 17:00 CT; Friday evening / weekend activity belongs to Monday.
- America/Chicago DST: never hard-code -05:00. Use Intl with timeZone 'America/Chicago'.
- Third-Friday expiry is holiday-unadjusted (e.g. 2026-06-19 is Juneteenth). Override in calendar.json when needed.
- Build-session recon: www.cmegroup.com CONNECT was refused by the sandbox proxy (403). Nothing about CME page
  structure was verified. Treat CME parsers as UNVERIFIED until a real Actions run succeeds.
- CME website is behind bot protection; GitHub Actions IPs may get 403. Jobs must degrade to status:error and keep last good data.
- GitHub cron is best-effort (delays of 5–30 min are normal; schedules can be skipped under load).
- Re-running a workflow replays the ORIGINAL commit; after editing a workflow use `gh workflow run refresh.yml`.
- Apps Script web apps redirect script.google.com → script.googleusercontent.com; CSP connect-src needs both.
- Apps Script: fetch with a simple GET (no custom headers) to avoid a CORS preflight, which Apps Script does not answer.
- Bars marks use Databento `<ROOT>.c.0` (front month by calendar). During the roll window a held back-month contract is
  mis-marked by the calendar spread × multiplier × qty. The UI labels marks "front-month continuous" (G3 P1-5).
- Daily-loss = −(realized today + open P&L since entry) over-counts for positions held overnight; the challenge's real
  definition (vs prior settle?) must come from RULES.md. Labelled as an assumption in the UI (G3 P1-7).
- Flatten banner is anchored to the CME trade date: between 15:10 and 17:00 CT it breaches; at 17:00 it rolls to the next day.
- CME website (www.cmegroup.com) blocks GitHub Actions IPs (Akamai 403) and its Data Terms of Use prohibit automated access.
  Do not scrape it. Official rules PDFs must be downloaded by a human in a browser (ADR-007).
