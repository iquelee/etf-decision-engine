#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""Gen-2 M2-B —— **定向归因**（用户裁决 2026-09-16）。

M2（`attribute-gen2-v2-failure.py`）的延伸，协议不变：**`POSTMORTEM_NOT_FOR_CALIBRATION`**。
只做裁决明确批准的**三项**，其余一律不做：

| 代号 | 内容 | 裁决给定边界 |
|---|---|---|
| **T1** | **C→D1→D2 会计式拆分** | 严格加总回原 `C→D`；剩余权重**留作现金**，**不重新分配**给其他 ETF |
| **T2** | **H2 纯描述性诊断** | 只描述 `CORE==0` 日期 / 市场·行业收益 / 现金暴露 / 错失收益 / 状态机触发原因。**不做任何替代行为回测**（"CORE==0 时改持有前仓 / 买入 challenger" 一类替代规则留给 **O2 未观察段**） |
| **T3** | **H4 换手归因** | 只拆分换手来源 / 调仓频率 / 单边成本拖累 / 现金暴露 / 防守触发。**不改**手续费档、**不改**再平衡频率、**不生成**"优化后的成本结果" |

**未触碰**：规则 / 参数 / 数据版本 / lock / `immutable_set` / OOS 分割。
不搜索参数、不跑网格、不调阈值、不建新 bundle/lock、不为寻找通过结果而重跑 OOS。

-------------------------------  T1 的口径（关键）  -------------------------------

权重流水线（`rule_v2_ab.build_v2_roles` 第 329–365 行，**冻结实现**）逐字为：

```text
relative_share = 1 / |CORE|                       ← C 层：每日 CORE 等权，Σ证券 = 1
步①  单只:  w1 = min(relative_share, 0.25)        ← D1 层：截断，残差留现金
步②  cluster: 同 (日, cluster) 内 Σw1 > 0.40 → 该组整体 × (0.40 / Σw1)
步③  科技:   同日 tech_clusters 合计 > 0.65 → 仅科技行 × (0.65 / 合计)
                                                  ← D2 层 = 步①②③ = `gen2_v2_undefended`
```

故 **C→D1** = 单只截断及其新增残差现金；**D1→D2** = cluster/科技缩权及其新增残差现金。
两段都是同一个账本函数算出的累计净收益之差 ⇒ **加总恒等于原 `C→D`**（本脚本显式校验）。

本脚本还会**复算 D2**（从 D1 出发跑步②③）并与权威 `roles.target_weight` 逐位比对，
证明拆分口径与冻结实现同源。

用法：
    PYTHONPATH=ml python scripts/ml/attribute-gen2-v2-failure-targeted.py --out <json> [--tmp <dir>]
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
    build_unified_baselines,
    build_weight_frames,
    common_evaluation_calendar,
)
from gen2.baseline.selection_scores import canonical_selection_scores  # noqa: E402
from gen2.baseline.v2_role_view import build_v2_role_view  # noqa: E402
from gen2.backtest.ledger import run_ledger  # noqa: E402
from gen2.data.loader import (  # noqa: E402
    load_daily_bars,
    load_gen2_config,
    load_universe_definition,
    load_universe_records,
)
from gen2.features.build_features import build_feature_matrix  # noqa: E402
from gen2.portfolio import regime as regime_mod  # noqa: E402
from gen2.portfolio.portfolio_builder import (  # noqa: E402
    build_portfolio_candidates,
    ledger_signals,
    priority_from_roles,
)
from gen2.portfolio.role_thresholds import load_role_thresholds  # noqa: E402
from gen2.portfolio.selection_permission import selection_mode  # noqa: E402
from gen2.ranking.rank_engine import run_rank_engine  # noqa: E402

PROTOCOL = "POSTMORTEM_NOT_FOR_CALIBRATION"
COSTS = [0.0, 5.0, 10.0, 20.0]
PRIMARY = 10.0
_TOL = 1e-12


def _pct(x: float) -> float:
    return round(float(x) * 100.0, 2)


def _dstr(d) -> str:
    return str(d)[:10]


# --------------------------------------------------------------------------- #
# T3 用：只读复现账本持仓循环 → 逐日换手来源分解
# --------------------------------------------------------------------------- #

def replay_turnover_detail(signals: pd.DataFrame, returns: pd.DataFrame, calendar: list,
                           execution_lag: int = 1) -> pd.DataFrame:
    """**只读复现** `gen2.backtest.ledger.run_ledger` 的持仓循环，输出逐 `(trade_date, code)` 权重变化明细。

    * 与账本**同一时间语义**：`target` 取 `sig_date = t−1` 的信号（T+1 执行），
      `pre_trade` 取当日收益漂移后的权重；无信号日维持漂移后持仓（不调仓）。
    * 分类口径（`delta = target − pre_trade`，逐证券）：
        - `entry`    : `pre_trade == 0` 且 `target > 0`
        - `exit`     : `pre_trade > 0`  且 `target <= 0`
        - `reweight` : 两侧均 `> 0`
        - `none`     : 两侧均为 0
    * 现金腿**不在** `codes` 内（账本同样按 `1 − Σ证券` 反算现金）⇒ 换手天然是
      「单边证券腿」口径（`LEDGER_CONTRACT.turnover = one_way_stock_legs`）。
    * 明细可再按「角色是否切换」二次切分（H4 判据），`total == Σ|delta|`。
    """
    sig = signals[["trade_date", "code", "target_weight"]].copy()
    sig["code"] = sig["code"].astype(str)
    ret = returns[["trade_date", "code", "ret_1d"]].copy()
    ret["code"] = ret["code"].astype(str)

    w_sig_raw = sig.pivot(index="trade_date", columns="code", values="target_weight")
    r_mat = ret.pivot(index="trade_date", columns="code", values="ret_1d")
    cal = sorted(calendar)
    codes = sorted(set(w_sig_raw.columns) | set(r_mat.columns))
    sig_dates = set(w_sig_raw.index)
    w_sig = w_sig_raw.reindex(index=cal, columns=codes).fillna(0.0)
    r_mat = r_mat.reindex(index=cal, columns=codes)
    prev = {cal[i]: cal[i - 1] for i in range(1, len(cal))}
    holdings = {c: 0.0 for c in codes}

    rows = []
    for t in cal:
        ret_t = r_mat.loc[t]
        gross = 0.0
        for c in codes:
            h = holdings.get(c, 0.0)
            if h <= 0:
                continue
            rc = ret_t.get(c, np.nan)
            if not pd.isna(rc):
                gross += h * float(rc)
        denom = 1.0 + gross
        pre_trade = {}
        for c in codes:
            h = holdings.get(c, 0.0)
            rc = ret_t.get(c, 0.0)
            if pd.isna(rc):
                rc = 0.0
            pre_trade[c] = h * (1.0 + float(rc)) / denom if denom > 0 else 0.0

        sig_date = prev.get(t) if execution_lag == 1 else t
        has_signal = sig_date is not None and sig_date in w_sig.index and sig_date in sig_dates
        if has_signal:
            target = {c: float(w_sig.loc[sig_date, c]) for c in codes}
        else:
            target = dict(pre_trade)

        for c in codes:
            a = pre_trade[c]
            b = target[c]
            d = b - a
            if a <= 0.0 and b > 0.0:
                kind = "entry"
            elif a > 0.0 and b <= 0.0:
                kind = "exit"
            elif a > 0.0 and b > 0.0:
                kind = "reweight"
            else:
                kind = "none"
            rows.append({"trade_date": t, "code": c, "has_signal": bool(has_signal),
                         "pre_trade": a, "target": b, "delta": d, "kind": kind})
        holdings = {c: target[c] for c in codes}
    return pd.DataFrame(rows)


