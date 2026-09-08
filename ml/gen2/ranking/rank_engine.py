from __future__ import annotations

from pathlib import Path

import pandas as pd

from gen2.baseline.leadership_score import build_rank_results
from gen2.data.loader import GEN2_ROOT, load_gen2_config
from gen2.features.build_features import build_feature_matrix


def run_rank_engine(features: pd.DataFrame | None = None, weights: dict | None = None) -> pd.DataFrame:
    cfg = load_gen2_config()
    features = features if features is not None else build_feature_matrix()
    return build_rank_results(features, benchmark_code=cfg["data"].get("benchmark_code", "510300"), weights=weights)


def write_daily_rankings(output_path: str | Path | None = None) -> Path:
    rankings = run_rank_engine()
    out = Path(output_path) if output_path else GEN2_ROOT / "outputs" / "daily_rankings.csv"
    out.parent.mkdir(parents=True, exist_ok=True)
    rankings.to_csv(out, index=False)
    return out


if __name__ == "__main__":
    path = write_daily_rankings()
    print(f"OK: {path}")
