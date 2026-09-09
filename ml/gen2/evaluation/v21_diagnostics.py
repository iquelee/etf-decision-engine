"""Gen-2.1 M3 — V2.1 三臂事件诊断（Validation 2024 段，报告数据源）。

从 run_v21_arms 落盘的 roles csv（全程 stateful）切 2024 窗口，统计：
  - 事件计数（PROMOTION_CONFIRMED / DEMOTION_CONFIRMED / REPLACEMENT_ACCEPTED /
    REPLACEMENT_REVOKED / V21_CLUSTER_GATE_BLOCKED / V21_CONSOLIDATION_BLOCKED / NO_CORE_TREND_GATE）
  - Replacement Payoff：REPLACEMENT_ACCEPTED 后 20D（vs incumbent 代码 —— 简化用 vs 510300 excess label）
  - 平均持有期（CORE 连续在位段长，2024 段内）
  - Turnover 由经济矩阵提供（run_v21_arms 已出），本脚本聚焦事件与持有结构。

用法：PYTHONPATH=ml python -m gen2.evaluation.v21_diagnostics
"""
from __future__ import annotations

import json
import os
from collections import Counter

import pandas as pd

from gen2.data.loader import load_daily_bars, load_gen2_config, load_universe_records
from gen2.features.build_features import build_feature_matrix
from gen2.labels.build_labels import build_labels_vs_market
from gen2.ranking.rank_engine import run_rank_engine

REPO_OUT = os.path.join(os.path.dirname(__file__), "..", "..", "..", "ml", "gen2", "outputs")


def _core_hold_stats(roles: pd.DataFrame) -> dict:
    """统计 2024 窗口内 CORE 连续在位段平均长度（交易日）。"""
    df = roles[roles["role"] == "CORE"].copy()
    df["trade_date"] = pd.to_datetime(df["trade_date"])
    df = df.sort_values(["code", "trade_date"])
    lengths = []
    for code, g in df.groupby("code"):
        prev = None
        run = 0
        for d in g["trade_date"]:
            if prev is None or (d - prev).days <= 4:
                run += 1
            else:
                lengths.append(run)
                run = 1
            prev = d
        if run:
            lengths.append(run)
    return {"core_segments": len(lengths),
            "avg_core_hold_days": float(pd.Series(lengths).mean()) if lengths else float("nan"),
            "median_core_hold_days": float(pd.Series(lengths).median()) if lengths else float("nan")}


def _event_table(roles: pd.DataFrame, window_start="2024-01-01", window_end="2024-12-31") -> pd.DataFrame:
    ev = roles[(roles["trade_date"] >= window_start) & (roles["trade_date"] <= window_end)].copy()
    counter: Counter = Counter()
    for s in ev["reason_codes"].fillna("").tolist():
        if not isinstance(s, str) or not s:
            continue
        for e in s.split("|"):
            if e:
                counter[e] += 1
    rows = [{"event": k, "count": v} for k, v in counter.most_common()]
    return pd.DataFrame(rows)


def main() -> None:
    cfg = load_gen2_config()
    bars = load_daily_bars()
    records = load_universe_records()
    feats = build_feature_matrix(bars=bars, records=records, config=cfg)
    labels = build_labels_vs_market(feats)
    excess = labels[["trade_date", "code", "future_20d_excess_vs_market"]].copy()
    excess["code"] = excess["code"].astype(str)

    arms = ["gate_off", "gate_40", "gate_60"]
    report = []
    for arm in arms:
        p = os.path.join(REPO_OUT, f"gen2_v21_m3_roles_{arm}.csv")
        if not os.path.exists(p):
            print(f"[跳过] {p} 不存在")
            continue
        roles = pd.read_csv(p, dtype={"code": str})
        roles["code"] = roles["code"].str.zfill(6)
        # 2024 窗口
        w = roles[(roles["trade_date"] >= "2024-01-01") & (roles["trade_date"] <= "2024-12-31")].copy()
        et = _event_table(w).set_index("event")["count"].to_dict()
        hold = _core_hold_stats(w)
        # Replacement 事件 fwd20（标签按 signal 日 join）
        rc = roles["reason_codes"].fillna("").astype(str)
        ev_rows = roles[rc.str.contains("REPLACEMENT_ACCEPTED", na=False)
                        & (roles["trade_date"] >= "2024-01-01")].copy()
        ev_rows = ev_rows.merge(excess, on=["trade_date", "code"], how="left")
        fwd = ev_rows["future_20d_excess_vs_market"].dropna()
        row = {
            "arm": arm,
            "promotions": et.get("PROMOTION_CONFIRMED", 0),
            "demotions": et.get("DEMOTION_CONFIRMED", 0),
            "replacement_accepted": et.get("REPLACEMENT_ACCEPTED", 0),
            "replacement_revoked": et.get("REPLACEMENT_REVOKED", 0),
            "cluster_gate_blocked": et.get("V21_CLUSTER_GATE_BLOCKED", 0),
            "consolidation_blocked": et.get("V21_CONSOLIDATION_BLOCKED", 0),
            "no_core_trend_gate": et.get("NO_CORE_TREND_GATE", 0),
            "avg_core_hold_days": hold["avg_core_hold_days"],
            "core_segments": hold["core_segments"],
            "repl_fwd20_n": int(len(fwd)),
            "repl_fwd20_mean_excess": float(fwd.mean()) if len(fwd) else float("nan"),
        }
        report.append(row)

    df = pd.DataFrame(report)
    out = os.path.join(REPO_OUT, "gen2_v21_m3_event_diag.csv")
    df.to_csv(out, index=False)
    pd.set_option("display.width", 240)
    print("\n## M3 三臂事件诊断（Validation 2024 段）")
    print(df.to_string(index=False, float_format=lambda x: f"{x:.4f}"))
    print(f"\n[OK] {out}")


if __name__ == "__main__":
    main()