def replay_turnover(signals: pd.DataFrame, returns: pd.DataFrame, calendar: list,
                    execution_lag: int = 1) -> pd.DataFrame:
    """逐日换手来源汇总（`entry` / `exit` / `reweight` / `total`），由明细聚合而来。"""
    det = replay_turnover_detail(signals, returns, calendar, execution_lag)
    ad = det["delta"].abs()
    det = det.assign(
        entry=np.where(det["kind"] == "entry", ad, 0.0),
        exit=np.where(det["kind"] == "exit", ad, 0.0),
        reweight=np.where(det["kind"] == "reweight", ad, 0.0),
        total=ad,
    )
    return det.groupby("trade_date", sort=True).agg(
        has_signal=("has_signal", "first"),
        entry=("entry", "sum"), exit=("exit", "sum"),
        reweight=("reweight", "sum"), total=("total", "sum")).reset_index()


# --------------------------------------------------------------------------- #
# 辅助
# --------------------------------------------------------------------------- #

def _year_returns(net: pd.Series, dates) -> dict:
    s = pd.Series(net.values, index=pd.to_datetime(pd.Series(list(dates))))
    return {str(y): _pct(float((1.0 + g).prod() - 1.0)) for y, g in s.groupby(s.index.year)}


def _run_streaks(flag: pd.Series) -> dict:
    """连续 True 区段长度分布（用于 CORE==0 的连续空仓区段）。"""
    lengths = []
    cur = 0
    for v in flag.values:
        if bool(v):
            cur += 1
        elif cur:
            lengths.append(cur)
            cur = 0
    if cur:
        lengths.append(cur)
    s = pd.Series(lengths, dtype=int)
    return {
        "segments": int(len(s)),
        "max_len": int(s.max()) if len(s) else 0,
        "mean_len": round(float(s.mean()), 2) if len(s) else 0.0,
        "hist": {str(k): int(v) for k, v in s.value_counts().sort_index().items()} if len(s) else {},
    }


def _ret_stats(rets: pd.Series) -> dict:
    r = pd.Series(rets).dropna().astype(float)
    if r.empty:
        return {"days": 0}
    return {
        "days": int(len(r)),
        "mean_pct": _pct(float(r.mean())),
        "sum_pct": _pct(float((1.0 + r).prod() - 1.0)),
        "pos_days": int((r > 0).sum()),
        "neg_days": int((r < 0).sum()),
        "best_pct": _pct(float(r.max())),
        "worst_pct": _pct(float(r.min())),
    }


