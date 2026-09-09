"""Gen-2.1 M3 — V2.1 三臂事件诊断 + Replacement Payoff（Validation 2024 段，报告数据源）。

M3-r2（审批修正）：
  1. 事件计数（promotions/demotions/replacements/gate 拦截/avg hold）。
  2. **Replacement Payoff（真实 pairing）**：roles 输出含 replacement_pair="challenger|incumbent|cluster"。
     对 REPLACEMENT_ACCEPTED 配对，在 purge 后有效窗口计算：
       - 20D / 40D challenger − incumbent（同 start 相对收益差）
       - 20D / 40D challenger − cluster 等权 benchmark
     purge：signal 日 + MAX_FORWARD_HORIZON(40 交易日) 不得跨出评价窗口末
     （2024 Validation → signal ≤ 2024-11-05 附近；超窗 dropna 计入 purged_pairs）。
  3. 修复：日期归一为 str；REPLACEMENT 事件在 challenger 行（pair 非空）取 signal 日。

用法：PYTHONPATH=ml python -m gen2.evaluation.v21_diagnostics [--window 2024]
"""
from __future__ import annotations

import os
from collections import Counter

import pandas as pd

from gen2.data.loader import load_daily_bars, load_gen2_config, load_universe_records
from gen2.features.build_features import build_feature_matrix

REPO_OUT = os.path.join(os.path.dirname(__file__), "..", "..", "..", "ml", "gen2", "outputs")


def _load_bars() -> pd.DataFrame:
    cfg = load_gen2_config()
    bars = load_daily_bars()
    records = load_universe_records()
    return build_feature_matrix(bars=bars, records=records, config=cfg)


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


def _core_hold_stats(roles: pd.DataFrame) -> dict:
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


def _replacement_payoff(roles: pd.DataFrame, feats: pd.DataFrame,
                        window_start="2024-01-01", window_end="2024-12-31",
                        cluster_members: dict | None = None) -> dict:
    """真实 pairing payoff（M3-r3）：challenger−incumbent 与 challenger−cluster 的 20/40D 收益差。

    口径（修复确定性 bug）：
      - pair 记录在 challenger 行（signal 日）；**严格限定 signal ∈ [window_start, window_end]**
        （消除 2025+ pairing 混入）；
      - 收益用 close 归一化净值：signal 收 close0，horizon 后收 closeH → 累计收益；
      - purge：signal + h(20/40) 个交易日仍在窗口内才计（label 不触下一层）；
        **purged_20d / purged_40d 分列统计**；
      - vs cluster：challenger 所在簇等权（该 signal 日簇内全部代码的 close 等权收益）。
    cluster_members: {cluster: [codes]}；缺省时从 feats 的 correlation_cluster 推断。
    """
    bars = feats[["trade_date", "code", "close"]].copy()
    bars["code"] = bars["code"].astype(str).str.zfill(6)
    bars["trade_date"] = bars["trade_date"].astype(str)
    cal = sorted(bars["trade_date"].unique())

    pair_rows = roles[(roles["replacement_pair"].fillna("").astype(str) != "")].copy()
    pair_rows["trade_date"] = pair_rows["trade_date"].astype(str)
    # **窗口上限修复**：signal 严格限定 [ws, we]
    pair_rows = pair_rows[(pair_rows["trade_date"] >= window_start)
                          & (pair_rows["trade_date"] <= window_end)]

    close_pivot = bars.pivot_table(index="trade_date", columns="code", values="close", aggfunc="last")

    # cluster → member codes（用于等权 benchmark；roles 带 correlation_cluster 覆盖全池）
    if cluster_members is None:
        cluster_members = (roles.dropna(subset=["correlation_cluster"])
                           .groupby("correlation_cluster")["code"].apply(lambda s: sorted(set(s))).to_dict())

    detail = []
    purged = {20: 0, 40: 0}
    for _, r in pair_rows.iterrows():
        sig = r["trade_date"]
        chal, inc, cl = str(r["replacement_pair"]).split("|")
        future_days = [d for d in cal if d > sig]
        members = [c for c in cluster_members.get(cl, []) if c != chal]
        rec = {"signal_date": sig, "challenger": chal, "incumbent": inc, "cluster": cl}
        for h in (20, 40):
            if len(future_days) < h:
                purged[h] += 1
                rec[f"vs_inc_{h}d"] = float("nan")
                rec[f"vs_cluster_{h}d"] = float("nan")
                continue
            end_day = future_days[h - 1]
            if end_day > window_end:
                purged[h] += 1
                rec[f"vs_inc_{h}d"] = float("nan")
                rec[f"vs_cluster_{h}d"] = float("nan")
                continue

            def _ret(code):
                if code not in close_pivot.columns:
                    return float("nan")
                series = close_pivot[code]
                try:
                    c0 = float(series.loc[sig])
                    cH = float(series.loc[end_day])
                except KeyError:
                    return float("nan")
                return cH / c0 - 1.0 if c0 > 0 else float("nan")

            rc = _ret(chal)
            ri = _ret(inc)
            rec[f"vs_inc_{h}d"] = (rc - ri) if pd.notna(rc) and pd.notna(ri) else float("nan")
            # cluster 等权（同日同窗；成员中缺价者跳过）
            mrets = [_ret(c) for c in members]
            mrets = [x for x in mrets if pd.notna(x)]
            rcl = float(pd.Series(mrets).mean()) if mrets else float("nan")
            rec[f"vs_cluster_{h}d"] = (rc - rcl) if pd.notna(rc) and pd.notna(rcl) else float("nan")
        detail.append(rec)

    df = pd.DataFrame(detail)
    df.to_csv(os.path.join(REPO_OUT, "gen2_v21_m3_replacement_pairs.csv"), index=False)

    result = {"n_pairs_signal": int(len(pair_rows)),
              "purged_20d": purged[20], "purged_40d": purged[40]}
    for h in (20, 40):
        for tag in ("vs_inc", "vs_cluster"):
            col = f"{tag}_{h}d"
            if col in df and len(df[col].dropna()):
                s = df[col].dropna()
                result[f"{tag}_{h}d_mean"] = float(s.mean())
                result[f"{tag}_{h}d_pos"] = float((s > 0).mean())
                result[f"{tag}_{h}d_n"] = int(len(s))
            else:
                result[f"{tag}_{h}d_mean"] = float("nan")
                result[f"{tag}_{h}d_pos"] = float("nan")
                result[f"{tag}_{h}d_n"] = 0
    return result


