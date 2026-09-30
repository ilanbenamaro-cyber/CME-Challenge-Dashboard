"""Run the refresh jobs: python -m jobs.refresh [--only a,b] [--dry-run] [--data-dir DIR]

Each job runs in isolation: one failing job never blocks the others. Every envelope is schema-validated
before its atomic write (jobs.common.publish). Exit code is 0 unless a write itself fails.
--dry-run uses SYNTHETIC fixtures and a fake Databento client (no network, no key). It writes to a fresh
temp dir unless --data-dir is given, and refuses to write into docs/data so fixture numbers can never
be committed as real data.
"""
from __future__ import annotations

import argparse
import sys
import tempfile
from datetime import datetime
from pathlib import Path
from typing import Callable

from jobs import fetch_bars, fetch_challenge, fetch_margins, fetch_settlements, validate_calendar
from jobs.common import config
from jobs.common.envelope import failure_envelope, load_previous, utc_now
from jobs.common.publish import publish, safe_error

Runner = Callable[[datetime, Path, bool], dict]

RUNNERS: dict[str, Runner] = {
    "bars": lambda now, out, dry: fetch_bars.run(now, out, dry_run=dry),
    "settlements": lambda now, out, dry: fetch_settlements.run(now, out, dry_run=dry),
    "margins": lambda now, out, dry: fetch_margins.run(now, out, dry_run=dry),
    "challenge": lambda now, out, dry: fetch_challenge.run(now, out, dry_run=dry),
}
SOURCES = {
    "bars": fetch_bars.SOURCE,
    "settlements": fetch_settlements.SOURCE,
    "margins": fetch_margins.SOURCE,
    "challenge": fetch_challenge.SOURCE,
}
ALL = [*RUNNERS, "calendar"]


def _summary(name: str, env: dict) -> str:
    errs = env.get("errors") or []
    first = f" first_error={errs[0]!r}" if errs else ""
    return f"{name}: {env.get('status')} data_as_of={env.get('data_as_of')} errors={len(errs)}{first}"


def run_all(names: list[str], data_dir: Path, dry_run: bool, now: datetime | None = None,
            print_fn: Callable[[str], None] = print) -> int:
    now = utc_now() if now is None else now
    write_failed = False
    for name in names:
        if name == "calendar":
            print_fn(_summary(name, validate_calendar.run(now)))
            continue
        out = data_dir / f"{name}.json"
        try:
            env = RUNNERS[name](now, out, dry_run)
        except Exception as exc:  # noqa: BLE001 - isolate: a crashed job becomes a failure envelope
            source = "SYNTHETIC dry-run" if dry_run else SOURCES[name]
            previous = load_previous(out)
            failure = failure_envelope(name, source, previous, [f"job crashed: {safe_error(exc)}"], now)
            try:
                env = publish(name, source, failure, out, previous, now)
            except Exception as write_exc:  # noqa: BLE001
                write_failed = True
                print_fn(f"{name}: WRITE FAILED {safe_error(write_exc)}")
                continue
        print_fn(_summary(name, env))
    return 1 if write_failed else 0


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="python -m jobs.refresh", description=__doc__.splitlines()[0])
    ap.add_argument("--only", help=f"comma-separated subset of: {','.join(ALL)}")
    ap.add_argument("--dry-run", action="store_true", help="SYNTHETIC fixtures, fake Databento, no network")
    ap.add_argument("--data-dir", type=Path, help="output directory (default docs/data; dry run: a temp dir)")
    args = ap.parse_args(argv)

    names = ALL if not args.only else [n.strip() for n in args.only.split(",") if n.strip()]
    unknown = [n for n in names if n not in ALL]
    if unknown or not names:
        ap.error(f"unknown dataset(s): {', '.join(unknown) or '<none>'}; choose from {','.join(ALL)}")

    if args.dry_run:
        if args.data_dir is None:
            args.data_dir = Path(tempfile.mkdtemp(prefix="cme-dry-run-"))
        if args.data_dir.resolve() == config.DEFAULT_DATA_DIR.resolve():
            ap.error("--dry-run refuses to write SYNTHETIC data into docs/data")
        print(f"dry run: writing to {args.data_dir}")
    data_dir = args.data_dir or config.DEFAULT_DATA_DIR
    try:
        data_dir.mkdir(parents=True, exist_ok=True)
    except OSError as exc:
        print(f"cannot create data dir: {safe_error(exc)}")
        return 1
    return run_all(names, data_dir, args.dry_run)


if __name__ == "__main__":
    sys.exit(main())