def main() -> int:
    ap = argparse.ArgumentParser(description="M2-B 定向归因（POSTMORTEM_NOT_FOR_CALIBRATION）")
    ap.add_argument("--out", required=True)
    ap.add_argument("--tmp", default=None)
    a = ap.parse_args()

    # ---- 冻结配置（与 B3 同一派生路径）----
    bundle = json.loads(b3._abs(b3.BUNDLE_REL).read_text(encoding="utf-8"))
    cfg, cfg_attest = b3.derive_config(bundle, load_gen2_config())
    assert not cfg_attest["drift"], "运行配置与冻结 bundle 存在漂移，M2-B 拒绝继续"

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

    pcfg = cfg["portfolio"]
    cap_single = float(pcfg.get("max_single_weight", 0.25))
    cap_cluster = float(pcfg.get("max_cluster_weight", 0.40))
    cap_tech = float(pcfg.get("max_tech_weight", 0.65))
    tech_cl = set(pcfg.get("tech_clusters", ["tech_hardware", "software_ai"]))
    dcfg = dict(pcfg.get("defense") or {})
    hedge_code = str(dcfg.get("hedge_code", "518880")).zfill(6)
    # 角色阈值：**必须**取自冻结配置（`core_pct = 1 − core_top_fraction = 0.80`），不得硬编码
    thr = load_role_thresholds(cfg)
    core_pct = float(thr.core_pct)
    print(f"[M2B] 角色阈值（冻结来源 {thr.source}）：core_pct = {core_pct}")

    universe = load_universe_definition()
    main5 = list(universe["incumbent_main5"])

    features = build_feature_matrix(bars=load_daily_bars(),
                                    records=load_universe_records(), config=cfg)
    rankings = run_rank_engine(features)
    selection = canonical_selection_scores(features)
    print("[M2B] 特征 / 排名 / 权威 Alpha 已就绪")

    roles = build_v2_role_view(features, rankings, cfg, selection_scores=selection)
    prio = priority_from_roles(roles)
    cand_panel = build_portfolio_candidates(roles, priority=prio, config=cfg)
    def_panel = build_portfolio_candidates(roles, priority=prio, config=cfg,
                                           features=features, apply_defense=True)
    print("[M2B] 角色 + 候选面板已就绪")

    weights_map = build_weight_frames(features, rankings, cfg, main5, selection_scores=selection)
    weights_map.pop("_roles", None)

    # ================== T1：D1 / D2 权重帧 + D2 复现校验 ==================
    rs = roles[["trade_date", "code", "relative_share"]].copy()
    rs["code"] = rs["code"].astype(str)

    # C 层帧（与 M2 同法合成，保证与 M2 的 C→D 逐位可比）
    nc = cand_panel.copy()
    nc["target_weight"] = 0.0
    core_n_by_day = {}
    for d, g in nc.groupby("trade_date", sort=True):
        idx = g.index[g["role"].astype(str) == "CORE"]
        core_n_by_day[_dstr(d)] = int(len(idx))
        if len(idx):
            nc.loc[idx, "target_weight"] = 1.0 / float(len(idx))
    weights_map["core_equal_weight"] = ledger_signals(nc)

    # D1 层帧：只做步①（单只截断）
    c1 = cand_panel[["trade_date", "code"]].copy()
    c1["code"] = c1["code"].astype(str)
    d1 = c1.merge(rs, on=["trade_date", "code"], how="left")
    d1["relative_share"] = d1["relative_share"].fillna(0.0).astype(float)
    d1["target_weight"] = d1["relative_share"].clip(upper=cap_single)
    weights_map["core_single_cap_only"] = ledger_signals(d1)

    # D2 复现：从 D1 出发跑步②（cluster）+ 步③（科技），与权威 target_weight 逐位比对
    core_auth = roles[roles["role"].astype(str) == "CORE"][
        ["trade_date", "code", "correlation_cluster", "relative_share", "target_weight"]].copy()
    chk = core_auth.copy()
    chk["w1"] = chk["relative_share"].astype(float).clip(upper=cap_single)
    pieces = []
    for (_d, _cl), g in chk.groupby(["trade_date", "correlation_cluster"]):
        g = g.copy()
        tot = float(g["w1"].sum())
        g["w2"] = g["w1"] * (cap_cluster / tot) if tot > cap_cluster else g["w1"]
        pieces.append(g)
    chk = pd.concat(pieces, ignore_index=True)
    shrink_cluster = chk["w2"].astype(float).sum() - chk["w1"].astype(float).sum()
    pieces = []
    for _d, g in chk.groupby("trade_date"):
        g = g.copy()
        tm = g["correlation_cluster"].isin(tech_cl)
        tt = float(g.loc[tm, "w2"].sum())
        if tt > cap_tech:
            g.loc[tm, "w2"] = g.loc[tm, "w2"] * (cap_tech / tt)
        pieces.append(g)
    chk = pd.concat(pieces, ignore_index=True)
    shrink_tech = chk["w2"].astype(float).sum() - chk["w1"].astype(float).sum() - shrink_cluster
    diff = (chk["w2"].astype(float) - chk["target_weight"].astype(float)).abs()
    d2_repro = {
        "n_core_rows": int(len(chk)),
        "max_abs_diff_vs_authoritative_target_weight": float(diff.max()) if len(diff) else 0.0,
        "exact_match": bool(float(diff.max()) <= _TOL) if len(diff) else True,
        "note": ("从 D1 复跑步②③ 得到的权重 vs `roles.target_weight`（权威 D2）。"
                 "逐位一致 ⇒ C→D1→D2 拆分与冻结实现同源。"),
    }
    print(f"[M2B] D2 复现校验：exact={d2_repro['exact_match']} "
          f"max_abs_diff={d2_repro['max_abs_diff_vs_authoritative_target_weight']:.3e}")

    returns = features[["trade_date", "code", "ret_1d"]].copy()
    calendar, win_meta = common_evaluation_calendar(weights_map, returns)

    # ---- 账本（同一日历 / 同一期初 / T+1）----
    daily_frames = []
    for bps in COSTS:
        for name, wdf in weights_map.items():
            led = run_ledger(wdf, returns, cost_bps=float(bps), calendar=calendar,
                             execution_lag=1, strict=True)
            led["strategy"] = name
            led["cost_bps"] = float(bps)
            daily_frames.append(led)
    daily = pd.concat(daily_frames, ignore_index=True)

    oos = b3.derive_oos_window(sorted(rankings["trade_date"].unique()))
    oos_dates = [_dstr(d) for d in oos["dates"]]
    oos_set = set(oos_dates)
    daily_oos = daily[daily["trade_date"].astype(str).str[:10].isin(oos_set)].copy()
    print(f"[M2B] OOS {oos_dates[0]} → {oos_dates[-1]} ({len(oos_dates)} 日)")

    # ---- 身份证明：重算全窗口 == 已接受 B1 报告读数 ----
    tmp = Path(a.tmp) if a.tmp else Path.home() / ".cache" / "gen2-m2b"
    tmp.mkdir(parents=True, exist_ok=True)
    res = build_unified_baselines(output_dir=tmp / "ledger", report_dir=tmp / "ledger",
                                  config=cfg, run_id="m2b_targeted_readonly")
    accepted_rows = b3.parse_report_readings(
        b3._abs(b3.ACCEPTED_B1_REPORT_REL).read_text(encoding="utf-8"))
    repro = b3.verify_reproduction(res["summary"], accepted_rows)
    print(f"[M2B] B1 复现核对：all_match={repro['all_match']} "
          f"mismatched={repro.get('mismatched_cells')}")

    def series(name: str, bps: float) -> pd.DataFrame:
        return daily_oos[(daily_oos["strategy"] == name)
                         & (daily_oos["cost_bps"] == bps)].sort_values("trade_date")

    def cum(name: str, bps: float) -> float:
        return float((1.0 + series(name, bps)["net_return"]).prod() - 1.0)

    # ============================ T1 分解 ============================
    layer_names = ["main5_equal_weight", "universe_equal_weight", "core_equal_weight",
                   "core_single_cap_only", "gen2_v2_undefended", "gen2_v2_defended"]
    p0 = {nm: cum(nm, 0.0) for nm in layer_names}
    cd1 = p0["core_single_cap_only"] - p0["core_equal_weight"]
    d1d2 = p0["gen2_v2_undefended"] - p0["core_single_cap_only"]
    cd = p0["gen2_v2_undefended"] - p0["core_equal_weight"]
    t1_lines = [
        {"step": "C→D1", "layer": "单只截断（min(1/|CORE|, 0.25)）及其新增残差现金",
         "delta_pct": _pct(cd1)},
        {"step": "D1→D2", "layer": "cluster(0.40)/科技(0.65) 缩权及其新增残差现金",
         "delta_pct": _pct(d1d2)},
    ]
    t1_closure = {
        "C_to_D1_pct": _pct(cd1),
        "D1_to_D2_pct": _pct(d1d2),
        # 注意：sum 用**未取整**的两段先相加再取整，避免二次取整造成显示层的假不闭合
        "sum_pct": _pct(cd1 + d1d2),
        "C_to_D_pct_M2_baseline": _pct(cd),
        "identity_gap_pct": round((cd1 + d1d2) - cd, 12),
        "exact_identity": bool(abs((cd1 + d1d2) - cd) <= 1e-12),
        "rounding_note": ("`sum_pct` 由未取整两段相加后取整；与 `C_to_D_pct_M2_baseline` "
                          "**必然相等**（二者是同一个数）。即便逐段先取整后相加出现 0.01 的显示差，"
                          "`identity_gap_pct` 仍严格为 0。"),
        "note": "两段加总**恒等**于原 C→D；剩余权重全部留作现金，未重新分配给其他 ETF。",
    }

    # 残差现金：逐日 1 − Σ证券
    def _cash_series(panel: pd.DataFrame) -> pd.Series:
        sec = panel[panel["code"].astype(str) != "CASH"]
        s = sec.groupby("trade_date")["target_weight"].sum().astype(float)
        return (1.0 - s).clip(lower=0.0)

    cash_c = _cash_series(nc)
    cash_d1 = _cash_series(d1)
    cash_d2 = _cash_series(cand_panel)
    cash_layers = {}
    for lbl, s in (("C_core_equal_weight", cash_c), ("D1_single_cap_only", cash_d1),
                   ("D2_undefended", cash_d2)):
        so = s[[_dstr(i) in oos_set for i in s.index]]
        cash_layers[lbl] = {
            "avg_full_window": round(float(s.mean()), 4),
            "avg_oos": round(float(so.mean()), 4) if len(so) else None,
            "max": round(float(s.max()), 4),
            "days_with_zero_cash": int((s <= 1e-12).sum()),
            "days": int(len(s)),
        }
    cash_layers["incremental_new_cash_pct_points"] = {
        "C_to_D1": round((float(cash_d1.mean()) - float(cash_c.mean())) * 100.0, 2),
        "D1_to_D2": round((float(cash_d2.mean()) - float(cash_d1.mean())) * 100.0, 2),
        "note": "全窗口均值口径；新增现金 = 该步被截断/缩减掉、未被再分配出去的权重。",
    }
    cash_layers["oos_incremental_new_cash_pct_points"] = {
        "C_to_D1": round(
            (float(cash_d1[[_dstr(i) in oos_set for i in cash_d1.index]].mean())
             - float(cash_c[[_dstr(i) in oos_set for i in cash_c.index]].mean())) * 100.0, 2),
        "D1_to_D2": round(
            (float(cash_d2[[_dstr(i) in oos_set for i in cash_d2.index]].mean())
             - float(cash_d1[[_dstr(i) in oos_set for i in cash_d1.index]].mean())) * 100.0, 2),
    }

    t1_shrink = {
        "cluster_shrink_sum_w": round(float(shrink_cluster), 6),
        "tech_shrink_sum_w": round(float(shrink_tech), 6),
        "note": ("D1→D2 内部成因（权重层面，非账本分解，不参与主分解加总）："
                 "cluster 缩权 vs 科技缩权各缩掉多少 Σw。"),
    }

    # ============================ T2：H2 描述性诊断 ============================
    cn = pd.Series(core_n_by_day)
    cn.index = [_dstr(i) for i in cn.index]
    cn = cn.sort_index()
    zero_flag = (cn.astype(int) == 0)
    zero_all = [d for d in cn.index if zero_flag[d]]
    zero_oos = [d for d in zero_all if d in oos_set]
    oos_cal = sorted({_dstr(d) for d in calendar if _dstr(d) in oos_set})

    feats = features.copy()
    feats["code"] = feats["code"].astype(str).str.zfill(6)
    mkt = feats[feats["code"] == "510300"].set_index("trade_date")["ret_1d"]
    mkt.index = [_dstr(i) for i in mkt.index]
    pool_ew = feats.groupby("trade_date")["ret_1d"].mean()
    pool_ew.index = [_dstr(i) for i in pool_ew.index]
    tech_codes = set(roles.loc[roles["correlation_cluster"].isin(tech_cl), "code"].astype(str))
    tech_ew = feats[feats["code"].isin(tech_codes)].groupby("trade_date")["ret_1d"].mean()
    tech_ew.index = [_dstr(i) for i in tech_ew.index]

    rs_state = roles.groupby("trade_date")["reason_codes"].apply(
        lambda s: "|".join(str(x) for x in s)).to_dict() if "reason_codes" in roles.columns else {}
    rs_state = {_dstr(k): v for k, v in rs_state.items()}
    state_by_day = {}
    if "risk_state" in features.columns:
        state_by_day = {_dstr(k): str(v) for k, v in
                        features.groupby("trade_date")["risk_state"].first().items()}

    def _fwd(market: pd.Series, days: int) -> dict:
        """CORE==0 日起第 `days` 个交易日的前瞻累计收益（**纯描述**，不是任何替代策略）。"""
        idx = list(market.index)
        pos = {d: i for i, d in enumerate(idx)}
        vals = []
        for d in zero_oos:
            i = pos.get(d)
            if i is None or i + days >= len(idx):
                continue
            win = market.iloc[i + 1:i + 1 + days]
            vals.append(float((1.0 + win).prod() - 1.0))
        if not vals:
            return {"n": 0}
        s = pd.Series(vals)
        return {"n": int(len(s)), "mean_pct": _pct(float(s.mean())),
                "median_pct": _pct(float(s.median())),
                "pos_share_pct": _pct(float((s > 0).mean()))}

    zero_ms = mkt.reindex(zero_oos).dropna()
    zero_pool = pool_ew.reindex(zero_oos).dropna()
    zero_tech = tech_ew.reindex(zero_oos).dropna()
    t2 = {
        "definition": ("`CORE==0` = 当日 `role == 'CORE'` 的标的数为 0。"
                       "此时 `rule_v2_ab` 的 `target_weight` 全为 0（CHALLENGER/SATELLITE 恒 0）"
                       "⇒ **整仓现金**，`cash_weight = 1.0`（结构性，非防守所致）。"),
        "counts": {
            "full_window_days": int(len(cn)),
            "full_window_core_zero_days": int(len(zero_all)),
            "full_window_core_zero_pct": _pct(len(zero_all) / len(cn)) if len(cn) else None,
            "oos_days": int(len(oos_cal)),
            "oos_core_zero_days": int(len(zero_oos)),
            "oos_core_zero_pct": _pct(len(zero_oos) / len(oos_cal)) if oos_cal else None,
        },
        "streaks_full_window": _run_streaks(zero_flag),
        "streaks_oos": _run_streaks(pd.Series({d: (d in set(zero_oos)) for d in oos_cal})),
        "cash_exposure": {"value_on_core_zero_days": 1.0,
                          "note": "结构性整仓现金；未构造任何替代持仓、未跑任何账本。"},
        "market_ret_on_core_zero_days": _ret_stats(zero_ms),
        "pool_equal_weight_ret_on_core_zero_days": _ret_stats(zero_pool),
        "tech_cluster_ew_ret_on_core_zero_days": _ret_stats(zero_tech),
        "foresight_market_cum_ret_from_core_zero_days": {
            "5d": _fwd(mkt, 5), "20d": _fwd(mkt, 20)},
        "by_year": {},
        "state_machine_reasons_on_core_zero_days": {},
        "boundary_statement": (
            "以上全部为**描述性统计**：只读原始收益序列与角色面板。"
            "**未**构造任何替代规则（未测『CORE==0 时改持有前仓 / 买入 challenger / 持有全池等权』等）；"
            "该类替代行为必须留给 O2 未观察段验证。"),
    }
    for y in sorted({d[:4] for d in zero_oos}):
        t2["by_year"][y] = {"core_zero_days": sum(1 for d in zero_oos if d[:4] == y)}

    # 状态机触发原因（CORE==0 当日）
    if "reason_codes" in roles.columns:
        rd = roles.copy()
        rd["d"] = rd["trade_date"].map(_dstr)
        sub = rd[rd["d"].isin(set(zero_oos))]
        toks = {}
        for s in sub["reason_codes"]:
            for tok in str(s).split("|"):
                tok = tok.strip()
                if tok:
                    toks[tok] = toks.get(tok, 0) + 1
        day_tok = {}
        for d in zero_oos:
            g = rd[rd["d"] == d]
            for s in g["reason_codes"]:
                for tok in str(s).split("|"):
                    tok = tok.strip()
                    if tok:
                        day_tok[tok] = day_tok.get(tok, 0) + 1
        trend_true = {}
        if "trend_gate" in rd.columns:
            for d in zero_oos:
                g = rd[rd["d"] == d]
                trend_true[d] = int(g["trend_gate"].astype(bool).sum())
        # 「够格」漏斗：alpha 前 core_top_fraction（alpha_pct >= core_pct，阈值取自冻结配置）
        # → 再叠加趋势闸门。用于定位「哪一环断掉」，**不用于选择任何阈值**。
        funnel_alpha = {}
        funnel_both = {}
        if "alpha_pct" in rd.columns:
            for d in zero_oos:
                g = rd[rd["d"] == d]
                a_ok = g["alpha_pct"].astype(float) >= core_pct
                funnel_alpha[d] = int(a_ok.sum())
                if "trend_gate" in g.columns:
                    funnel_both[d] = int((a_ok & g["trend_gate"].astype(bool)).sum())
        # Selection Permission 模式（RISK_ON→ACTIVE / RANGE→REDUCED / RISK_OFF→DISABLED）
        ms_by_day = {}
        if "market_score" in features.columns:
            ms_by_day = {_dstr(k): float(v) for k, v in
                         features.groupby("trade_date")["market_score"].first().items()}
        mode_by_day = {d: selection_mode(v) for d, v in ms_by_day.items()}
        _ro = [d for d in oos_cal if state_by_day.get(d) == "RISK_OFF"]
        _nro = [d for d in oos_cal if state_by_day.get(d) != "RISK_OFF"]
        _zs = set(zero_oos)
        t2["state_machine_reasons_on_core_zero_days"] = {
            "reason_code_token_counts": dict(sorted(toks.items(), key=lambda kv: -kv[1])[:25]),
            "reason_token_days_present": dict(sorted(day_tok.items(), key=lambda kv: -kv[1])[:25]),
            "trend_gate_true_count_stats": {
                "mean": round(float(np.mean(list(trend_true.values()))), 2) if trend_true else None,
                "min": int(min(trend_true.values())) if trend_true else None,
                "max": int(max(trend_true.values())) if trend_true else None,
            } if trend_true else None,
            "alpha_qualified_funnel": {
                "core_pct_threshold_used": core_pct,
                "threshold_source": f"load_role_thresholds(cfg).core_pct（{thr.source}；= 1 − core_top_fraction）",
                "days": int(len(funnel_alpha)),
                "mean_alpha_qualified": round(float(np.mean(list(funnel_alpha.values()))), 2)
                if funnel_alpha else None,
                "min_alpha_qualified": int(min(funnel_alpha.values())) if funnel_alpha else None,
                "max_alpha_qualified": int(max(funnel_alpha.values())) if funnel_alpha else None,
                "days_with_zero_alpha_qualified": int(sum(1 for v in funnel_alpha.values() if v == 0)),
                "mean_alpha_and_trend_gate": round(float(np.mean(list(funnel_both.values()))), 2)
                if funnel_both else None,
                "max_alpha_and_trend_gate": int(max(funnel_both.values())) if funnel_both else None,
                "days_with_zero_alpha_and_trend_gate": int(
                    sum(1 for v in funnel_both.values() if v == 0)) if funnel_both else None,
                "note": ("「alpha 够格」= `alpha_pct >= core_pct`（前 `core_top_fraction` 比例）；"
                         "第二列再叠加 `trend_gate`。阈值**取自冻结配置**，未自创、不用于调参。"),
            },
            "selection_mode_on_core_zero_days": dict(pd.Series(
                [mode_by_day.get(d) or "UNKNOWN" for d in zero_oos]).value_counts().items())
            if mode_by_day else None,
            "risk_off_cross_tab_oos": {
                "risk_off_days": int(len(_ro)),
                "risk_off_core_zero_days": int(sum(1 for d in _ro if d in _zs)),
                "risk_off_core_zero_pct": _pct(sum(1 for d in _ro if d in _zs) / len(_ro)) if _ro else None,
                "non_risk_off_days": int(len(_nro)),
                "non_risk_off_core_zero_days": int(sum(1 for d in _nro if d in _zs)),
                "non_risk_off_core_zero_pct": _pct(sum(1 for d in _nro if d in _zs) / len(_nro))
                if _nro else None,
                "note": ("RISK_OFF 由被锁定的 `selection_permission.selection_mode` 判定"
                         "（RISK_OFF → `DISABLED`：**仅禁新晋升、不清现任 CORE**）。"),
            },
            "risk_state_on_core_zero_days": dict(pd.Series(
                [state_by_day.get(d) or "UNKNOWN" for d in zero_oos]).value_counts().items())
            if state_by_day else None,
            "note": ("计数单位 = 「标的·日」出现次数。仅描述，不用于选择阈值或参数。"),
        }

    # ============================ T3：H4 换手归因 ============================
    tgt_name = "gen2_v2_defended"
    led10 = series(tgt_name, PRIMARY).copy()
    led0 = series(tgt_name, 0.0).copy()
    rep = replay_turnover(weights_map[tgt_name], returns, calendar, execution_lag=1)
    rep["d"] = rep["trade_date"].map(_dstr)
    rep_oos = rep[rep["d"].isin(oos_set)].copy()
    led10["d"] = led10["trade_date"].map(_dstr)
    align = led10.merge(rep_oos[["d", "entry", "exit", "reweight", "total"]], on="d", how="inner")

    # ---- 换手二次切分：**角色切换驱动** vs **非切换驱动**（直接回答 M2 §6 的 H4 判据）----
    det = replay_turnover_detail(weights_map[tgt_name], returns, calendar, execution_lag=1)
    det["d"] = det["trade_date"].map(_dstr)
    _rl = roles[["trade_date", "code", "role"]].copy()
    _rl["d"] = _rl["trade_date"].map(_dstr)
    _piv = _rl.pivot_table(index="d", columns="code", values="role", aggfunc="first").sort_index()
    _chg = (_piv != _piv.shift(1)) & _piv.shift(1).notna()
    chg_map = {(str(k0), str(k1)): bool(v) for (k0, k1), v in _chg.stack().items()}
    det = det.merge(led10[["d", "signal_date"]], on="d", how="left")
    det["s"] = det["signal_date"].map(_dstr)
    det["abs_delta"] = det["delta"].abs()
    det["role_changed"] = [bool(chg_map.get((str(s), str(c)), False))
                           for s, c in zip(det["s"], det["code"])]
    det_oos = det[det["d"].isin(oos_set)]
    rc_sum = float(det_oos.loc[det_oos["role_changed"], "abs_delta"].sum())
    nrc_sum = float(det_oos.loc[~det_oos["role_changed"], "abs_delta"].sum())
    max_gap = float((align["turnover"].astype(float) - align["total"].astype(float)).abs().max()) \
        if len(align) else 0.0

    turnover_days = align[align["turnover"].astype(float) > 1e-12]
    gaps = []
    prev_pos = None
    for pos, (_ix, row) in enumerate(align.iterrows()):
        if float(row["turnover"]) > 1e-12:
            if prev_pos is not None:
                gaps.append(pos - prev_pos)
            prev_pos = pos

    tot_entry = float(align["entry"].sum())
    tot_exit = float(align["exit"].sum())
    tot_rw = float(align["reweight"].sum())
    tot_all = float(align["total"].sum())
    t3 = {
        "strategy": tgt_name,
        "turnover_source_decomposition": {
            "entry_sum": round(tot_entry, 4),
            "exit_sum": round(tot_exit, 4),
            "reweight_sum": round(tot_rw, 4),
            "total_sum": round(tot_all, 4),
            "entry_share_pct": _pct(tot_entry / tot_all) if tot_all else None,
            "exit_share_pct": _pct(tot_exit / tot_all) if tot_all else None,
            "reweight_share_pct": _pct(tot_rw / tot_all) if tot_all else None,
            "definition": ("逐日 Δ = target − pre_trade（漂移后），单边证券腿口径；"
                           "entry = 从 0 建仓，exit = 清到 0，reweight = 两侧皆 >0 的权重调整。"
                           "现金腿不计费、不参与。"),
        },
        "turnover_by_role_change": {
            "role_change_driven_sum": round(rc_sum, 4),
            "role_unchanged_sum": round(nrc_sum, 4),
            "total_sum": round(rc_sum + nrc_sum, 4),
            "role_change_share_pct": _pct(rc_sum / (rc_sum + nrc_sum)) if (rc_sum + nrc_sum) else None,
            "role_unchanged_share_pct": _pct(nrc_sum / (rc_sum + nrc_sum)) if (rc_sum + nrc_sum) else None,
            "definition": ("按**信号日**该 code 的 `role` 是否相对前一信号日变化，把其 `|delta|` 归入"
                           "「角色切换驱动」或「非切换驱动」（后者含权重重整、cluster 缩权、"
                           "|CORE| 数目变化引起的 1/|CORE| 变化等）。"),
            "m2_h4_criterion": ("M2 §6 H4 判据：若非角色切换日的单边腿占比 > 60% ⇒ **H4 否证**"
                                "（成本层不主要由角色进出驱动）。"),
        },
        "replay_alignment_vs_ledger": {
            "days": int(len(align)),
            "max_abs_turnover_gap": max_gap,
            "exact_match": bool(max_gap <= 1e-9),
            "note": "自实现复现器逐日换手 vs 权威账本 `turnover` 的最大绝对差。",
        },
        "rebalance_frequency": {
            "days_total": int(len(align)),
            "days_with_turnover": int(len(turnover_days)),
            "days_with_turnover_pct": _pct(len(turnover_days) / len(align)) if len(align) else None,
            "avg_turnover_on_active_days": round(float(turnover_days["turnover"].mean()), 4) if len(turnover_days) else None,
            "median_gap_days_between_rebalances": round(float(np.median(gaps)), 2) if gaps else None,
            "max_gap_days": int(max(gaps)) if gaps else None,
            "turnover_per_day_mean": round(float(align["turnover"].mean()), 4) if len(align) else None,
        },
        "cost_drag": {
            "cost_bps_used": PRIMARY,
            "cum_net_pct_0bps": _pct(float((1.0 + led0["net_return"]).prod() - 1.0)),
            "cum_net_pct_10bps": _pct(float((1.0 + led10["net_return"]).prod() - 1.0)),
            "cum_sum_of_costs_pct": _pct(float(led10["cost"].sum())),
            "cost_drag_pp": round(_pct(float((1.0 + led10["net_return"]).prod() - 1.0))
                                  - _pct(float((1.0 + led0["net_return"]).prod() - 1.0)), 2),
            "note": ("只报告**现有 4 档费用**（0/5/10/20 bps）中的主判据口径；"
                     "**不新增费用档、不生成任何『降低成本后』的结果**。"),
        },
        "cash_exposure": {
            "avg_cash_weight_oos": round(float(led10["cash_weight"].mean()), 4),
            "avg_cash_weight_10bps_all": round(float(
                daily[(daily["strategy"] == tgt_name) & (daily["cost_bps"] == PRIMARY)]["cash_weight"].mean()), 4),
            "days_cash_ge_0p90": int((led10["cash_weight"] >= 0.90).sum()),
            "days_cash_le_0p10": int((led10["cash_weight"] <= 0.10).sum()),
        },
        "defense_trigger": {},
    }

    # 成本来源分摊（成本 = Σturnover × bps，可**直接**按三类来源摊，无需额外账本）
    t3["cost_drag"]["cost_attribution_by_source"] = {
        "entry_cost_pct": _pct(tot_entry * PRIMARY / 10000.0),
        "exit_cost_pct": _pct(tot_exit * PRIMARY / 10000.0),
        "reweight_cost_pct": _pct(tot_rw * PRIMARY / 10000.0),
        "sum_pct": _pct((tot_entry + tot_exit + tot_rw) * PRIMARY / 10000.0),
        "note": "合计应等于 `cum_sum_of_costs_pct`；只分摊**现有**成本档，未新增费用档。",
    }
    t3["turnover_by_year"] = {
        str(y): {"entry": round(float(g["entry"].sum()), 4),
                 "exit": round(float(g["exit"].sum()), 4),
                 "reweight": round(float(g["reweight"].sum()), 4),
                 "total": round(float(g["total"].sum()), 4),
                 "days": int(len(g))}
        for y, g in align.groupby(align["d"].str[:4])
    }

    # 防守触发（只读调用被锁定的防守信号构造函数）
    try:
        from gen2.portfolio.defense_gate import DEFAULT_DEFENSE, _build_defense_signal
        dcfg_full = {**DEFAULT_DEFENSE, **dcfg}
        dsig = _build_defense_signal(features, dcfg_full)
        dsig["d"] = dsig["trade_date"].map(_dstr)
        dso = dsig[dsig["d"].isin(oos_set)]
        t3["defense_trigger"] = {
            "state_counts_oos": dict(dso["state"].value_counts().items()),
            "risk_off_days_oos": int((dso["state"] == "RISK_OFF").sum()),
            "risk_off_share_oos_pct": _pct(float((dso["state"] == "RISK_OFF").mean())) if len(dso) else None,
            "vol_scale_lt_one_days_oos": int((dso["core_scale"].astype(float) < 1.0 - 1e-12).sum()),
            "vol_scale_min_oos": round(float(dso["core_scale"].astype(float).min()), 4) if len(dso) else None,
            "hedge_weight_positive_days_oos": int((dso["hedge_weight"].astype(float) > 1e-12).sum()),
            "hedge_code": hedge_code,
            "note": "只读调用被锁定的 `portfolio.defense_gate` 信号构造；未改任何防守参数。",
        }
        ds_all = dsig.copy()
        t3["defense_trigger"]["state_counts_full_window"] = dict(ds_all["state"].value_counts().items())
    except Exception as e:  # noqa: BLE001
        t3["defense_trigger"] = {"error": f"{type(e).__name__}: {e}"}

    # 防守前后敞口对比
    try:
        u = series("gen2_v2_undefended", PRIMARY)[["trade_date", "gross_exposure"]].copy()
        d_ = series(tgt_name, PRIMARY)[["trade_date", "gross_exposure"]].copy()
        u["d"] = u["trade_date"].map(_dstr)
        d_["d"] = d_["trade_date"].map(_dstr)
        cmp_ = u.merge(d_, on="d", suffixes=("_undef", "_def"))
        t3["defense_trigger"]["gross_exposure_oos"] = {
            "undefended_mean": round(float(cmp_["gross_exposure_undef"].mean()), 4),
            "defended_mean": round(float(cmp_["gross_exposure_def"].mean()), 4),
            "days_defended_lt_undefended": int((cmp_["gross_exposure_def"] < cmp_["gross_exposure_undef"] - 1e-12).sum()),
        }
    except Exception as e:  # noqa: BLE001
        t3["defense_trigger"]["gross_exposure_oos_error"] = f"{type(e).__name__}: {e}"

    # ============================ 组装输出 ============================
    core = {
        "identity_check_vs_accepted_b1": {
            "all_match": repro["all_match"],
            "mismatched_cells": repro.get("mismatched_cells"),
            "note": "重算全窗口读数 == 已接受 B1 报告逐位 ⇒ 本诊断跑在同一条被接受的规则上",
        },
        "oos_window": {"first": oos_dates[0], "last": oos_dates[-1], "days": len(oos_dates)},
        "common_calendar": {"first": str(calendar[0]), "last": str(calendar[-1]),
                            "days": len(calendar),
                            "excluded_leading_days": int(win_meta["excluded_leading_days"])},
        "T1_cd_split": {
            "pipeline": "relative_share = 1/|CORE| → ①min(·,0.25) → ②cluster 0.40 → ③科技 0.65",
            "lines_0bps": t1_lines,
            "closure": t1_closure,
            "d2_reproduction_check": d2_repro,
            "residual_cash_layers": cash_layers,
            "d1_to_d2_internal_causes": t1_shrink,
            "layer_cum_net_pct_0bps": {nm: _pct(p0[nm]) for nm in layer_names},
            "layer_cum_net_pct_10bps": {nm: _pct(cum(nm, PRIMARY)) for nm in layer_names},
        },
        "T2_h2_core_zero_descriptive": t2,
        "T3_h4_turnover_attribution": t3,
    }

    outp = Path(a.out)
    outp.parent.mkdir(parents=True, exist_ok=True)

    def _dump(obj: dict, label: str) -> str:
        try:
            return json.dumps(obj, ensure_ascii=False, indent=1)
        except TypeError as e:  # noqa: PERF203
            print(f"[M2B][WARN] {label} 含非 JSON 原生类型，退回 default=str：{e}")
            return json.dumps(obj, ensure_ascii=False, indent=1, default=str)

    ckpt = outp.with_name(outp.name + ".checkpoint.json")
    ckpt.write_text(_dump(core, "checkpoint"), encoding="utf-8")
    print(f"[M2B] checkpoint wrote {ckpt}")

    payload = {
        "attribution": "gen2_m2b_targeted_attribution",
        "generated_on": pd.Timestamp.now().date().isoformat(),
        "protocol": PROTOCOL,
        "ruling": ("用户裁决 2026-09-16：① 合并 PR #37；② H2 **不批准**独立替代规则回测，"
                   "只允许纯描述性诊断；③ H1/H3 暂缓至 M1-B 完成后验证；④ H4 允许继续但**只限归因**"
                   "（不改手续费档 / 不改再平衡频率 / 不生成优化后的成本结果）；"
                   "⑤ C→D 允许拆分，但必须是**会计式分解**且两段严格加总回原 C→D，"
                   "残差不得重新分配给其他 ETF；⑥ cluster_taxonomy_v1 **暂不**纳入 immutable_set。"
                   "未触碰规则 / 参数 / 数据版本 / lock / OOS 分割。"),
        "frozen_input": {
            "bundle_version": bundle["bundle_version"],
            "bundle_sha256": b3._sha(b3.BUNDLE_REL),
            "config_drift": cfg_attest["drift"],
            "regime_constants_crosscheck": regime_xcheck,
            "portfolio_caps": {k: pcfg[k] for k in (
                "max_single_weight", "max_cluster_weight", "max_tech_weight", "tech_clusters",
                "max_core_count", "max_core_per_cluster")},
            "defense": dcfg,
            "role_thresholds": pcfg["role_thresholds"],
        },
        **core,
        "no_calibration_statement": (
            "本文件**未**产生任何新参数、新阈值、新 bundle/lock；未重跑 OOS 以寻找通过结果；"
            "未构造任何替代规则并回测（CORE==0 的替代行为留给 O2 未观察段）；"
            "未改动数据版本与 OOS 分割。Rule V2.0.1 仍为 ACCEPTED_FAIL / NOT_PRODUCTION_ELIGIBLE。"),
    }
    outp.write_text(_dump(payload, "payload"), encoding="utf-8")
    print(f"[M2B] wrote {outp}")

    print("[M2B] T1 C→D1→D2（OOS 累计, 0bps）：")
    for row in t1_lines:
        print(f"   {row['step']:<7} {row['delta_pct']:>9.2f} pct  {row['layer']}")
    print(f"   闭合校验：C→D1 + D1→D2 = {t1_closure['sum_pct']} vs 原 C→D "
          f"{t1_closure['C_to_D_pct_M2_baseline']}，gap={t1_closure['identity_gap_pct']}")
    print("[M2B] T2 CORE==0：", json.dumps(t2["counts"], ensure_ascii=False))
    print("[M2B] T3 换手来源：", json.dumps(
        {k: v for k, v in t3["turnover_source_decomposition"].items() if k.endswith("_share_pct")},
        ensure_ascii=False))
    _rc = t3["turnover_by_role_change"]
    print(f"[M2B] T3 H4 判据：角色切换驱动 {_rc['role_change_share_pct']}% vs "
          f"非切换 {_rc['role_unchanged_share_pct']}%（>60% 非切换 ⇒ H4 否证）")
    return 0


if __name__ == "__main__":
    sys.exit(main())
