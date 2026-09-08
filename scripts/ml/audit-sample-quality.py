#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
V4.0 Phase 1.5 — Early Transition 样本质量 / 独立性审计

不改 V3.6.1。只读 ml/datasets/early_transition_s2_*.csv。

统计：
  A. 按 ETF
  B. 按年份
  C. 按粗 Regime 代理（rs_20d / ret_20d 分箱 → Bull/Range/Bear-ish）
  D. 事件 cluster（同 ETF 10 日内连续 S2 归为一簇）

闸门（初值）：
  - 最大单 ETF 正样本占比 ≤ 35%（Y5+ 与 Y10+）
  - Independent Positive Clusters ≥ 40（Y5）且 ≥ 60（Y10）
  - 至少 2 个自然年有 Y5+ > 0

用法：
  python3 scripts/ml/audit-sample-quality.py
  python3 scripts/ml/audit-sample-quality.py --csv=ml/datasets/early_transition_s2_2026-08-29.csv
"""
from __future__ import annotations

import argparse
import csv
import json
import os
from collections import defaultdict
from datetime import datetime, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUT_DIR = ROOT / "scripts" / "backtest-out"
REPORT_DIR = ROOT / "回测报告"
CLUSTER_GAP_DAYS = 10


def parse_args():
    p = argparse.ArgumentParser()
    p.add_argument("--csv", default="")
    p.add_argument("--cluster-gap", type=int, default=CLUSTER_GAP_DAYS)
    return p.parse_args()


def find_csv(explicit: str) -> Path:
    if explicit:
        return Path(explicit) if Path(explicit).is_absolute() else ROOT / explicit
    ds = ROOT / "ml" / "datasets"
    cands = sorted(ds.glob("early_transition_s2_*.csv"), reverse=True)
    if not cands:
        raise SystemExit("未找到 early_transition_s2_*.csv")
    return cands[0]


def load_rows(path: Path):
    with path.open("r", encoding="utf-8-sig", newline="") as f:
        rows = list(csv.DictReader(f))
    for r in rows:
        r["y5"] = int(float(r["y5"] or 0))
        r["y10"] = int(float(r["y10"] or 0))
        r["date"] = r["date"]
        r["_dt"] = datetime.strptime(r["date"], "%Y-%m-%d")
        r["year"] = r["date"][:4]
        try:
            r["rs_20d"] = float(r["rs_20d"]) if r.get("rs_20d") not in ("", None) else None
        except ValueError:
            r["rs_20d"] = None
        try:
            r["ret_20d"] = float(r["ret_20d"]) if r.get("ret_20d") not in ("", None) else None
        except ValueError:
            r["ret_20d"] = None
    return rows


def regime_proxy(r):
    """粗 Regime：优先 rs_20d，否则 ret_20d。仅审计用，非生产 Regime。"""
    x = r["rs_20d"] if r["rs_20d"] is not None else r["ret_20d"]
    if x is None:
        return "unknown"
    if x >= 0.03:
        return "bullish"
    if x <= -0.03:
        return "bearish"
    return "range"


def assign_clusters(rows, gap_days: int):
    """同 ETF 按日期排序；相邻间隔 ≤ gap_days 的 S2 归同一 cluster。"""
    by_code = defaultdict(list)
    for i, r in enumerate(rows):
        by_code[r["code"]].append((i, r))
    cluster_id = 0
    for code, items in by_code.items():
        items.sort(key=lambda t: t[1]["_dt"])
        prev_dt = None
        cur_cid = None
        for i, r in items:
            if prev_dt is None or (r["_dt"] - prev_dt).days > gap_days:
                cluster_id += 1
                cur_cid = cluster_id
            r["event_cluster_id"] = cur_cid
            prev_dt = r["_dt"]
    return rows


def agg_table(rows, key_fn, label_col):
    buckets = defaultdict(lambda: {"s2": 0, "y5": 0, "y10": 0})
    for r in rows:
        k = key_fn(r)
        buckets[k]["s2"] += 1
        buckets[k]["y5"] += r["y5"]
        buckets[k]["y10"] += r["y10"]
    out = []
    for k, v in sorted(buckets.items(), key=lambda kv: (-kv[1]["y5"], -kv[1]["s2"], kv[0])):
        pr5 = v["y5"] / v["s2"] if v["s2"] else 0
        pr10 = v["y10"] / v["s2"] if v["s2"] else 0
        out.append({
            "key": k, "s2": v["s2"], "y5": v["y5"], "y10": v["y10"],
            "rate5": round(pr5, 4), "rate10": round(pr10, 4)
        })
    return out


def cluster_stats(rows, ycol: str):
    """正样本落在多少独立 cluster；最大 cluster 贡献占比。"""
    pos_clusters = defaultdict(int)
    for r in rows:
        if r[ycol] == 1:
            pos_clusters[r["event_cluster_id"]] += 1
    n_raw = sum(1 for r in rows if r[ycol] == 1)
    n_ind = len(pos_clusters)
    max_share = max(pos_clusters.values()) / n_raw if n_raw else 0
    # cluster 内任一正样本即算独立正事件
    return {
        "raw_positive": n_raw,
        "independent_clusters": n_ind,
        "max_cluster_raw_share": round(max_share, 4),
        "avg_pos_per_cluster": round(n_raw / n_ind, 3) if n_ind else 0
    }


def decide_gate(by_etf, by_year, c5, c10):
    reasons = []
    status = "PASS"
    y5_total = sum(x["y5"] for x in by_etf) or 1
    y10_total = sum(x["y10"] for x in by_etf) or 1
    top5 = by_etf[0] if by_etf else None
    top10 = max(by_etf, key=lambda x: x["y10"]) if by_etf else None
    if top5 and top5["y5"] / y5_total > 0.35:
        status = "WARN"
        reasons.append(f"Y5+ 单票过高：{top5['key']}={top5['y5']}/{y5_total} ({top5['y5']/y5_total:.1%})")
    if top10 and top10["y10"] / y10_total > 0.35:
        status = "WARN"
        reasons.append(f"Y10+ 单票过高：{top10['key']}={top10['y10']}/{y10_total} ({top10['y10']/y10_total:.1%})")
    # top2 share
    if len(by_etf) >= 2:
        s2 = (by_etf[0]["y5"] + by_etf[1]["y5"]) / y5_total
        if s2 > 0.55:
            status = "WARN"
            reasons.append(f"Y5+ Top2 ETF 合计 {s2:.1%} > 55%")
    years_with_pos = sum(1 for y in by_year if y["y5"] > 0)
    if years_with_pos < 2:
        status = "FAIL"
        reasons.append(f"仅 {years_with_pos} 个自然年有 Y5+，需 ≥2")
    if c5["independent_clusters"] < 40:
        status = "FAIL" if c5["independent_clusters"] < 25 else "WARN"
        reasons.append(f"Y5 独立正簇 {c5['independent_clusters']}（目标≥40）")
    if c10["independent_clusters"] < 60:
        # soft for y10
        if c10["independent_clusters"] < 40:
            status = "FAIL" if status != "FAIL" and c10["independent_clusters"] < 25 else status
            if status == "PASS":
                status = "WARN"
        else:
            if status == "PASS":
                status = "WARN"
        reasons.append(f"Y10 独立正簇 {c10['independent_clusters']}（目标≥60）")
    if c5["avg_pos_per_cluster"] > 4:
        if status == "PASS":
            status = "WARN"
        reasons.append(f"Y5 簇内平均正样本 {c5['avg_pos_per_cluster']} 偏高（相关重复）")
    return {"status": status, "reasons": reasons}


def md_table(rows, headers):
    lines = ["| " + " | ".join(headers) + " |", "|" + "|".join(["---"] * len(headers)) + "|"]
    for r in rows:
        lines.append("| " + " | ".join(str(r[h]) for h in headers) + " |")
    return "\n".join(lines)


def main():
    args = parse_args()
    csv_path = find_csv(args.csv)
    rows = load_rows(csv_path)
    rows = assign_clusters(rows, args.cluster_gap)

    by_etf = agg_table(rows, lambda r: r["code"], "y5")
    by_year = agg_table(rows, lambda r: r["year"], "y5")
    by_regime = agg_table(rows, regime_proxy, "y5")
    c5 = cluster_stats(rows, "y5")
    c10 = cluster_stats(rows, "y10")
    gate = decide_gate(by_etf, by_year, c5, c10)

    stamp = datetime.utcnow().strftime("%Y-%m-%d")
    payload = {
        "generated_at": datetime.utcnow().isoformat() + "Z",
        "csv": str(csv_path.relative_to(ROOT)),
        "cluster_gap_days": args.cluster_gap,
        "gate": gate,
        "totals": {
            "s2": len(rows),
            "y5": sum(r["y5"] for r in rows),
            "y10": sum(r["y10"] for r in rows),
            "clusters": len({r["event_cluster_id"] for r in rows})
        },
        "by_etf": by_etf,
        "by_year": by_year,
        "by_regime_proxy": by_regime,
        "cluster_y5": c5,
        "cluster_y10": c10,
        "note": "regime_proxy 用 rs_20d/ret_20d 分箱，非生产 MarketRegime"
    }

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    REPORT_DIR.mkdir(parents=True, exist_ok=True)
    json_path = OUT_DIR / f"phase15-sample-quality-{stamp}.json"
    # enrich csv with cluster id for downstream
    enrich_path = ROOT / "ml" / "datasets" / f"early_transition_s2_clustered_{stamp}.csv"
    fieldnames = list(rows[0].keys())
    fieldnames = [k for k in fieldnames if not k.startswith("_")]
    if "event_cluster_id" not in fieldnames:
        fieldnames.append("event_cluster_id")
    with enrich_path.open("w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=fieldnames, extrasaction="ignore")
        w.writeheader()
        for r in rows:
            w.writerow({k: r.get(k) for k in fieldnames})

    with json_path.open("w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)

    md_path = REPORT_DIR / f"V4.0-Phase1.5-样本质量审计-{stamp}.md"

    print("════════ Phase 1.5 样本质量 ════════")
    print(f"GATE {gate['status']}")
    for r in gate["reasons"]:
        print(" -", r)
    print(f"Y5 raw={c5['raw_positive']} ind_clusters={c5['independent_clusters']} avg/cluster={c5['avg_pos_per_cluster']}")
    print(f"Y10 raw={c10['raw_positive']} ind_clusters={c10['independent_clusters']} avg/cluster={c10['avg_pos_per_cluster']}")
    print(json_path)
    print(enrich_path)

    md = []
    md.append("# V4.0 Phase 1.5 — 样本质量 / 独立性审计\n")
    md.append(f"日期：{stamp}\n")
    md.append(f"数据：`{payload['csv']}`\n")
    md.append(f"闸门：**{gate['status']}**\n")
    if gate["reasons"]:
        md.append("\n原因：\n")
        for r in gate["reasons"]:
            md.append(f"- {r}\n")
    md.append(f"\nRaw S2={payload['totals']['s2']}｜Y5+={payload['totals']['y5']}｜Y10+={payload['totals']['y10']}｜Clusters={payload['totals']['clusters']}\n")
    md.append("\n## A. 按 ETF\n\n")
    md.append("| ETF | S2 | Y5+ | Y10+ | Rate5 | Rate10 |\n|-----|----|-----|------|-------|--------|\n")
    for x in by_etf:
        md.append(f"| {x['key']} | {x['s2']} | {x['y5']} | {x['y10']} | {x['rate5']} | {x['rate10']} |\n")
    md.append("\n## B. 按年份\n\n")
    md.append("| Year | S2 | Y5+ | Y10+ | Rate5 | Rate10 |\n|------|----|-----|------|-------|--------|\n")
    for x in by_year:
        md.append(f"| {x['key']} | {x['s2']} | {x['y5']} | {x['y10']} | {x['rate5']} | {x['rate10']} |\n")
    md.append("\n## C. 按 Regime 代理\n\n")
    md.append("| Regime | S2 | Y5+ | Y10+ | Rate5 | Rate10 |\n|--------|----|-----|------|-------|--------|\n")
    for x in by_regime:
        md.append(f"| {x['key']} | {x['s2']} | {x['y5']} | {x['y10']} | {x['rate5']} | {x['rate10']} |\n")
    md.append("\n## D. 事件 Cluster（同 ETF ≤10 日合并）\n\n")
    md.append(f"| Label | Raw Positive | Independent Clusters | Max cluster share | Avg pos/cluster |\n")
    md.append(f"|-------|-------------:|---------------------:|------------------:|----------------:|\n")
    md.append(f"| Y5+ | {c5['raw_positive']} | {c5['independent_clusters']} | {c5['max_cluster_raw_share']} | {c5['avg_pos_per_cluster']} |\n")
    md.append(f"| Y10+ | {c10['raw_positive']} | {c10['independent_clusters']} | {c10['max_cluster_raw_share']} | {c10['avg_pos_per_cluster']} |\n")
    md.append("\n## 下一步\n\n")
    if gate["status"] == "FAIL":
        md.append("- **停止** Qlib 训练；扩池 / 去相关后再审计。\n")
    else:
        md.append("- 可进入 LightGBM Baseline Walk-Forward + Calibration（Challenger 报告；不改线上 V3.6.1）。\n")
        md.append("- 增强 CSV：`ml/datasets/early_transition_s2_clustered_*.csv`（含 event_cluster_id）。\n")
    md.append(f"\nJSON：`{json_path.relative_to(ROOT)}`\n")
    md_path.write_text("".join(md), encoding="utf-8")
    print(md_path)

    if gate["status"] == "FAIL":
        raise SystemExit(2)


if __name__ == "__main__":
    main()
