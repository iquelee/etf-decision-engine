"""WP9.3A Stateful Gen-2 Economic Replay + Event Attribution（不改任何策略参数）。

目标：回答「+0.10 的 Promotion-Actionable Alpha 经过 persistence / demotion /
replacement / cap / turnover 之后还剩多少」——从「有预测力」证明到「成本后创造组合价值」。

Stateful 语义（与真实 Gen-2 状态机一致，绝不做「DISABLED 日 = 删除」）：
    RISK_ON  → ACTIVE：正常 promotion + retention/demotion
    RANGE    → REDUCED：max CORE=3，正常 retention/demotion
    RISK_OFF → DISABLED：禁新晋升，但状态机照常跑 incumbent retention、
                          demotion persistence、NO_CORE、cluster cap、replacement
状态机由 build_v2_roles() 原生实现（逐日推进 current_roles），本模块只是消费其输出。

口径（与 run_v2_backtest / ledger.py 一致）：
    - 同 eval_calendar（rankings 日）、同期初全现金、T+1 执行、cash 腿不计费
    - cost 默认 10bps（另给 0bps 供 rotation cost 拆解）
    - event 后 20D 收益用 labels_vs_market 的 future_20d_excess_vs_market（vs 510300 市场超额）

运行：PYTHONPATH=ml python -m gen2.evaluation.economic_replay
"""
from __future__ import annotations

import numpy as np
import pandas as pd

from gen2.backtest.benchmark import build_benchmark_weights
from gen2.backtest.ledger import run_ledger
from gen2.baseline.rule_v2_ab import build_v2_roles
from gen2.data.loader import load_gen2_config, load_universe_definition
from gen2.portfolio.defense_gate import apply_regime_defense
from gen2.portfolio.selection_permission import DISABLED
from gen2.portfolio.regime import RISK_OFF, RISK_ON, RANGE, classify_regime

MAIN5 = ["513310", "159582", "515880", "159570", "518880"]
EXCESS_COL = "future_20d_excess_vs_market"


def _econ_metrics(net: pd.Series, turnover: pd.Series | None = None) -> dict:
    net = net.dropna()
    if net.empty:
        return {"days": 0, "cumulative": float("nan"), "cagr": float("nan"), "sharpe": float("nan"),
                "mdd": float("nan"), "calmar": float("nan"), "total_turnover": float("nan")}
    nav = (1.0 + net).cumprod()
    total = float(nav.iloc[-1] - 1.0)
    days = len(net)
    cagr = float((1.0 + total) ** (252.0 / days) - 1.0) if total > -1 else -1.0
    sd = float(net.std())
    sharpe = float(net.mean() / sd * (252 ** 0.5)) if sd > 0 else float("nan")
    mdd = float((nav / nav.cummax() - 1.0).min())
    calmar = float(cagr / abs(mdd)) if mdd < 0 else float("nan")
    return {"days": days, "cumulative": total, "cagr": cagr, "sharpe": sharpe,
            "mdd": mdd, "calmar": calmar,
            "total_turnover": float(turnover.sum()) if turnover is not None else float("nan")}


def _block_bootstrap_ci(excess_daily: pd.Series, n_iter: int = 2000, block: int = 20) -> dict:
    """对 (strat - ref) 日超额序列做 block bootstrap（block=20 交易日），返回均值 CI。"""
    x = excess_daily.dropna().values
    if len(x) < block * 2:
        return {"mean": float("nan"), "ci_lo": float("nan"), "ci_hi": float("nan"), "n_days": len(x)}
    rng = np.random.default_rng(42)
    means = np.empty(n_iter)
    n_blocks = int(np.ceil(len(x) / block))
    for i in range(n_iter):
        starts = rng.integers(0, len(x) - block + 1, size=n_blocks)
        sample = np.concatenate([x[s:s + block] for s in starts])[:len(x)]
        means[i] = sample.mean()
    lo, hi = np.percentile(means, [2.5, 97.5])
    return {"mean": float(x.mean()), "ci_lo": float(lo), "ci_hi": float(hi), "n_days": len(x)}


def _yearly_and_regime(net: pd.Series, regime_by_day: pd.Series) -> dict:
    yearly, regime_ret = {}, {}
    for y, g in net.groupby(pd.Series(net.index).map(lambda d: pd.Timestamp(d).year).values):
        yearly[y] = float((1.0 + g).prod() - 1.0)
    day_reg = net.index.map(lambda d: regime_by_day.get(d, "NA"))
    for reg, g in net.groupby(day_reg):
        if len(g):
            regime_ret[reg] = float((1.0 + g).prod() - 1.0)
    return {"yearly": yearly, "regime": regime_ret}


