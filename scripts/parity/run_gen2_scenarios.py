"""WP-G2-01 —— Gen-2 场景夹具的 Python 端 runner。

读取同一份 fixtures/gen2/golden_scenarios_v1.json，对 RUNNABLE 场景调用 Python 侧
规则实现（不修改任何规则代码），输出与 Node 端对齐的 canonical JSON。

只读：不写库、不改规则、不部署。

用法：
    PYTHONPATH=ml python scripts/parity/run_gen2_scenarios.py [fixture.json] [out.json]
"""
from __future__ import annotations

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
    finalize_roles,
)
from gen2.portfolio.regime import classify_regime  # noqa: E402
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


HANDLERS = {
    "regime_selection": h_regime_selection,
    "replacement_edge": h_replacement_edge,
    "cluster_cap": h_cluster_cap,
    "core_cap": h_core_cap,
    "replacement_transaction": h_replacement_transaction,
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
