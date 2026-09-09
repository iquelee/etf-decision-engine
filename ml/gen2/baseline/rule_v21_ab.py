"""Gen-2.1 M3 — V2.1 角色状态机（Rule V2.1 变体，Validation 层草案）。

派生自 V2 frozen 状态机（`rule_v2_ab.build_v2_roles`，**V2 文件零改动**），
本模块为 V2.1 研究变体副本，逐段对齐 V2 主体并在下列差异点注入 V2.1 语义
（每处标注 `V21-DELTA`；V2 状态机若有修复，须同步到本副本并跑 parity 回归）：

  V21-DELTA-1  Cluster Leadership 准入门：晋升 CORE 的 challenger 必须
               is_cluster_leader & cluster_top（消除跨资产类别无意义轮动）。
  V21-DELTA-2  Consolidation Quality Gate：晋升 CORE 的 challenger 须
               consolidation_quality >= min_quality（Gate OFF=min_quality None 时恒过）。
  V21-DELTA-3  Turnover-aware Replacement：cap 挤出现任 CORE 时，是否接受替换
               由 5 硬门 replacement_gate() 判定（替代 V2 的 min_edge>=8）；
               tenure（连续在位天数）>= min_hold_days 才可被替换。

输出 schema 与 V2 一致（trade_date/code/name/correlation_cluster/role/alpha_score_v2/
alpha_rank/alpha_pct/perm_mode/trend_gate/reason_codes + 权重列），可直接消费
economic_replay / ledger / event attribution 基建。V21 事件以 `V21_*` 前缀标记。

运行（三臂 Validation 2024 runner 见模块尾部）：
    PYTHONPATH=ml python -m gen2.baseline.rule_v21_ab --arms
"""
from __future__ import annotations

import numpy as np
import pandas as pd

from gen2.backtest.benchmark import build_benchmark_weights
from gen2.baseline.alpha_score import compute_alpha_score_v2
from gen2.data.loader import load_gen2_config, load_universe_definition, load_universe_records
from gen2.portfolio.cluster_leadership import compute_cluster_leadership
from gen2.portfolio.consolidation_gate import compute_consolidation_quality
from gen2.portfolio.regime import classify_regime
from gen2.portfolio.role_engine import _cap_core_roles, _consecutive_by_code
from gen2.portfolio.selection_permission import DISABLED, max_core_count, selection_mode
from gen2.portfolio.turnover_aware_replacement import DEFAULT_V21_REPLACEMENT, replacement_gate


def _initial_roles_from_records(records: dict) -> dict[str, str]:
    roles = {}
    for code, rec in records.items():
        if not rec.core_eligible or rec.research_only:
            continue
        if rec.strategic_role_hint == "hedge":
            roles[code] = "HEDGE"
        elif rec.incumbent:
            roles[code] = "CORE"
        else:
            roles[code] = "RESERVE"
    return roles


def _prepare_v21_inputs(features: pd.DataFrame, rankings: pd.DataFrame, cl_cfg: dict) -> dict:
    """一次性预计算 V2.1 全部共享输入（alpha 子集 + quality + cluster flags），供多臂复用。

    返回 dict：
        alpha_sub : [trade_date, code, alpha_score_v2, market_score, px_ma60]
        quality   : [trade_date, code, quality]
        code_flag : [trade_date, code, is_cluster_leader, cluster_top]
    """
    alpha_sub = compute_alpha_score_v2(features)[["trade_date", "code", "alpha_score_v2",
                                                  "market_score", "px_ma60"]]
    quality = compute_consolidation_quality(features)[["trade_date", "code", "quality"]]
    panel = rankings.merge(alpha_sub, on=["trade_date", "code"], how="left")
    _, code_flag = compute_cluster_leadership(
        panel, top_cluster_count=int(cl_cfg.get("top_cluster_count", 4)),
        cluster_min_members=int(cl_cfg.get("cluster_min_members", 1)),
        leaders_per_cluster=int(cl_cfg.get("leaders_per_cluster", 2)),
        breadth_min_pos=float(cl_cfg.get("breadth_min_pos", 0.5)))
    return {"alpha_sub": alpha_sub, "quality": quality,
            "code_flag": code_flag[["trade_date", "code", "is_cluster_leader", "cluster_top"]]}


