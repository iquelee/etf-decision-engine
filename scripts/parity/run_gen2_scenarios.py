"""WP-G2-01 —— Gen-2 场景夹具的 Python 端 runner。

读取同一份 fixtures/gen2/golden_scenarios_v1.json，对 RUNNABLE 场景调用 Python 侧
规则实现（不修改任何规则代码），输出与 Node 端对齐的 canonical JSON。

只读：不写库、不改规则、不部署。

用法：
    PYTHONPATH=ml python scripts/parity/run_gen2_scenarios.py [fixture.json] [out.json]
"""
from __future__ import annotations

import hashlib
import json
import sys
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "ml"))

from gen2.baseline.rule_v2_ab import (  # noqa: E402
    _apply_replacement_gate,
    _assert_final_constraints,
    _replacement_edge,
    _should_replace,
    build_v2_roles,
    finalize_roles,
)
from gen2.baseline.leadership_score import compute_leadership_score  # noqa: E402
from gen2.baseline.alpha_score import compute_alpha_score_v2  # noqa: E402
from gen2.portfolio.role_engine import build_daily_roles  # noqa: E402
from gen2.portfolio.regime import classify_regime, market_score as regime_market_score  # noqa: E402
from gen2.portfolio.selection_permission import (  # noqa: E402
    max_core_count,
    selection_allowed,
    selection_mode,
)


def r4(v):
    if v is None:
        return None
    try:
        return round(float(v), 4)
    except (TypeError, ValueError):
        return None


def num(v):
    if v is None or v == "":
        return None
    return float(v)


def to_day_df(rows: list) -> pd.DataFrame:
    """结构化 day → Python 端 DataFrame（列名与 rule_v2_ab 约定一致）。"""
    recs = []
    for r in rows:
        recs.append(
            {
                "code": str(r["code"]),
                "role": r["role"],
                "role_before_cap": r.get("role_before_cap", r["role"]),
                "alpha_score_v2": num(r["alpha_score_v2"]),
                "correlation_cluster": r["cluster"],
                "reason_codes": r.get("reason_codes", "") or "",
            }
        )
    return pd.DataFrame(recs)


def snapshot(day: pd.DataFrame) -> dict:
    day = day.reset_index(drop=True)
    roles = {str(r.code): r.role for r in day.itertuples()}
    reason = {str(r.code): str(r.reason_codes or "") for r in day.itertuples()}
    core = day[day["role"] == "CORE"]
    per_cluster: dict = {}
    for r in core.itertuples():
        cl = r.correlation_cluster
        per_cluster[cl] = per_cluster.get(cl, 0) + 1
    cluster_used = {str(r.code): r.correlation_cluster for r in day.itertuples()}
    return {
        "roles": roles,
        "reason_codes": reason,
        "core_count": int(len(core)),
        "per_cluster_core": per_cluster,
        "cluster_used": cluster_used,
    }


def h_regime_selection(sc):
    out = {}
    base = sc["input"]["base_max_core"]
    for c in sc["input"]["cases"]:
        # null 输入按「NaN → RANGE」契约处理（不制造 adapter 差异）：
        # 与 Node 端 classifyRegime(null) → RANGE 对齐。
        s = float("nan") if c["market_score"] is None else num(c["market_score"])
        out[c["id"]] = {
            "regime": str(classify_regime(s)),
            "selection_mode": str(selection_mode(s)),
            "promotion_allowed": bool(selection_allowed(s)),
            "max_core_count": max_core_count(s, base),
        }
    return out


def h_replacement_edge(sc):
    out = {}
    for c in sc["input"]["cases"]:
        ch = num(c["challenger_alpha"])
        inc = num(c["incumbent_alpha"])
        out[c["id"]] = {
            "edge": r4(_replacement_edge(ch, inc)),
            "should_replace": bool(_should_replace(ch, inc)),
        }
    return out


def h_cluster_cap(sc):
    base = sc["input"]["base_max_core"]
    per_cluster = sc["input"]["max_core_per_cluster"]
    prev = dict(sc["input"]["prev_roles"])
    out = {}

    day_assert = to_day_df(sc["input"]["day"])
    _assert_final_constraints(day_assert, dict(prev), base, per_cluster)
    out["assert_call"] = snapshot(day_assert)

    day_gate = to_day_df(sc["input"]["day"])
    _apply_replacement_gate(day_gate, dict(prev), base, per_cluster)
    out["gate_call"] = snapshot(day_gate)

    # WP-G2-03：角色生成统一出口（替换事务 + 无条件终局约束检查），与 Node finalizeRoles 对称
    day_exit = to_day_df(sc["input"]["day"])
    finalize_roles(day_exit, dict(prev), base, per_cluster)
    out["exit_call"] = snapshot(day_exit)
    return out


