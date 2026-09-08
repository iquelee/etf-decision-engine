"""Gen-2 跨语言 Parity —— Python 端 runner。

对 fixtures/gen2/parity_fixture.json 跑与 Node 等价的决策链：
  评分(leadership/alpha) → 排名(alpha desc, code asc) → 角色状态机(build_v2_roles) → 防守(apply_regime_defense)
输出 canonical JSON（与 scripts/parity/run_node.js 对齐），供 compare.py 逐字段比对。

运行：PYTHONPATH=ml python scripts/parity/run_python.py [fixture.json]
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "ml"))

from gen2.baseline.alpha_score import compute_alpha_score_v2
from gen2.baseline.leadership_score import compute_leadership_score
from gen2.baseline.rule_v2_ab import build_v2_roles
from gen2.data.loader import load_gen2_config
from gen2.portfolio.defense_gate import apply_regime_defense
from gen2.portfolio.regime import classify_regime, market_score as regime_market_score

CORE_PCT = 0.80
CHALLENGER_PCT = 0.70
SATELLITE_PCT = 0.60


def proposed_role(pct: float) -> str:
    if pct >= CORE_PCT:
        return "CORE"
    if pct >= CHALLENGER_PCT:
        return "CHALLENGER"
    if pct >= SATELLITE_PCT:
        return "SATELLITE"
    return "RESERVE"


def main() -> None:
    fixture_path = sys.argv[1] if len(sys.argv) > 1 else str(ROOT / "fixtures" / "gen2" / "parity_fixture.json")
    fixture = json.loads(Path(fixture_path).read_text(encoding="utf-8"))

    # 1. 特征 DataFrame（30 只 eligible + 每行携带 benchmark regime）
    features = pd.DataFrame(fixture["features"])
    features["code"] = features["code"].astype(str).str.zfill(6)
    features["eligibility"] = "ELIGIBLE"
    features["market_score"] = regime_market_score(features["benchmark_px_ma20"], features["benchmark_px_ma60"])
    univ = fixture["universe"]
    features["name"] = features["code"].map(lambda c: univ[c]["name"])
    features["correlation_cluster"] = features["code"].map(lambda c: univ[c]["cluster"])

    # 2. 评分（leadership_score / trend_score / rs_score / alpha_score_v2）
    scored = compute_leadership_score(features)
    scored = compute_alpha_score_v2(scored)

    # 3. 角色状态机 + 权重（build_v2_roles 内部按 alpha 重排名，与 Node rankFeatures 一致）
    config = load_gen2_config()
    rankings = scored[["trade_date", "code", "name", "correlation_cluster"]].copy()
    roles = build_v2_roles(scored, rankings, config)

    # 4. 防守（benchmark 510300 行供 _benchmark_series 读取）
    candidates = roles[["trade_date", "code", "role", "target_weight", "name", "correlation_cluster"]].copy()
    candidates["priority"] = 1
    bench = pd.DataFrame(fixture["benchmark"])
    bench["code"] = "510300"
    features_with_bench = pd.concat([features, bench], ignore_index=True, sort=False)
    defended = apply_regime_defense(candidates, features_with_bench, config=config)

    # 5. 组装 canonical schema
    base = defended[["trade_date", "code", "role", "target_weight", "defense_state"]].copy()
    base = base.merge(
        roles[["trade_date", "code", "alpha_rank", "alpha_pct", "alpha_score_v2", "trend_gate"]],
        on=["trade_date", "code"], how="left")
    base = base.merge(
        scored[["trade_date", "code", "leadership_score", "trend_score", "rs_score", "market_score"]],
        on=["trade_date", "code"], how="left")

    base["regime"] = base["market_score"].map(classify_regime)
    base["proposed_role"] = base["alpha_pct"].apply(proposed_role)
    base["rank"] = base["alpha_rank"].astype(int)
    base["rank_percentile"] = base["alpha_pct"]

    out = []
    for r in base.itertuples(index=False):
        out.append({
            "code": r.code,
            "trade_date": r.trade_date,
            "rank": int(r.rank),
            "rank_percentile": float(r.rank_percentile),
            "leadership_score": float(r.leadership_score),
            "alpha_score_v2": float(r.alpha_score_v2),
            "trend_score": float(r.trend_score),
            "rs_score": float(r.rs_score),
            "trend_gate": bool(r.trend_gate),
            "regime": r.regime,
            "proposed_role": r.proposed_role,
            "role": r.role,
            "target_weight": float(r.target_weight),
            "defense_state": r.defense_state,
        })

    out.sort(key=lambda x: (x["trade_date"], x["code"]))
    print(json.dumps(out, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