def build_v21_roles(features: pd.DataFrame, rankings: pd.DataFrame, config: dict,
                    v21_cfg: dict | None = None,
                    prepared: dict | None = None) -> pd.DataFrame:
    """V2.1 状态机（cluster 准入 + consolidation Gate + turnover-aware replacement 5 硬门）。

    v21_cfg（从 DRAFT 读取传入，禁止硬编码 shadow config）：
        min_quality                consolidation Gate 门槛（None = Gate OFF）
        cluster {top_cluster_count, cluster_min_members, leaders_per_cluster, breadth_min_pos}
        replacement {min_hold_days, cost_bps, ...（覆盖 DEFAULT_V21_REPLACEMENT）}
    prepared：可选 dict（_prepare_v21_inputs 输出）——多臂/重复调用共享预计算以省时。
    """
    from gen2.data.loader import load_universe_records

    cfg = {**(v21_cfg or {})}
    cl_cfg = cfg.get("cluster", {})
    repl_cfg = {**DEFAULT_V21_REPLACEMENT, **(cfg.get("replacement", {}) or {})}
    min_quality = cfg.get("min_quality")  # None → Gate OFF

    records = load_universe_records()
    pcfg = config["portfolio"]
    promotion_days = int(pcfg.get("promotion_persistence_days", 5))
    demotion_days = int(pcfg.get("demotion_persistence_days", 5))
    max_core_per_cluster = int(pcfg.get("max_core_per_cluster", 2))
    base_max_core = int(pcfg.get("max_core_count", 5))
    core_pct = 0.80
    satellite_pct = 0.60

    if prepared is not None:
        alpha = prepared["alpha_sub"]
        quality, code_flag = prepared["quality"], prepared["code_flag"]
    else:
        alpha = compute_alpha_score_v2(features)[["trade_date", "code", "alpha_score_v2",
                                                  "market_score", "px_ma60"]]
        quality = compute_consolidation_quality(features)[["trade_date", "code", "quality"]]
        _, code_flag = compute_cluster_leadership(
            rankings.merge(alpha, on=["trade_date", "code"], how="left"),
            top_cluster_count=int(cl_cfg.get("top_cluster_count", 4)),
            cluster_min_members=int(cl_cfg.get("cluster_min_members", 1)),
            leaders_per_cluster=int(cl_cfg.get("leaders_per_cluster", 2)),
            breadth_min_pos=float(cl_cfg.get("breadth_min_pos", 0.5)))
        code_flag = code_flag[["trade_date", "code", "is_cluster_leader", "cluster_top"]]
    rk = rankings.merge(alpha, on=["trade_date", "code"], how="left")
    rk = rk.sort_values(["trade_date", "alpha_score_v2"], ascending=[True, False])
    rk["alpha_rank"] = rk.groupby("trade_date").cumcount() + 1
    n = rk.groupby("trade_date")["code"].transform("size")
    rk["alpha_pct"] = (n - rk["alpha_rank"] + 1) / n
    rk["perm_mode"] = rk["market_score"].map(selection_mode)
    rk["trend_gate"] = rk["px_ma60"] > 0
    rk["is_hedge"] = rk["code"].map(lambda c: records[c].strategic_role_hint if c in records else "") == "hedge"

    # ---- join V2.1 门输入（按 trade_date, code，纯当日横截面，无未来泄漏）----
    rk = rk.merge(quality, on=["trade_date", "code"], how="left")
    rk = rk.merge(code_flag, on=["trade_date", "code"], how="left")
    rk["is_cluster_leader"] = rk["is_cluster_leader"].fillna(False).astype(bool)
    rk["cluster_top"] = rk["cluster_top"].fillna(False).astype(bool)
    rk["quality"] = rk["quality"].fillna(0.0)

    # persistence（同 V2：above_core 累计完整准入条件；跌破 MA60 不累计）
    rk = rk.sort_values(["code", "trade_date"])
    rk["above_core_days"] = _consecutive_by_code((rk["alpha_pct"] >= core_pct) & rk["trend_gate"], rk["code"])
    rk["below_satellite_days"] = _consecutive_by_code(rk["alpha_pct"] < satellite_pct, rk["code"])

    # 初始角色 + tenure（连续 CORE 在位天数；V21-DELTA-3 需要）
    # 存量 incumbent CORE（研究起点快照）视同已过 min-hold 保护期（tenure=大数），
    # 避免研究起点首个交易日因 tenure=0 而全部撤销替换造成系统性偏差。
    current_roles = _initial_roles_from_records(records)
    tenure: dict[str, int] = {c: (999 if r == "CORE" else 0) for c, r in current_roles.items()}

    data = rk.sort_values(["trade_date", "alpha_rank"])
    output = []
    for trade_date, day in data.groupby("trade_date", sort=True):
        day = day.copy()
        mode = day["perm_mode"].iloc[0]
        max_core = max_core_count(day["market_score"].iloc[0], base=base_max_core)
        proposed = np.select(
            [day["alpha_pct"] >= core_pct, day["alpha_pct"] >= 0.70, day["alpha_pct"] >= satellite_pct],
            ["CORE", "CHALLENGER", "SATELLITE"],
            default="RESERVE",
        )
        day["proposed_role"] = proposed
        day["role"] = proposed

        for row in day.itertuples():
            code = row.code
            rec = records.get(code)
            current = current_roles.get(code, "RESERVE")
            role = row.proposed_role
            reasons = []

            if rec and rec.strategic_role_hint == "hedge":
                role = "HEDGE"
            elif current == "CORE" and role in {"RESERVE", "CHALLENGER", "SATELLITE"}:
                # 现任 CORE 去留由 demotion 滞后决定（同 V2）
                if int(row.below_satellite_days) < demotion_days:
                    role = "CORE"
                    reasons.append("DEMOTION_HYSTERESIS")
                else:
                    reasons.append("DEMOTION_CONFIRMED")
            elif current != "CORE" and role == "CORE":
                # 新晋升受 Selection Permission 控制（同 V2）
                if mode == DISABLED:
                    role = "CHALLENGER"
                    reasons.append("PROMOTION_BLOCKED_BY_PERMISSION")
                # V21-DELTA-1：cluster leadership 准入门（消除跨资产大乱斗）
                elif not (bool(row.is_cluster_leader) and bool(row.cluster_top)):
                    role = "CHALLENGER"
                    reasons.append("V21_CLUSTER_GATE_BLOCKED")
                # V21-DELTA-2：consolidation quality gate
                elif min_quality is not None and float(row.quality) < float(min_quality):
                    role = "CHALLENGER"
                    reasons.append("V21_CONSOLIDATION_BLOCKED")
                elif int(row.above_core_days) < promotion_days:
                    role = "CHALLENGER"
                    reasons.append("PROMOTION_HYSTERESIS")
                else:
                    reasons.append("PROMOTION_CONFIRMED")

            # NO_CORE 绝对硬门槛（同 V2）
            if role == "CORE" and not row.trend_gate:
                role = "CHALLENGER"
                reasons.append("NO_CORE_TREND_GATE")

            day.loc[row.Index, "role"] = role
            day.loc[row.Index, "reason_codes"] = "|".join(reasons)

        # cluster cap（同 V2；F03：显式 V2.1 alpha 排序）
        day["role_before_cap"] = day["role"]
        day["replacement_pair"] = ""  # M3-r2：替换 pairing（challenger|incumbent|cluster）供 Payoff 重建
        day["role"] = _cap_core_roles(day, max_core, max_core_per_cluster,
                                      priority_col="alpha_score_v2", priority_rank_col="alpha_rank")

        # V21-DELTA-3：Turnover-aware Replacement 5 硬门（替代 V2 F09 的 min_edge>=8）
        # M3-r2 语义：
        #   a) 严格 1 challenger ↔ 1 incumbent —— accepted 后立即从 promoted_indices 消费；
        #   b) 同簇强制：无同簇 challenger → 不执行 replacement（禁跨簇 fallback）；
        #   c) **weight_delta = projected trade weight（M3-r3）**：替换后 tentative CORE 集
        #      （去 incumbent、加 challenger）经完整 cap（25/40/65）算 challenger 实际目标权重，
        #      非 1/N 近似；由 portfolio.weights.projected_trade_weight 计算；
        #   d) pairing 输出（challenger/incumbent/cluster）供 Replacement Payoff 重建。
        from gen2.portfolio.weights import projected_trade_weight

        prev_s = day["code"].map(lambda c: current_roles.get(c, "RESERVE"))
        cap_demoted = day[(prev_s == "CORE") & (day["role_before_cap"] == "CORE") & (day["role"] != "CORE")]
        promoted_indices = list(day[(prev_s != "CORE") & (day["role"] == "CORE")].index)
        for dem_idx in cap_demoted.sort_values("alpha_score_v2", ascending=False).index:
            dem_code = day.loc[dem_idx, "code"]
            dem_alpha = float(day.loc[dem_idx, "alpha_score_v2"])
            dem_cluster = day.loc[dem_idx, "correlation_cluster"]
            # b) 同簇强制：challenger 必须来自同一簇（簇内 leadership advantage 语义）
            same_cluster = [i for i in promoted_indices if day.loc[i, "correlation_cluster"] == dem_cluster]
            if not same_cluster:
                day.loc[dem_idx, "role"] = "CORE"
                day.loc[dem_idx, "reason_codes"] = str(day.loc[dem_idx, "reason_codes"]) + "|REPLACEMENT_REVOKED_NO_CLUSTER"
                continue
            replacer_idx = None
            for i in same_cluster:
                # c) tentative CORE 集 = 当前 CORE（cap 后角色）+ 该 challenger − 该 incumbent
                current_core_codes = set(day.loc[day["role"] == "CORE", "code"])
                tentative = day[day["code"].isin((current_core_codes - {dem_code}) | {day.loc[i, "code"]})][
                    ["trade_date", "code", "correlation_cluster"]]
                proj_w = projected_trade_weight(tentative, pcfg, day.loc[i, "code"], dem_code)
                allow, _ = replacement_gate(
                    challenger_alpha=float(day.loc[i, "alpha_score_v2"]),
                    incumbent_alpha=dem_alpha,
                    challenger_cluster_top=bool(day.loc[i, "cluster_top"]),
                    challenger_quality=None if min_quality is None else float(day.loc[i, "quality"]),
                    min_quality=min_quality,
                    incumbent_tenure_days=int(tenure.get(dem_code, 0)),
                    weight_delta=proj_w,
                    cfg=repl_cfg,
                )
                if allow:
                    replacer_idx = i
                    break
            if replacer_idx is not None:
                # a) 1↔1：accepted 后立即 consume 该 challenger，不得再匹配其它 incumbent
                day.loc[dem_idx, "role"] = "CHALLENGER"
                day.loc[replacer_idx, "role"] = "CORE"
                day.loc[dem_idx, "reason_codes"] = str(day.loc[dem_idx, "reason_codes"]) + "|REPLACEMENT_ACCEPTED"
                day.loc[replacer_idx, "reason_codes"] = str(day.loc[replacer_idx, "reason_codes"]) + "|REPLACEMENT_PROMOTED"
                # d) pairing 记录（存 challenger 行，供 payoff 重建 challenger−incumbent）
                pair = f"{day.loc[replacer_idx, 'code']}|{dem_code}|{dem_cluster}"
                day.loc[replacer_idx, "replacement_pair"] = pair
                promoted_indices.remove(replacer_idx)
                continue
            # 硬门不足 → 恢复现任，退回最弱同簇晋升者
            day.loc[dem_idx, "role"] = "CORE"
            day.loc[dem_idx, "reason_codes"] = str(day.loc[dem_idx, "reason_codes"]) + "|REPLACEMENT_REVOKED"
            weakest_idx = min(same_cluster, key=lambda i: day.loc[i, "alpha_score_v2"])
            day.loc[weakest_idx, "role"] = "CHALLENGER"
            day.loc[weakest_idx, "reason_codes"] = str(day.loc[weakest_idx, "reason_codes"]) + "|REPLACEMENT_BLOCKED"
            promoted_indices.remove(weakest_idx)

        # 更新 current_roles 与 tenure（V21-DELTA-3：连续 CORE 天数，基于**旧** current_roles 判定）
        for row in day.itertuples():
            code = row.code
            was_core = current_roles.get(code, "RESERVE") == "CORE"
            current_roles[code] = row.role
            if row.role == "CORE":
                tenure[code] = tenure.get(code, 0) + 1 if was_core else 1
            else:
                tenure[code] = 0

        for row in day.itertuples():
            output.append({
                "trade_date": row.trade_date,
                "code": row.code,
                "name": row.name,
                "correlation_cluster": row.correlation_cluster,
                "role": row.role,
                "alpha_score_v2": row.alpha_score_v2,
                "alpha_rank": int(row.alpha_rank),
                "alpha_pct": float(row.alpha_pct),
                "perm_mode": row.perm_mode,
                "trend_gate": bool(row.trend_gate),
                "reason_codes": getattr(row, "reason_codes", ""),
                "replacement_pair": getattr(row, "replacement_pair", ""),
            })

    roles = pd.DataFrame(output)
    # 权重构建（M3-r3：复用 portfolio.weights.compute_core_weights 单一实现，
    # 与 Replacement Gate 的 projected_trade_weight 同源，25% 单只/40% 簇/65% tech）
    from gen2.portfolio.weights import compute_core_weights

    roles["relative_share"] = 0.0
    roles["target_weight"] = 0.0
    core = roles[roles["role"] == "CORE"][
        ["trade_date", "code", "correlation_cluster"]].copy()
    if not core.empty:
        w = compute_core_weights(core, pcfg)
        roles = roles.drop(columns=["relative_share", "target_weight"]).merge(
            w, on=["trade_date", "code"], how="left")
        roles["relative_share"] = roles["relative_share"].fillna(0.0)
        roles["target_weight"] = roles["target_weight"].fillna(0.0)
    return roles


