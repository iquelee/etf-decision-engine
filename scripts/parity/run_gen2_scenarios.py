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
from gen2.data.run_gate import evaluate_run_gate, validate_publish_results  # noqa: E402
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
        #   Selection Permission（RISK_OFF 禁晋升）** 的 Python 实现（V2 唯一权威，用户裁决 2026-09-11）。
        #   portfolio 下的 legacy V1 角色实现缺 NO_CORE 门槛与权限门，禁止用于 V2 语义；
        #   其调用源守卫见 ml/gen2/tests/test_role_impl_authority.py。
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


# ---------------- canonical run panel 展开（RUN_V1；与 Node 端逐字一致） ----------------

def run_panel_codes(panel):
    return list(panel["codes"]) + [panel["benchmark_code"]]


def run_panel_base(panel):
    """生成 run 级日线面板：全整数运算，保证两端逐位一致。"""
    from datetime import date, timedelta

    y, m, d = (int(x) for x in panel["base_date"].split("-"))
    start = date(y, m, d)
    rows = []
    for i in range(panel["days"]):
        ds = (start + timedelta(days=i)).isoformat()
        for j, code in enumerate(run_panel_codes(panel)):
            step_q = 100 + 5 * j
            close = panel["price_base"] + (i * step_q) // 100
            volume = panel["volume"] + 1000 * j
            rows.append({
                "code": code, "trade_date": ds,
                "open": close - 1, "high": close + 2, "low": close - 2, "close": close,
                "volume": volume, "amount": volume * close,
            })
    return rows


def group_by_code(rows):
    groups: dict = {}
    for r in rows:
        groups.setdefault(r["code"], []).append(r)
    return groups


def apply_run_mutations(rows, mutations, panel):
    """变异算子（与 Node 端逐字一致）：制造陈旧 / 重复 / 缺基准 / 短历史 / NaN 等场景。"""
    groups = group_by_code(rows)

    def sel(spec):
        if spec == "eligible":
            return list(panel["codes"])
        if spec == "all":
            return run_panel_codes(panel)
        return list(spec) if isinstance(spec, list) else [spec]

    for m in mutations or []:
        codes = sel(m["codes"] if m.get("codes") is not None else m.get("code"))
        if m["op"] == "slice_last":
            for c in codes:
                if c in groups:
                    groups[c] = groups[c][-m["n"]:]
        elif m["op"] == "drop_code":
            for c in codes:
                groups.pop(c, None)
        elif m["op"] == "stale_shift":
            for c in codes:
                if c in groups:
                    groups[c] = groups[c][: len(groups[c]) - m["days"]]
        elif m["op"] == "duplicate_last":
            for c in codes:
                if c in groups:
                    groups[c].append(dict(groups[c][-1]))
        elif m["op"] == "nan_field":
            for c in codes:
                g = groups.get(c)
                if not g:
                    continue
                idx = len(g) + m["row"] if m["row"] < 0 else m["row"]
                g[idx] = dict(g[idx])
                g[idx][m["field"]] = None
        else:
            raise SystemExit(f"unknown run mutation op {m['op']}")

    out = [r for g in groups.values() for r in g]
    out.sort(key=lambda r: (r["trade_date"], r["code"]))
    return out


def _fmt_cell(v):
    if v is None:
        return "null"
    if isinstance(v, bool):
        return str(v).lower()
    if isinstance(v, (int, float)):
        return f"{float(v):.4f}"
    return str(v)


def run_panel_hash(rows):
    keys = ["code", "trade_date", "open", "high", "low", "close", "volume", "amount"]
    lines = [",".join(_fmt_cell(r[k]) for k in keys) for r in rows]
    return hashlib.sha256("\n".join(lines).encode("utf-8")).hexdigest()


def run_publish_hash(codes, alphas, written):
    line = "|".join(str(c) for c in codes) + ";" + "|".join(_fmt_cell(a) for a in alphas) + ";" + str(written)
    return hashlib.sha256(line.encode("utf-8")).hexdigest()


def _own_universe():
    from gen2.data.loader import load_universe_records

    return load_universe_records()


def h_run_status_gate(sc):
    """run 状态四态：数据闸门（run 级）+ 系统异常 + 发布完整性（纯函数 seam）。"""
    panel = sc["input"]["panel"]
    records = _own_universe()
    own_codes = sorted(str(c) for c in records.keys())
    declared = sorted(run_panel_codes(panel))
    own_target = len([c for c in own_codes if c != panel["benchmark_code"]])
    self_check = {
        "universe_matches_fixture": own_codes == declared,
        "target_size_matches_fixture": own_target == panel["target_size"],
    }
    out = {}
    for c in sc["input"]["data_cases"]:
        rows = apply_run_mutations(run_panel_base(panel), c.get("mutations", []), panel)
        try:
            if c.get("simulate_system_error"):
                raise RuntimeError("injected system error (SYSTEM_ERROR simulation)")
            res = evaluate_run_gate(
                group_by_code(rows),
                eligible_codes=panel["codes"],
                benchmark_code=panel["benchmark_code"],
                target_size=panel["target_size"],
                expected_trade_date=(c.get("event") or {}).get("expected_trade_date"),
                mode=(c.get("event") or {}).get("mode", "REPLAY"),
            )
            obs = {"status": res["status"], "status_reason": res["status_reason"], "data_gate": res["data_gate"]}
        except Exception:  # noqa: BLE001 —— 运行异常 → failed（与 JS catch 路径同语义）
            obs = {"status": "failed", "status_reason": "SYSTEM_ERROR", "data_gate": None}
        obs["panel_sha256"] = run_panel_hash(rows)
        obs.update(self_check)
        out[c["id"]] = obs

    for c in sc["input"]["publish_cases"]:
        res = validate_publish_results(c["codes"], c["alphas"], c["written"])
        obs = {"status": res["status"], "status_reason": res["status_reason"], "data_gate": res["data_gate"],
               "panel_sha256": run_publish_hash(c["codes"], c["alphas"], c["written"])}
        obs.update(self_check)
        out[c["id"]] = obs
    return out


HANDLERS = {
    "regime_selection": h_regime_selection,
    "replacement_edge": h_replacement_edge,
    "cluster_cap": h_cluster_cap,
    "core_cap": h_core_cap,
    "replacement_transaction": h_replacement_transaction,
    "roles_panel": h_roles_panel,
    "run_status_gate": h_run_status_gate,
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