def main() -> None:
    import sys

    window = "2024"
    if "--window" in sys.argv:
        window = sys.argv[sys.argv.index("--window") + 1]
    ws, we = f"{window}-01-01", f"{window}-12-31"

    feats = _load_bars()
    arms = ["gate_off", "gate_40", "gate_60"]
    report = []
    for arm in arms:
        p = os.path.join(REPO_OUT, f"gen2_v21_m3_roles_{arm}.csv")
        if not os.path.exists(p):
            print(f"[跳过] {p} 不存在（先跑 rule_v21_ab --arms-val{window}）")
            continue
        roles = pd.read_csv(p, dtype={"code": str})
        roles["code"] = roles["code"].str.zfill(6)
        w = roles[(roles["trade_date"] >= ws) & (roles["trade_date"] <= we)].copy()
        et = _event_table(w).set_index("event")["count"].to_dict()
        hold = _core_hold_stats(w)
        payoff = _replacement_payoff(roles, feats, ws, we)
        row = {
            "arm": arm,
            "promotions": et.get("PROMOTION_CONFIRMED", 0),
            "demotions": et.get("DEMOTION_CONFIRMED", 0),
            "replacement_accepted": et.get("REPLACEMENT_ACCEPTED", 0),
            "replacement_revoked": et.get("REPLACEMENT_REVOKED", 0)
                                  + et.get("REPLACEMENT_REVOKED_NO_CLUSTER", 0),
            "replacement_promoted": et.get("REPLACEMENT_PROMOTED", 0),
            "cluster_gate_blocked": et.get("V21_CLUSTER_GATE_BLOCKED", 0),
            "consolidation_blocked": et.get("V21_CONSOLIDATION_BLOCKED", 0),
            "avg_core_hold_days": hold["avg_core_hold_days"],
            "core_segments": hold["core_segments"],
            "pair_signal_n": payoff["n_pairs_signal"],
            "purged_20d": payoff["purged_20d"],
            "purged_40d": payoff["purged_40d"],
            "vs_inc_20d_n": payoff["vs_inc_20d_n"],
            "vs_inc_20d_mean": payoff["vs_inc_20d_mean"],
            "vs_inc_20d_pos": payoff["vs_inc_20d_pos"],
            "vs_inc_40d_n": payoff["vs_inc_40d_n"],
            "vs_inc_40d_mean": payoff["vs_inc_40d_mean"],
            "vs_inc_40d_pos": payoff["vs_inc_40d_pos"],
            "vs_cluster_20d_n": payoff["vs_cluster_20d_n"],
            "vs_cluster_20d_mean": payoff["vs_cluster_20d_mean"],
            "vs_cluster_20d_pos": payoff["vs_cluster_20d_pos"],
            "vs_cluster_40d_n": payoff["vs_cluster_40d_n"],
            "vs_cluster_40d_mean": payoff["vs_cluster_40d_mean"],
            "vs_cluster_40d_pos": payoff["vs_cluster_40d_pos"],
        }
        report.append(row)

    df = pd.DataFrame(report)
    out = os.path.join(REPO_OUT, f"gen2_v21_m3_event_diag_{window}.csv")
    df.to_csv(out, index=False)
    pd.set_option("display.width", 260)
    pd.set_option("display.max_columns", 30)
    print(f"\n## M3 三臂事件诊断 + Replacement Payoff（Validation {window} 段，purge=40D）")
    print(df.to_string(index=False, float_format=lambda x: f"{x:.4f}"))
    print(f"\n[OK] {out}")


if __name__ == "__main__":
    main()