def h_core_cap(sc):
    base = sc["input"]["base_max_core"]
    per_cluster = sc["input"]["max_core_per_cluster"]
    day = to_day_df(sc["input"]["day"])
    _assert_final_constraints(day, dict(sc["input"]["prev_roles"]), base, per_cluster)
    return {"assert_call": snapshot(day)}


def h_replacement_transaction(sc):
    base = sc["input"]["base_max_core"]
    per_cluster = sc["input"]["max_core_per_cluster"]
    out = {}
    for c in sc["input"]["cases"]:
        day = to_day_df(c["day"])
        _apply_replacement_gate(day, dict(c["prev_roles"]), base, per_cluster)
        out[c["id"]] = snapshot(day)
    return out


# ---------------- canonical roles panel 展开（V1；与 Node 端逐字一致） ----------------

PANEL_BASE_DATE = "2026-06-"
PANEL_CONST = {
    "sideway_days": 20, "sideway_range": 0.05, "volume_ratio_5_20": 1.0,
    "momentum_accel_5_20": 0.01, "atr20_pct": 0.02, "realized_vol20": 0.25,
    "max_drawdown_20d": -0.1, "corr_to_portfolio_60d": 0.3, "corr_to_cluster_60d": 0.4,
    "avg_amount_20d": 100000000.0, "ret_1d": 0.0, "ret_20d": 0.02, "ret_60d": 0.05, "close": 1.0,
}


def expand_panel(panel, case):
    """V1 展开规则：rank_order 决定 8 个 alpha 驱动列的大小 → trend/rs/breakout 百分位 → alpha 排序。"""
    rows = []
    for d in range(1, case["days"] + 1):
        for idx, code in enumerate(case["rank_order"]):
            k = idx + 1
            broken = d in (case.get("trend_break", {}).get(code) or [])
            row = dict(PANEL_CONST)
            row.update({
                "trade_date": f"{PANEL_BASE_DATE}{d:02d}",
                "code": code,
                "px_ma20": r4(0.10 - 0.01 * (k - 1)),
                "px_ma60": -0.02 if broken else r4(0.08 - 0.01 * (k - 1)),
                "ma20_slope_5d": r4(0.05 - 0.005 * (k - 1)),
                "ma60_slope_10d": r4(0.04 - 0.004 * (k - 1)),
                "rs20_vs_benchmark": r4(0.06 - 0.006 * (k - 1)),
                "rs60_vs_benchmark": r4(0.05 - 0.005 * (k - 1)),
                "rs_accel_5d": r4(0.02 - 0.002 * (k - 1)),
                "breakout_distance": r4(0.03 - 0.003 * (k - 1)),
                "benchmark_px_ma20": r4(case["benchmark"]["px_ma20"]),
                "benchmark_px_ma60": r4(case["benchmark"]["px_ma60"]),
                "eligibility": "ELIGIBLE",
            })
            rows.append(row)
    return rows


def panel_hash(rows):
    """panel_sha256：对「规范化元组」做 sha256（与 Node 端逐字一致）。"""
    keys = ["trade_date", "code", "px_ma20", "px_ma60", "ma20_slope_5d", "ma60_slope_10d",
            "rs20_vs_benchmark", "rs60_vs_benchmark", "rs_accel_5d", "breakout_distance",
            "benchmark_px_ma20", "benchmark_px_ma60"]
    lines = []
    for r in rows:
        lines.append(",".join(f"{r[k]:.4f}" if isinstance(r[k], float) else str(r[k]) for k in keys))
    return hashlib.sha256("\n".join(lines).encode("utf-8")).hexdigest()


ZONE_CODES = {"LEADERSHIP_TOP_QUINTILE", "LEADERSHIP_CHALLENGER_ZONE",
              "LEADERSHIP_SATELLITE_ZONE", "LEADERSHIP_BELOW_SATELLITE"}


