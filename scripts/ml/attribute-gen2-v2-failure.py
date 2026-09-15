#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""Gen-2 M2 —— Rule V2.0.1 经济失败的**只读后验归因**。

限定：**`POSTMORTEM_NOT_FOR_CALIBRATION`**（用户裁决 2026-09-15）。
  * 允许：只读拆解 **选池 / 权重·上限 / 防守 / 换手·成本** 四层；
  * **禁止**：参数搜索 · 网格 · 阈值调整 · 新 bundle/lock · 为寻找通过结果而重跑 OOS；
  * 输出只能形成**新假设与任务书**，**不得**改变 Rule V2.0.1 的 `ACCEPTED_FAIL` 归档状态。

方法（**加性分解**，每一步只做一次账本重算，不做任何参数改动）：

| 记号 | 策略 | 含义 |
|---|---|---|
| A | `main5_equal_weight` | 基线（Main5 PIT 等权） |
| B | `universe_equal_weight` | 全池等权 → **选池范围**的贡献 = B − A |
| C | `core_equal_weight`（本脚本合成，**无上限约束**） | 角色选池（每日 CORE 等权）→ = C − B |
| D | `gen2_v2_undefended` | 实际权重（含单只/cluster/科技上限、剩余留现金）→ **权重·上限层** = D − C |
| E | `gen2_v2_defended` | 防守后 → **防守层** = E − D |
| F | E @10bps | **换手·成本层** = F − E@0bps |

C 是**诊断用合成组合**，不是新规则、不是候选参数 —— 它只把「角色选池」与「权重上限」
两个效应分开，全部输入仍是冻结语义（`build_v2_roles` + `build_portfolio_candidates`）。

用法：
    PYTHONPATH=ml python scripts/ml/attribute-gen2-v2-failure.py --out <json> [--tmp <dir>]
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "ml"))

import numpy as np  # noqa: E402
import pandas as pd  # noqa: E402

from gen2.baseline import b3_frozen_oos as b3  # noqa: E402
from gen2.baseline.rebuild_baselines import (  # noqa: E402
    build_weight_frames,
    common_evaluation_calendar,
    perf_metrics,
)
from gen2.baseline.selection_scores import canonical_selection_scores  # noqa: E402
from gen2.baseline.v2_role_view import build_v2_role_view  # noqa: E402
from gen2.backtest.ledger import run_ledger  # noqa: E402
from gen2.data.loader import load_daily_bars, load_gen2_config, load_universe_definition, load_universe_records  # noqa: E402
from gen2.features.build_features import build_feature_matrix  # noqa: E402
from gen2.portfolio import regime as regime_mod  # noqa: E402
from gen2.portfolio.portfolio_builder import (  # noqa: E402
    build_portfolio_candidates,
    ledger_signals,
    priority_from_roles,
)
from gen2.ranking.rank_engine import run_rank_engine  # noqa: E402

PROTOCOL = "POSTMORTEM_NOT_FOR_CALIBRATION"
COSTS = [0.0, 5.0, 10.0, 20.0]
PRIMARY = 10.0


def _year_returns(net: pd.Series, dates) -> dict:
    s = pd.Series(net.values, index=pd.to_datetime(pd.Series(list(dates))))
    out = {}
    for y, g in s.groupby(s.index.year):
        out[str(y)] = round(float((1.0 + g).prod() - 1.0) * 100.0, 2)
    return out


