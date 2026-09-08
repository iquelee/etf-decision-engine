from __future__ import annotations

import json
from datetime import date
from pathlib import Path
from typing import Iterable

import pandas as pd

from gen2.data.schema import normalize_daily_bars, validate_daily_bars
from gen2.ranking.types import UniverseRecord

PROJECT_ROOT = Path(__file__).resolve().parents[3]
GEN2_ROOT = PROJECT_ROOT / "ml" / "gen2"


def load_json_config(path: str | Path) -> dict:
    """Load JSON-compatible YAML config (stdlib only)."""
    p = Path(path)
    if not p.is_absolute():
        p = GEN2_ROOT / p
    with p.open("r", encoding="utf-8") as f:
        return json.load(f)


def load_gen2_config() -> dict:
    return load_json_config("config/gen2.yaml")


def _bool(v) -> bool:
    if isinstance(v, bool):
        return v
    return str(v).strip().lower() in {"1", "true", "yes", "y"}


def load_universe_records(master_path: str | Path | None = None) -> dict[str, UniverseRecord]:
    path = Path(master_path) if master_path else GEN2_ROOT / "universe" / "etf_master.csv"
    if not path.is_absolute():
        path = PROJECT_ROOT / path
    df = pd.read_csv(path, dtype={"code": str})
    records: dict[str, UniverseRecord] = {}
    for row in df.to_dict("records"):
        code = str(row["code"]).zfill(6)
        records[code] = UniverseRecord(
            code=code,
            name=str(row.get("name", "")),
            asset_class=str(row.get("asset_class", "")),
            sector=str(row.get("sector", "")),
            theme=str(row.get("theme", "")),
            correlation_cluster=str(row.get("correlation_cluster", "")),
            listing_date=pd.to_datetime(row["listing_date"]).date(),
            benchmark_code=str(row.get("benchmark_code", "510300")).zfill(6),
            strategic_role_hint=str(row.get("strategic_role_hint", "")),
            incumbent=_bool(row.get("incumbent", 0)),
            challenger=_bool(row.get("challenger", 0)),
            tradable=_bool(row.get("tradable", 0)),
            research_only=_bool(row.get("research_only", 0)),
            core_eligible=_bool(row.get("core_eligible", 0)),
            liquidity_tier=str(row.get("liquidity_tier", "unknown")),
            gen1_category=str(row.get("gen1_category", "")),
            gen1_category_coverage=str(row.get("gen1_category_coverage", "")),
            gen1_domain_status=str(row.get("gen1_domain_status", "OUT_OF_DOMAIN")),
            notes=str(row.get("notes", "")),
        )
    return records


def load_universe_definition(path: str | Path | None = None) -> dict:
    # 单一事实源：默认读 config 的 universe.definition_file，而非硬编码 dev_universe_v0。
    if path is None:
        cfg = load_gen2_config()
        path = cfg["universe"].get("definition_file", "universe/dev_universe_v0.json")
    p = Path(path)
    if not p.is_absolute():
        p = GEN2_ROOT / p
    return json.loads(p.read_text(encoding="utf-8"))


def load_daily_bars(
    codes: Iterable[str] | None = None,
    daily_dir: str | Path | None = None,
    validate: bool = True,
) -> pd.DataFrame:
    """Load local qfq CSV daily bars and normalize to Gen-2 schema."""
    cfg = load_gen2_config()
    d = Path(daily_dir) if daily_dir else PROJECT_ROOT / cfg["data"]["daily_dir"]
    if not d.is_absolute():
        d = PROJECT_ROOT / d
    if codes is None:
        universe = load_universe_definition()
        codes = [*universe["eligible_codes"], universe["benchmark_code"]]

    frames = []
    for code in codes:
        code = str(code).zfill(6)
        matches = sorted(d.glob(f"{code}_*.csv"))
        if not matches:
            raise FileNotFoundError(f"daily csv not found for {code} in {d}")
        raw = pd.read_csv(matches[0], encoding="utf-8-sig")
        frames.append(normalize_daily_bars(raw, code=code, source="local_csv_qfq"))
    out = pd.concat(frames, ignore_index=True).sort_values(["code", "trade_date"]).reset_index(drop=True)
    if validate:
        validate_daily_bars(out)
    return out


def point_in_time_eligible(
    record: UniverseRecord,
    as_of: date,
    history_days: int,
    min_history_days: int = 120,
) -> tuple[bool, str]:
    """PIT eligibility: only facts knowable at as_of may be used."""
    if record.listing_date > as_of:
        return False, "NOT_LISTED"
    if not record.tradable:
        return False, "NOT_TRADABLE"
    if not record.core_eligible:
        return False, "NOT_CORE_ELIGIBLE"
    if record.research_only:
        return False, "RESEARCH_ONLY"
    if history_days < min_history_days:
        return False, "INSUFFICIENT_HISTORY"
    return True, "ELIGIBLE"


def active_universe_on(bars: pd.DataFrame, records: dict[str, UniverseRecord], as_of: date, min_history_days: int = 120) -> dict[str, str]:
    upto = bars[bars["trade_date"] <= as_of]
    counts = upto.groupby("code").size().to_dict()
    result: dict[str, str] = {}
    for code, rec in records.items():
        ok, reason = point_in_time_eligible(rec, as_of, int(counts.get(code, 0)), min_history_days)
        result[code] = reason if ok else reason
    return result