def normalize_reasons(raw):
    """reason 归一化（契约见夹具 seam_contracts.reason_normalization）。"""
    out = []
    for part in str(raw or "").split("|"):
        part = part[:-5] if part.endswith("_WAIT") else part
        part = part[:-5] if part.endswith("_KEEP") else part
        if part and part not in ZONE_CODES:
            out.append(part)
    return "|".join(out)


def h_roles_panel(sc):
    from gen2.data.loader import load_gen2_config, load_universe_records

    panel = sc["input"]["panel"]
    cluster_map = {c["code"]: c["cluster"] for c in panel["codes"]}
    records = load_universe_records()
    cfg = load_gen2_config()
    out = {}
    for case in panel["cases"]:
        rows = expand_panel(panel, case)
        df = pd.DataFrame(rows)
        df["market_score"] = regime_market_score(df["benchmark_px_ma20"], df["benchmark_px_ma60"])
        df["name"] = df["code"]
        df["correlation_cluster"] = df["code"].map(cluster_map)
        # canonical roles seam（Python 侧）= V2 规则 rule_v2_ab.build_v2_roles：
        #   它是 B1 账本 / B3 OOS / 360 行 parity 使用的实现，也是**唯一含 NO_CORE 硬门槛与
        #   Selection Permission（RISK_OFF 禁晋升）** 的 Python 实现。
        #   注意：portfolio/role_engine.build_daily_roles 是另一套实现，缺 NO_CORE 门槛与权限门，
        #   本包不选它作为 seam；两者的差异已作为发现登记（见夹具 seam_contracts.python_roles_implementations）。
        scored = compute_leadership_score(df)
        scored = compute_alpha_score_v2(scored)
        rankings = scored[["trade_date", "code", "name", "correlation_cluster"]].copy()
        res = build_v2_roles(scored, rankings, cfg)

        days, reasons, reasons_norm, cluster_core = {}, {}, {}, {}
        for _, row in res.iterrows():
            d = str(int(str(row["trade_date"]).split("-")[-1]))
            days.setdefault(d, {})[row["code"]] = row["role"]
            reasons.setdefault(d, {})[row["code"]] = str(row["reason_codes"] or "")
            reasons_norm.setdefault(d, {})[row["code"]] = normalize_reasons(row["reason_codes"])
            if row["role"] == "CORE":
                cl = row["correlation_cluster"]
                cluster_core.setdefault(d, {})[cl] = cluster_core.get(d, {}).get(cl, 0) + 1
        out[case["id"]] = {
            "days": days,
            "reasons": reasons,
            "reasons_norm": reasons_norm,
            "cluster_core_count": cluster_core,
            "cluster_used": cluster_map,
            "panel_sha256": panel_hash(rows),
            "panel_rows": len(rows),
            # 自证：etf_master 的 cluster 与夹具声明一致（不一致说明 adapter/宇宙漂移）
            "cluster_map_matches_fixture": all(
                str(records[c["code"]].correlation_cluster) == str(c["cluster"]) for c in panel["codes"]
            ),
        }
    return out


HANDLERS = {
    "regime_selection": h_regime_selection,
    "replacement_edge": h_replacement_edge,
    "cluster_cap": h_cluster_cap,
    "core_cap": h_core_cap,
    "replacement_transaction": h_replacement_transaction,
    "roles_panel": h_roles_panel,
}


def main() -> int:
    fixture_path = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "fixtures" / "gen2" / "golden_scenarios_v1.json"
    out_path = Path(sys.argv[2]) if len(sys.argv) > 2 else None
    fixture = json.loads(Path(fixture_path).read_text(encoding="utf-8"))

    results = {
        "engine": "python",
        "source": "ml/gen2/baseline/rule_v2_ab.py + ml/gen2/portfolio/{regime,selection_permission}.py",
        "rule_bundle_version": "gen2-rule-v2.0",
        "scenarios": {},
        "pending": [],
    }
    for sc in fixture["scenarios"]:
        if sc["status"] != "RUNNABLE":
            results["pending"].append(
                {"id": sc["id"], "deferred_to": sc.get("deferred_to"), "reason": sc.get("deferred_reason")}
            )
            continue
        handler = HANDLERS.get(sc["handler"])
        if handler is None:
            raise SystemExit(f"unknown handler {sc['handler']} for {sc['id']}")
        results["scenarios"][sc["id"]] = handler(sc)

    text = json.dumps(results, ensure_ascii=False, indent=2)
    if out_path:
        out_path.write_text(text, encoding="utf-8")
    else:
        print(text)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