def _event_attribution(roles: pd.DataFrame, labels: pd.DataFrame) -> pd.DataFrame:
    """从 build_v2_roles 的 reason_codes 展开真实状态机事件（PROMOTION/DEMOTION/REPLACEMENT/NO_CORE/…）。

    补充合成事件：
      - RISK_OFF_CORE_HOLD：perm=DISABLED 且当日 role==CORE（现任保留，走 demotion 滞后，非新晋升）
      - PERM_ACTIVE_STATE / FINAL_*_CAP 计入换手与 cap 类别
    后 20D 收益 = future_20d_excess_vs_market（vs 510300）。
    """
    lab = labels[["trade_date", "code", EXCESS_COL]].copy()
    lab["code"] = lab["code"].astype(str)
    ev = roles[["trade_date", "code", "reason_codes", "perm_mode", "role"]].copy()
    ev["code"] = ev["code"].astype(str)
    ev = ev.merge(lab, on=["trade_date", "code"], how="left")

    rows = []
    for _, r in ev.iterrows():
        events = [e for e in str(r["reason_codes"]).split("|") if e]
        if r["perm_mode"] == DISABLED and r["role"] == "CORE":
            events.append("RISK_OFF_CORE_HOLD")
        for e in events:
            rows.append({"trade_date": r["trade_date"], "code": r["code"], "event": e,
                         "perm_mode": r["perm_mode"], "fwd20_excess": r.get(EXCESS_COL)})
    df = pd.DataFrame(rows)
    out = []
    for e, g in df.groupby("event", sort=True):
        fwd = g["fwd20_excess"].dropna()
        out.append({
            "event": e,
            "count": int(len(g)),
            "fwd20_mean_excess": float(fwd.mean()) if len(fwd) else float("nan"),
            "fwd20_pos_ratio": float((fwd > 0).mean()) if len(fwd) else float("nan"),
            "n_with_label": int(len(fwd)),
        })
    return pd.DataFrame(out).sort_values("count", ascending=False)


def _risk_off_demotion_test(roles: pd.DataFrame, labels: pd.DataFrame) -> pd.DataFrame:
    """RISK_OFF 下 alpha-driven demotion 帮了还是害了组合。

    比较 DEMOTION_CONFIRMED 事件日的 market regime 分档（DISABLED vs 其他）的
    被降级标的未来 20D 超额：若被降级后继续走弱（excess<0）→ demotion 正确。
    """
    lab = labels[["trade_date", "code", EXCESS_COL]].copy()
    lab["code"] = lab["code"].astype(str)
    dem = roles[roles["reason_codes"].astype(str).str.contains("DEMOTION_CONFIRMED", na=False)][
        ["trade_date", "code", "perm_mode"]].copy()
    dem["code"] = dem["code"].astype(str)
    dem = dem.merge(lab, on=["trade_date", "code"], how="left")
    out = []
    for grp, g in dem.groupby("perm_mode"):
        fwd = g[EXCESS_COL].dropna()
        out.append({"perm_mode": grp, "demotion_events": int(len(g)),
                    "fwd20_mean_excess": float(fwd.mean()) if len(fwd) else float("nan"),
                    "fwd20_pos_ratio": float((fwd > 0).mean()) if len(fwd) else float("nan")})
    return pd.DataFrame(out)


