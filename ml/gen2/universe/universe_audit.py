from __future__ import annotations

import json
from pathlib import Path

import pandas as pd

from gen2.data.loader import GEN2_ROOT, load_daily_bars, load_universe_records


def audit_universe() -> dict:
    records = load_universe_records()
    master_path = GEN2_ROOT / "universe" / "etf_master.csv"
    df = pd.read_csv(master_path, dtype={"code": str})
    result = {
        "master_path": str(master_path),
        "n_records": len(records),
        "duplicate_code_count": int(df["code"].duplicated().sum()),
        "missing_required": {},
        "clusters": {},
        "gen1_domain_status_counts": {},
        "checks": {},
    }
    required = ["code", "name", "asset_class", "sector", "theme", "listing_date", "correlation_cluster", "tradable", "core_eligible", "gen1_domain_status"]
    for col in required:
        result["missing_required"][col] = int(df[col].isna().sum())
    result["clusters"] = df.groupby("correlation_cluster")["code"].apply(list).to_dict()
    result["gen1_domain_status_counts"] = df["gen1_domain_status"].value_counts().to_dict()
    result["checks"]["unique_code"] = result["duplicate_code_count"] == 0
    result["checks"]["required_fields_present"] = all(v == 0 for v in result["missing_required"].values())
    result["checks"]["benchmark_research_only"] = bool(df.loc[df["code"] == "510300", "research_only"].iloc[0] == 1)
    result["checks"]["pass"] = all(result["checks"].values())
    return result


def write_universe_audit(output_path: str | Path | None = None) -> Path:
    result = audit_universe()
    out = Path(output_path) if output_path else GEN2_ROOT / "outputs" / "universe_audit_v0.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(result, ensure_ascii=False, indent=2, default=str), encoding="utf-8")
    return out


if __name__ == "__main__":
    path = write_universe_audit()
    print(f"OK: {path}")