def _econ_rows(led: pd.DataFrame, name: str, cost_bps: float,
               eval_start: str | None = None, eval_end: str | None = None) -> dict:
    """从 ledger 输出计算窗口内经济指标（默认全样本）。"""
    from datetime import date as _date

    led = led.copy()
    # ledger trade_date 可能为 date 对象（与 str 比较前归一）
    if eval_start or eval_end:
        if hasattr(led["trade_date"].iloc[0], "strftime"):
            led["trade_date"] = led["trade_date"].astype(str)
    if eval_start:
        led = led[led["trade_date"] >= eval_start]
    if eval_end:
        led = led[led["trade_date"] <= eval_end]
    net = led.set_index("trade_date")["net_return"]
    turn = led.set_index("trade_date")["turnover"]
    total = float((1.0 + net).prod() - 1.0)
    sharpe = float(net.mean() / net.std() * np.sqrt(252)) if len(net) > 1 and net.std() > 0 else float("nan")
    mdd = float((net.cumsum() - net.cumsum().cummax()).min()) if len(net) else float("nan")
    return {"strategy": name, "cost_bps": cost_bps, "n_days": len(net), "cumulative": total,
            "sharpe": sharpe, "mdd": mdd, "turnover": float(turn.sum())}


def run_v21_arms(features, rankings, config, arms: list[tuple[str, float | None]],
                 output_dir: str = "outputs",
                 eval_start: str | None = None, eval_end: str | None = None) -> dict:
    """V2.1 三臂 stateful Validation 经济对比（复用 economic_replay 口径：ledger/T+1/cost）。

    状态机全程推进（保持 stateful 连续性），经济统计按 eval_start/eval_end 窗口切分
    （默认全样本描述性；Validation 2024 段传 ("2024-01-01", "2024-11-05")——注意 2024
    purge 后有效 signal 末端 ~2024-11-05，由协议 §2.1.1 决定，此处窗口以执行日为准）。

    arms: [(arm_id, min_quality), ...]。
    """
    from gen2.backtest.ledger import run_ledger
    from gen2.portfolio.defense_gate import apply_regime_defense

    import json
    import os

    universe = load_universe_definition()
    main5 = universe["incumbent_main5"]
    bench = build_benchmark_weights(rankings, main5)
    returns = features[["trade_date", "code", "ret_1d"]].copy().sort_values(["code", "trade_date"])
    eval_calendar = sorted(rankings["trade_date"].unique())
    bench_code = str(universe.get("benchmark_code", "510300")).zfill(6)

    weights_map = {
        "main5_pit": bench["main5_equal_weight"],
        "universe_ew": bench["expanded_universe_equal_weight"],
    }
    # 共享预计算（alpha/quality/cluster flags 与 min_quality 无关，只算一次）
    _cl_cfg = _load_v21_cfg_from_draft(min_quality=None)["cluster"]
    _prepared = _prepare_v21_inputs(features, rankings, _cl_cfg)

    for arm_id, mq in arms:
        v21_cfg = _load_v21_cfg_from_draft(min_quality=mq)
        roles = build_v21_roles(features, rankings, config, v21_cfg, prepared=_prepared)
        candidates = roles[["trade_date", "code", "role", "target_weight", "name",
                            "correlation_cluster", "reason_codes", "perm_mode"]].copy()
        candidates["priority"] = 1
        defended = apply_regime_defense(candidates, features, config=config)
        weights_map[f"v21_{arm_id}"] = defended[["trade_date", "code", "target_weight"]]
        roles.to_csv(f"{output_dir}/gen2_v21_m3_roles_{arm_id}.csv", index=False)

    rows = []
    net_cache: dict[str, pd.Series] = {}  # (name, cost) -> 窗口内日净收益（索引 trade_date str）
    for name, w in weights_map.items():
        for cost_bps in [0.0, 10.0]:
            led = run_ledger(w, returns, cost_bps=cost_bps, calendar=eval_calendar)
            r = _econ_rows(led, name, cost_bps, eval_start, eval_end)
            rows.append(r)
            led_c = led.copy()
            if eval_start or eval_end:
                if hasattr(led_c["trade_date"].iloc[0], "strftime"):
                    led_c["trade_date"] = led_c["trade_date"].astype(str)
                if eval_start:
                    led_c = led_c[led_c["trade_date"] >= eval_start]
                if eval_end:
                    led_c = led_c[led_c["trade_date"] <= eval_end]
            net_cache[(name, cost_bps)] = led_c.set_index("trade_date")["net_return"]

    # M3-r3：cost_net_increment bootstrap CI —— 各 arm vs main5_pit（cost 10）日超额 block bootstrap
    def _block_bootstrap_ci(excess_daily: pd.Series, n_iter: int = 2000, block: int = 20) -> dict:
        x = excess_daily.dropna().values
        if len(x) < block * 2:
            return {"mean": float("nan"), "ci_lo": float("nan"), "ci_hi": float("nan"), "n_days": int(len(x))}
        rng = np.random.default_rng(42)
        means = np.empty(n_iter)
        n_blocks = int(np.ceil(len(x) / block))
        for i in range(n_iter):
            starts = rng.integers(0, len(x) - block + 1, size=n_blocks)
            sample = np.concatenate([x[s:s + block] for s in starts])[:len(x)]
            means[i] = sample.mean()
        lo, hi = np.percentile(means, [2.5, 97.5])
        return {"mean": float(x.mean()), "ci_lo": float(lo), "ci_hi": float(hi), "n_days": int(len(x))}

    main_ref = net_cache.get(("main5_pit", 10.0))
    if main_ref is not None:
        boot_rows = []
        for arm_id, _mq in arms:
            s = net_cache.get((f"v21_{arm_id}", 10.0))
            if s is None:
                continue
            excess = s.sub(main_ref, fill_value=0.0)
            b = _block_bootstrap_ci(excess)
            boot_rows.append({"arm": arm_id, "vs_main5_mean_daily": b["mean"],
                              "ci_lo": b["ci_lo"], "ci_hi": b["ci_hi"], "n_days": b["n_days"]})
        boot_df = pd.DataFrame(boot_rows)
        boot_df.to_csv(f"{output_dir}/gen2_v21_m3_bootstrap.csv", index=False)
        print("\n## cost_net_increment vs Main5 PIT（cost10，2024 窗口 block bootstrap CI）")
        print(boot_df.to_string(index=False, float_format=lambda x: f"{x:.5f}"))

    df = pd.DataFrame(rows)
    df.to_csv(f"{output_dir}/gen2_v21_m3_arms_econ.csv", index=False)
    return df