def main() -> int:
    ap = argparse.ArgumentParser(description="M2 只读后验归因（POSTMORTEM_NOT_FOR_CALIBRATION）")
    ap.add_argument("--out", required=True)
    ap.add_argument("--tmp", default=None, help="账本临时输出目录（默认系统临时目录）")
    a = ap.parse_args()

    # ---- 冻结配置（与 B3 同一派生路径，保证规则输入 == 被锁定的那一份）----
    bundle = json.loads(b3._abs(b3.BUNDLE_REL).read_text(encoding="utf-8"))
    cfg, cfg_attest = b3.derive_config(bundle, load_gen2_config())
    assert not cfg_attest["drift"], "运行配置与冻结 bundle 存在漂移，M2 拒绝继续"

    # 注意：`derive_config` **不**把 regime 常量映射进运行配置 —— 实际执行值来自
    # 被锁定的 `ml/gen2/portfolio/regime.py`（immutable_set 的 `python_regime` 条目）。
    # 这里做一次 bundle ↔ 模块的交叉校验，二者不齐即 fail-closed。
    _brg = bundle.get("regime") or {}
    regime_xcheck = {
        "bundle": {"risk_on_ge": _brg.get("risk_on_ge"), "risk_off_le": _brg.get("risk_off_le")},
        "locked_module": {"risk_on_ge": float(regime_mod.RISK_ON_GE),
                          "risk_off_le": float(regime_mod.RISK_OFF_LE)},
        "source_of_truth": "ml/gen2/portfolio/regime.py（实际执行常量，已锁）",
    }
    regime_xcheck["agree"] = (
        float(_brg.get("risk_on_ge")) == regime_xcheck["locked_module"]["risk_on_ge"]
        and float(_brg.get("risk_off_le")) == regime_xcheck["locked_module"]["risk_off_le"])
    if not regime_xcheck["agree"]:
        raise RuntimeError(f"bundle.regime 与被锁定的 regime 模块常量不一致：{regime_xcheck}")

    universe = load_universe_definition()
    main5 = list(universe["incumbent_main5"])

    features = build_feature_matrix(bars=load_daily_bars(),
                                   records=load_universe_records(), config=cfg)
    rankings = run_rank_engine(features)
    selection = canonical_selection_scores(features)

    # ---- 角色 + 候选面板（冻结语义，未改任何参数）----
    roles = build_v2_role_view(features, rankings, cfg, selection_scores=selection)
    prio = priority_from_roles(roles)
    cand_panel = build_portfolio_candidates(roles, priority=prio, config=cfg)
    def_panel = build_portfolio_candidates(roles, priority=prio, config=cfg,
                                          features=features, apply_defense=True)

    weights_map = build_weight_frames(features, rankings, cfg, main5, selection_scores=selection)
    weights_map.pop("_roles")

    # ---- 合成 C：每日 CORE 等权、无上限（诊断用）----
    nc = cand_panel.copy()
    if "role" not in nc.columns:
        raise RuntimeError("候选面板缺少 role 列，无法合成 C")
    nc["target_weight"] = 0.0
    core_n = {}
    for d, g in nc.groupby("trade_date", sort=True):
        idx = g.index[g["role"].astype(str) == "CORE"]
        core_n[str(d)] = int(len(idx))
        if len(idx):
            nc.loc[idx, "target_weight"] = 1.0 / float(len(idx))
    weights_map["core_equal_weight"] = ledger_signals(nc)

    returns = features[["trade_date", "code", "ret_1d"]].copy()
    calendar, win_meta = common_evaluation_calendar(weights_map, returns)
    print(f"[M2] 公共窗口 {calendar[0]} → {calendar[-1]} ({len(calendar)} 日)")

    # ---- 账本（全部同一日历 / 同一期初 / T+1）----
    daily_frames = []
    for bps in COSTS:
        for name, wdf in weights_map.items():
            led = run_ledger(wdf, returns, cost_bps=float(bps), calendar=calendar,
                             execution_lag=1, strict=True)
            led["strategy"] = name
            led["cost_bps"] = float(bps)
            daily_frames.append(led)
    daily = pd.concat(daily_frames, ignore_index=True)

    # ---- OOS 切片 ----
    oos = b3.derive_oos_window(sorted(rankings["trade_date"].unique()))
    oos_dates = [str(d)[:10] for d in oos["dates"]]
    daily_oos = daily[daily["trade_date"].astype(str).str[:10].isin(set(oos_dates))].copy()
    print(f"[M2] OOS {oos_dates[0]} → {oos_dates[-1]} ({len(oos_dates)} 日)，账本行 {len(daily_oos)}")

    # ---- H5c 式身份证明：重算全窗口 == 已接受 B1 报告读数 ----
    from gen2.baseline.rebuild_baselines import build_unified_baselines
    tmp = Path(a.tmp) if a.tmp else Path.home() / ".cache" / "gen2-m2"
    tmp.mkdir(parents=True, exist_ok=True)
    res = build_unified_baselines(output_dir=tmp / "ledger", report_dir=tmp / "ledger",
                                  config=cfg, run_id="m2_attribution_readonly")
    accepted_rows = b3.parse_report_readings(
        b3._abs(b3.ACCEPTED_B1_REPORT_REL).read_text(encoding="utf-8"))
    repro = b3.verify_reproduction(res["summary"], accepted_rows)
    print(f"[M2] B1 复现核对：all_match={repro['all_match']} "
          f"mismatched_cells={repro.get('mismatched_cells')}")

    # ---- 逐年净收益（主判据 10bps）----
    def series(name: str, bps: float) -> pd.Series:
        g = daily_oos[(daily_oos["strategy"] == name)
                      & (daily_oos["cost_bps"] == bps)].sort_values("trade_date")
        return g

    layer_names = ["main5_equal_weight", "universe_equal_weight", "core_equal_weight",
                   "gen2_v2_undefended", "gen2_v2_defended"]
    lines = {}
    for nm in layer_names:
        g = series(nm, 0.0)
        net = (1.0 + g["net_return"]).prod() - 1.0
        lines[nm] = {
            "cum_net_pct_0bps": round(float(net) * 100.0, 2),
            "cum_net_pct_10bps": round(float((1.0 + series(nm, PRIMARY)["net_return"]).prod() - 1.0) * 100.0, 2),
            "turnover_total": round(float(series(nm, PRIMARY)["turnover"].sum()), 2),
            "cost_total_pct": round(float(series(nm, PRIMARY)["cost"].sum()) * 100.0, 2),
            "avg_cash_weight": round(float(series(nm, PRIMARY)["cash_weight"].mean()), 4),
            "max_drawdown_pct": None,
            "yearly_net_pct_0bps": {},
        }
        net_pct = None
        if nm == "gen2_v2_defended":
            net_pct = lines[nm]["cum_net_pct_0bps"]

    # 逐年（0bps，剔除成本以看机制）
    yearly = {}
    for nm in layer_names:
        g = series(nm, 0.0)
        yearly[nm] = _year_returns(g["net_return"], g["trade_date"])

    # 回撤（0bps）
    dd = {}
    for nm in layer_names:
        g = series(nm, 0.0)
        eq = (1.0 + g["net_return"]).cumprod()
        dd[nm] = round(float((eq / eq.cummax() - 1.0).min()) * 100.0, 2)

    # ---- 加性分解（OOS 累计，0bps）----
    p = {nm: (1.0 + series(nm, 0.0)["net_return"]).prod() - 1.0 for nm in layer_names}
    e10 = (1.0 + series("gen2_v2_defended", PRIMARY)["net_return"]).prod() - 1.0
    decomposition = [
        {"step": "A→B", "layer": "选池范围（Main5 等权 → 全池等权）",
         "delta_pct": round(float(p["universe_equal_weight"] - p["main5_equal_weight"]) * 100.0, 2)},
        {"step": "B→C", "layer": "角色选池（全池等权 → 每日 CORE 等权，无上限）",
         "delta_pct": round(float(p["core_equal_weight"] - p["universe_equal_weight"]) * 100.0, 2)},
        {"step": "C→D", "layer": "权重·上限（CORE 等权 → 实际权重，含 单只0.25/cluster0.40/科技0.65 + 留现金）",
         "delta_pct": round(float(p["gen2_v2_undefended"] - p["core_equal_weight"]) * 100.0, 2)},
        {"step": "D→E", "layer": "防守（未防守 → 防守后）",
         "delta_pct": round(float(p["gen2_v2_defended"] - p["gen2_v2_undefended"]) * 100.0, 2)},
        {"step": "E→F", "layer": "换手·成本（0bps → 10bps）",
         "delta_pct": round(float(e10 - p["gen2_v2_defended"]) * 100.0, 2)},
        {"step": "A→F", "layer": "**总差**（Main5 → Gen-2 防守 @10bps）",
         "delta_pct": round(float(e10 - p["main5_equal_weight"]) * 100.0, 2)},
    ]

    # ---- 上限约束的绑定强度（诊断，**不调参**）----
    # 口径**严格对齐** `portfolio_builder._assert_caps` —— 该函数在追加现金腿**之前**被调用：
    #   * 单只上限：全部**证券行**的 `max`（`CASH` 腿必须剔除，否则 50% 现金腿会假触发）；
    #   * cluster 上限：**仅 `role == "CORE"` 行**，按 `correlation_cluster` 分组求和；
    #   * 科技上限：**仅 CORE 行**且 cluster ∈ `tech_clusters`，按日求和；
    #   * 剩余现金：`1 - Σ证券行`。
    # ⚠ 首版误把 `CASH` 腿（权重 = 1 − Σ证券，均值≈0.50 ≥ 0.25）纳入统计，
    #    会把「单只绑定天数 / cluster 绑定天数」抬成虚高、并让残差现金恒为 0。已修正。
    cfg_port = cfg["portfolio"]
    cap_single = float(cfg_port.get("max_single_weight", 0.25))
    cap_cluster = float(cfg_port.get("max_cluster_weight", 0.40))
    cap_tech = float(cfg_port.get("max_tech_weight", 0.65))
    tech_cl = set(cfg_port.get("tech_clusters", ["tech_hardware", "software_ai"]))
    binding = {}
    try:
        def _bind_stats(sub: pd.DataFrame, label: str) -> dict:
            sec = sub[sub["code"].astype(str) != "CASH"].copy()
            sec["target_weight"] = sec["target_weight"].astype(float)
            core = sec[sec["role"].astype(str) == "CORE"]
            days = int(sec["trade_date"].nunique())
            cash_only = single_bind = 0
            cash_sum = 0.0
            for _d, g in sec.groupby("trade_date", sort=True):
                invested = float(g["target_weight"].sum())
                cash_sum += 1.0 - invested
                if invested <= 1e-12:
                    cash_only += 1
                if float(g["target_weight"].max()) >= cap_single - 1e-9:
                    single_bind += 1
            cluster_bind = tech_bind = 0
            core_days = int(core["trade_date"].nunique())
            for _d, g in core.groupby("trade_date", sort=True):
                cs = g.groupby("correlation_cluster")["target_weight"].sum()
                if len(cs) and float(cs.max()) >= cap_cluster - 1e-9:
                    cluster_bind += 1
                tt = float(g.loc[g["correlation_cluster"].isin(tech_cl), "target_weight"].sum())
                if tt >= cap_tech - 1e-9:
                    tech_bind += 1
            core_n_hist = core.groupby("trade_date")["code"].size()
            return {
                "window": label,
                "days": days,
                "cash_only_days": cash_only,
                "cash_only_day_pct": round(cash_only / days * 100.0, 2) if days else None,
                "avg_residual_cash_on_security_rows": round(cash_sum / days, 4) if days else None,
                "single_cap_bound_days": single_bind,
                "single_cap_bound_day_pct": round(single_bind / days * 100.0, 2) if days else None,
                "core_days": core_days,
                "cluster_cap_bound_days": cluster_bind,
                "tech_cap_bound_days": tech_bind,
                "core_count_hist": {str(k): int(v) for k, v in core_n_hist.value_counts().sort_index().items()},
            }

        oos_set = set(oos_dates)
        binding = {
            "caps": {"max_single_weight": cap_single, "max_cluster_weight": cap_cluster,
                     "max_tech_weight": cap_tech, "tech_clusters": sorted(tech_cl)},
            "scope_note": ("单只上限取全部**证券行** `max`；cluster / 科技上限**仅统计 `role=='CORE'` 行** —— "
                           "与 `_assert_caps(PRE_DEFENSE)` 同口径。`CASH` 腿（权重 = 1 − Σ证券）已剔除，"
                           "否则 50% 级现金腿会假触发单只上限。"),
            "full_candidate_panel": _bind_stats(cand_panel, "full_candidate_panel"),
            "oos_only": _bind_stats(
                cand_panel[cand_panel["trade_date"].astype(str).str[:10].isin(oos_set)],
                "oos_only(2021-01-04→2026-09-04)"),
        }
    except Exception as e:  # noqa: BLE001
        binding = {"error": f"{type(e).__name__}: {e}"}

    # ---- CORE 规模分布 ----
    cn = pd.Series(core_n)
    core_stats = {"days": int(len(cn)), "mean": round(float(cn.mean()), 2),
                  "min": int(cn.min()), "max": int(cn.max()),
                  "hist": {str(k): int(v) for k, v in cn.value_counts().sort_index().items()}}

    # ---- 分析结果块：**先落中间检查点**（末端组装若出错，也不丢这几分钟的账本重算）----
    core = {
        "identity_check_vs_accepted_b1": {
            "all_match": repro["all_match"],
            "mismatched_cells": repro.get("mismatched_cells"),
            "note": "重算全窗口读数 == 已接受 B1 报告逐位 ⇒ 本归因跑在同一条被接受的规则上",
        },
        "oos_window": {"first": oos_dates[0], "last": oos_dates[-1], "days": len(oos_dates)},
        # 注意：`common_evaluation_calendar` 返回的日历元素是 `datetime.date`，**不是**字符串
        # （非 JSON 原生类型，必须显式 str()）。
        "common_calendar": {"first": str(calendar[0]), "last": str(calendar[-1]),
                            "days": len(calendar),
                            "excluded_leading_days": int(win_meta["excluded_leading_days"])},
        "layer_lines_0bps": lines,
        "yearly_net_pct_0bps": yearly,
        "max_drawdown_pct_0bps": dd,
        "decomposition_0bps": decomposition,
        "cap_binding": binding,
        "core_size_stats": core_stats,
    }
    outp = Path(a.out)
    outp.parent.mkdir(parents=True, exist_ok=True)

    def _dump(obj: dict, label: str) -> str:
        """JSON 序列化；遇到非原生类型**明示告警**并退回 `default=str`（不静默、不丢结果）。"""
        try:
            return json.dumps(obj, ensure_ascii=False, indent=1)
        except TypeError as e:  # noqa: PERF203
            print(f"[M2][WARN] {label} 含非 JSON 原生类型，已退回 default=str：{e}")
            return json.dumps(obj, ensure_ascii=False, indent=1, default=str)

    ckpt = outp.with_name(outp.name + ".checkpoint.json")
    ckpt.write_text(_dump(core, "checkpoint"), encoding="utf-8")
    print(f"[M2] checkpoint wrote {ckpt}")

    payload = {
        "attribution": "gen2_m2_postmortem_attribution",
        "generated_on": pd.Timestamp.now().date().isoformat(),
        "protocol": PROTOCOL,
        "ruling": ("用户裁决 2026-09-15：M2 只读拆解 选池/权重·上限/防守/换手·成本 四层；"
                   "禁止参数搜索·网格·阈值调整·新 bundle/lock·重跑 OOS 找通过结果；"
                   "输出只能形成新假设与任务书，不得改变 ACCEPTED_FAIL 归档状态。"),
        "frozen_input": {
            "bundle_version": bundle["bundle_version"],
            "bundle_sha256": b3._sha(b3.BUNDLE_REL),
            "config_drift": cfg_attest["drift"],
            # 注意：`b3.derive_config` 把运行参数收在 `cfg["portfolio"]` 下（含 defense / role_thresholds）；
            # regime 常量**不**进运行配置，实际执行值来自被锁定的 regime 模块。
            "regime_constants_crosscheck": regime_xcheck,
            "portfolio_caps": {k: cfg["portfolio"][k] for k in (
                "max_single_weight", "max_cluster_weight", "max_tech_weight", "tech_clusters",
                "max_core_count", "max_core_per_cluster")},
            "defense": cfg["portfolio"]["defense"],
            "role_thresholds": cfg["portfolio"]["role_thresholds"],
            "note": ("运行配置取自 b3.derive_config(bundle, load_gen2_config())；"
                     "regime 常量不在运行配置内，实际执行值来自被锁定的 "
                     "ml/gen2/portfolio/regime.py。"),
        },
        **core,
        "no_calibration_statement": (
            "本文件**未**产生任何新参数、新阈值、新 bundle/lock；未重跑 OOS 以寻找通过结果；"
            "结论只用于形成新假设。Rule V2.0.1 仍为 ACCEPTED_FAIL / NOT_PRODUCTION_ELIGIBLE。"),
    }

    outp.write_text(_dump(payload, "payload"), encoding="utf-8")
    print(f"[M2] wrote {outp}")
    print("[M2] 分解（OOS 累计, 0bps）：")
    for row in decomposition:
        print(f"   {row['step']:<6} {row['delta_pct']:>9.2f} pct  {row['layer']}")
    print("[M2] CORE 规模（全候选面板）：", json.dumps(core_stats, ensure_ascii=False))
    for wkey in ("full_candidate_panel", "oos_only"):
        wv = binding.get(wkey) or {}
        if wv:
            print(f"[M2] 上限绑定[{wkey}] days={wv['days']} cash_only={wv['cash_only_days']} "
                  f"({wv['cash_only_day_pct']}%) single={wv['single_cap_bound_days']} "
                  f"({wv['single_cap_bound_day_pct']}%) cluster={wv['cluster_cap_bound_days']} "
                  f"tech={wv['tech_cap_bound_days']} residual_cash={wv['avg_residual_cash_on_security_rows']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