def run_economic_replay(features, rankings, labels, cost_bps: float = 10.0):
    cfg = load_gen2_config()
    universe = load_universe_definition()
    main5 = universe["incumbent_main5"]

    roles = build_v2_roles(features, rankings, cfg)
    candidates = roles[["trade_date", "code", "role", "target_weight", "name", "correlation_cluster",
                        "reason_codes", "perm_mode"]].copy()
    candidates["priority"] = 1
    undefended = candidates.copy()
    defended = apply_regime_defense(candidates, features, config=cfg)

    returns = features[["trade_date", "code", "ret_1d"]].copy().sort_values(["code", "trade_date"])
    bench = build_benchmark_weights(rankings, main5)
    weights_map = {
        "main5_pit": bench["main5_equal_weight"],
        "universe_ew": bench["expanded_universe_equal_weight"],
        "gen2_v2_undefended": undefended[["trade_date", "code", "target_weight"]],
        "gen2_v2_defended": defended[["trade_date", "code", "target_weight"]],
    }
    eval_calendar = sorted(rankings["trade_date"].unique())

    # 市场基准（510300 buy&hold，毛收益、无换手无成本）
    bench_code = str(universe.get("benchmark_code", "510300")).zfill(6)
    bench_ret = returns[returns["code"] == bench_code].drop_duplicates("trade_date").set_index("trade_date")["ret_1d"].reindex(eval_calendar).fillna(0.0)

    regime_by_day = features.groupby("trade_date")["market_score"].first().map(classify_regime).to_dict()

    ledgers, nets = {}, {}
    for name, w in weights_map.items():
        led = run_ledger(w, returns, cost_bps=cost_bps, calendar=eval_calendar)
        ledgers[name] = led
        nets[name] = led.set_index("trade_date")["net_return"]
    nets["market_510300"] = bench_ret

    # 经济总表（cost 10 + cost 0）
    rows = []
    for cost in [0.0, cost_bps]:
        for name, w in weights_map.items():
            led = ledgers[name] if cost == cost_bps else run_ledger(w, returns, cost_bps=cost, calendar=eval_calendar)
            m = _econ_metrics(led.set_index("trade_date")["net_return"], led.set_index("trade_date")["turnover"])
            rows.append({"strategy": name, "cost_bps": cost, **m})
        m = _econ_metrics(bench_ret)
        rows.append({"strategy": "market_510300", "cost_bps": cost, **m})
    econ = pd.DataFrame(rows)

    # 逐年 / 分 regime（cost 10）
    detail = {}
    for name, net in nets.items():
        detail[name] = _yearly_and_regime(net, pd.Series(regime_by_day))
    yearly = pd.DataFrame({"year": sorted({y for d in detail.values() for y in d["yearly"]})}).set_index("year")
    for name, d in detail.items():
        yearly[name] = yearly.index.map(lambda y: d["yearly"].get(y, float("nan")))
    regime_ret = pd.DataFrame({"regime": sorted({r for d in detail.values() for r in d["regime"]})}).set_index("regime")
    for name, d in detail.items():
        regime_ret[name] = regime_ret.index.map(lambda r: d["regime"].get(r, float("nan")))

    # event attribution + RISK_OFF demotion 检验
    events = _event_attribution(roles, labels)
    dem_test = _risk_off_demotion_test(roles, labels)

    # block bootstrap CI：defended vs 基准（净增量是否 >0 且稳定）
    boot = {}
    for ref in ["main5_pit", "universe_ew"]:
        diff = nets["gen2_v2_defended"].reindex(eval_calendar).fillna(0.0) - nets[ref].reindex(eval_calendar).fillna(0.0)
        boot[f"defended_vs_{ref}"] = _block_bootstrap_ci(diff)

    return {"econ": econ, "yearly": yearly, "regime_ret": regime_ret,
            "events": events, "demotion_test": dem_test, "bootstrap": boot,
            "ledgers": ledgers, "nets": nets}


if __name__ == "__main__":
    from gen2.data.loader import load_daily_bars, load_universe_records
    from gen2.features.build_features import build_feature_matrix
    from gen2.ranking.rank_engine import run_rank_engine
    from gen2.labels.build_labels import build_labels_vs_market
    import os

    pd.set_option("display.width", 220)
    pd.set_option("display.max_rows", 200)

    cfg = load_gen2_config()
    bars = load_daily_bars()
    records = load_universe_records()
    features = build_feature_matrix(bars=bars, records=records, config=cfg)
    rankings = run_rank_engine(features)
    labels = build_labels_vs_market(features)
    r = run_economic_replay(features, rankings, labels)

    outdir = cfg.get("outputs_dir") or "outputs"
    os.makedirs(outdir, exist_ok=True)

    print("\n## WP9.3A Stateful Gen-2 Economic Replay — 经济总表（cost 10bps 基准行 = market 毛收益）\n")
    print(r["econ"][r["econ"]["cost_bps"] == 10].to_string(index=False))

    print("\n## 逐年净收益（cost 10）\n")
    print(r["yearly"].to_string(float_format=lambda x: f"{x:+.2%}"))

    print("\n## 分 regime 净收益（cost 10）\n")
    print(r["regime_ret"].to_string(float_format=lambda x: f"{x:+.2%}"))

    print("\n## Event Attribution（状态机事件 → 后 20D vs-market 超额）\n")
    print(r["events"].to_string(index=False, float_format=lambda x: f"{x:+.4f}"))

    print("\n## RISK_OFF demotion 检验（被 DEMOTION_CONFIRMED 降级标的的未来 20D 超额）\n")
    print(r["demotion_test"].to_string(index=False, float_format=lambda x: f"{x:+.4f}"))

    print("\n## Block Bootstrap CI（defended − ref 日超额，block=20，2000 次）\n")
    for k, b in r["bootstrap"].items():
        print(f"  {k:<28} mean={b['mean']:+.5f}  CI=[{b['ci_lo']:+.5f}, {b['ci_hi']:+.5f}]  n={b['n_days']}")

    # 落盘
    r["econ"].to_csv(os.path.join(outdir, "gen2_wp93a_econ.csv"), index=False)
    r["events"].to_csv(os.path.join(outdir, "gen2_wp93a_events.csv"), index=False)
    r["demotion_test"].to_csv(os.path.join(outdir, "gen2_wp93a_demotion.csv"), index=False)
    print(f"\n[OK] 已存 outputs/gen2_wp93a_*.csv")