def _load_v21_cfg_from_draft(min_quality: float | None) -> dict:
    """从 GEN2_RULE_V21_DRAFT.json 读 V2.1 参数（单真相源，防 shadow config）。

    DRAFT 参数结构支持两种：裸值（兼容旧）或 {value, basis} 包装（M3-r2 起）。
    """
    import json
    import os

    p = os.path.join(os.path.dirname(__file__), "..", "..", "..", "ml", "gen2", "manifests", "GEN2_RULE_V21_DRAFT.json")
    d = json.load(open(os.path.abspath(p), encoding="utf-8"))
    cl = d["cluster_leadership"]
    tar = d["turnover_aware_replacement"]

    def _val(x):
        return x["value"] if isinstance(x, dict) and "value" in x else x

    cl_keys = ("top_cluster_count", "cluster_min_members", "leaders_per_cluster", "breadth_min_pos")
    repl = tar.get("replacement", {}) or {}
    repl_vals = {k: _val(v) for k, v in repl.items()
                 if k in ("min_hold_days", "cost_bps", "alpha_to_excess_bps",
                          "hold_days_for_breakeven", "cost_buffer_bps")}
    return {
        "min_quality": min_quality,
        "cluster": {k: _val(cl[k]) for k in cl_keys if k in cl},
        "replacement": repl_vals,
    }


if __name__ == "__main__":
    import sys

    if "--arms" in sys.argv or "--arms-val2024" in sys.argv:
        from gen2.baseline.alpha_score import compute_alpha_score_v2  # noqa: F401
        from gen2.data.loader import load_daily_bars, load_gen2_config, load_universe_records
        from gen2.features.build_features import build_feature_matrix
        from gen2.ranking.rank_engine import run_rank_engine

        pd.set_option("display.width", 240)
        pd.set_option("display.max_rows", 200)
        cfg = load_gen2_config()
        bars = load_daily_bars()
        records = load_universe_records()
        feats = build_feature_matrix(bars=bars, records=records, config=cfg)
        ranks = run_rank_engine(feats)
        arms = [("gate_off", None), ("gate_40", 40.0), ("gate_60", 60.0)]
        if "--arms-val2024" in sys.argv:
            # Validation 2024 段（signal 2024-01-01~12-31；执行日窗口含 purge 语义：2024-11-05 后
            # 的 40D label 触 2025 → 事件/超额类指标在报告层剔除，账本层经济窗口以 2024 全年为准）
            res = run_v21_arms(feats, ranks, cfg, arms=arms, output_dir="ml/gen2/outputs",
                               eval_start="2024-01-01", eval_end="2024-12-31")
            print("\n## M3 三臂经济对比（Validation 2024 段，stateful；成本后 net 以窗口内账本为准）")
        else:
            res = run_v21_arms(feats, ranks, cfg, arms=arms, output_dir="ml/gen2/outputs")
            print("\n## M3 三臂经济对比（全样本 stateful，描述性）")
        print(res.to_string(index=False, float_format=lambda x: f"{x:.4f}"))
    else:
        print(__doc__)
        sys.exit(0)
