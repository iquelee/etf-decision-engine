#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""M1-A —— 数据源能力与边界审计（仅针对 `universe_v1` 所指的 **10 只老 ETF**）。

用途
----
按 `ml/gen2/reports/gen2_data_boundary_freeze_20260915.md`（**FROZEN v1.1**）§6 的审计模板，
逐只留档「真实上市日 / 可交易性 / 复权口径 / 停牌缺口 / 成交额 / 250 日暖机」，
输出**机器可读证据**（供报告引用，避免手抄数字）。

边界（与用户裁决一致）
----------------------
* **只读**：不改任何锁定组件、不改 `deliverables/etf_daily_ml_pool/`（**不覆盖现有数据**）；
* **不拼接**：只取**单一来源**（东方财富 `push2his` 日线）；**不与腾讯序列拼接**；
  与腾讯序列的比较**仅用于「口径是否可比」的判定**，不产生任何拼接序列；
* **不算策略表现**：本脚本**不计算任何策略指标**。§「复权完整性」里出现的收益率比较
  **只用于数据完整性判定**（检出复权口径缺陷 / 份额折算），不构成任何策略读数，
  也不用于选取阈值（门槛已由裁决冻结）。
* 原始 payload 落到 `--cache`（默认系统临时目录，**不入库**）。

证据链
------
* 东方财富 `fqt=1`（前复权）与 `fqt=0`（不复权）**逐只全历史**；
* 交易日历 = 上证指数（`1.000001`，1990 起，每交易日都有）；
* 真实上市日 = `ml/gen2/universe/etf_master.csv` 的 `listing_date`（§3.1 唯一权威）。

运行::

    python scripts/ml/audit-m1a-etf-history.py --out ml/gen2/reports/gen2_m1a_data_source_audit_20260915.json
    python scripts/ml/audit-m1a-etf-history.py --offline --cache <dir> --out <json>   # 用已缓存 payload 复算
"""
from __future__ import annotations

import argparse
import csv
import hashlib
import json
import os
import sys
import time
import urllib.request
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
MASTER = ROOT / "ml" / "gen2" / "universe" / "etf_master.csv"
UNIVERSE = ROOT / "ml" / "gen2" / "universe" / "universe_v1.json"
POOL = ROOT / "deliverables" / "etf_daily_ml_pool"

#: `universe_v1.data_note` 所指的 10 只老 ETF（长历史待东财源补）
TEN = ["512010", "512690", "159928", "510880", "512800",
       "512000", "512400", "515220", "159941", "513500"]

CALENDAR_SECID = "1.000001"          # 上证指数 = A 股交易日历参照
UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36")
UT = "fa5fd1943c7b386f172d6893dbfba10b"

#: 门槛（freeze §2.4，**已裁决冻结**；本脚本只读取，不自创）
WARMUP_DAYS = 250
SUSPENSION_MAX = 20
LIQUIDITY_MIN_WAN = 3000.0
ROLL = 60

#: 任务书 §3.3 禁用清单（已被观察段）—— 只做重叠核对，**不用于任何选择的拟合**
OBSERVED = [("B3_OOS", "2021-01-04", "2026-09-04"),
            ("SEG_2020", "2020-03-10", "2020-12-31"),
            ("SEG_2018_2020", "2018-04-03", "2020-03-06")]
OBSERVED_MIN_DATE = "2018-04-03"

POOL_WINDOW = ("2024-01-15", "2026-09-04")

#: 「口径可比」判定阈值（**判定规则本身随报告一起接受**，非参数调优）
DISTORTION_RATIO_MAX = 0.01     # 日频收益失真 > 1pp 的天数占比上限
XSOURCE_DIVERGENCE_MAX_PP = 1.0  # 与既有腾讯池在重叠窗的累计收益偏离上限


# ------------------------------------------------------------------ 取数

def secid_of(code: str) -> str:
    """交易所前缀：5/6 开头 = 上交所（1.），其余 = 深交所（0.）。"""
    return ("1." if code[0] in "56" else "0.") + code


def kline_url(secid: str, fqt: int) -> str:
    return ("https://push2his.eastmoney.com/api/qt/stock/kline/get"
            f"?secid={secid}&ut={UT}&fields1=f1,f2,f3,f4,f5,f6"
            "&fields2=f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61"
            f"&klt=101&fqt={fqt}&beg=0&end=20500101&lmt=1000000")


def fetch(url: str, cache: Path, tries: int = 3, offline: bool = False) -> bytes:
    name = hashlib.sha256(url.encode()).hexdigest()[:16] + ".json"
    p = cache / name
    if p.is_file():
        return p.read_bytes()
    if offline:
        raise RuntimeError(f"--offline 且无缓存：{url}")
    last = None
    for _ in range(tries):
        try:
            req = urllib.request.Request(url, headers={
                "User-Agent": UA, "Referer": "https://quote.eastmoney.com/", "Accept": "*/*"})
            with urllib.request.urlopen(req, timeout=45) as fh:
                raw = fh.read()
            cache.mkdir(parents=True, exist_ok=True)
            p.write_bytes(raw)
            return raw
        except Exception as exc:            # noqa: BLE001
            last = exc
            time.sleep(1.2)
    raise RuntimeError(f"取数失败 {url}: {last}")


def parse_klines(raw: bytes) -> tuple[str | None, list[dict]]:
    j = json.loads(raw.decode("utf-8"))
    d = j.get("data") or {}
    rows = []
    for line in d.get("klines") or []:
        f = line.split(",")
        num = lambda s: None if s in ("", "-", "null") else float(s)   # noqa: E731
        rows.append({"date": f[0], "open": num(f[1]), "close": num(f[2]), "high": num(f[3]),
                     "low": num(f[4]), "volume": num(f[5]),
                     "amount": num(f[6]) if len(f) > 6 else None})
    return d.get("name"), rows


# ------------------------------------------------------------------ 指标

def rolling_worst_60(rows: list[dict]) -> tuple[float | None, str | None]:
    """§2.4 ① 口径：段内**逐日滚动 60 交易日窗口**的日均成交额取**最差**值（元）。"""
    clean = [(r["date"], r["amount"]) for r in rows if r["amount"] and r["amount"] > 0]
    if len(clean) < ROLL:
        return None, None
    worst, worst_day, run = None, None, 0.0
    for i, (d, v) in enumerate(clean):
        run += v
        if i >= ROLL:
            run -= clean[i - ROLL][1]
        if i >= ROLL - 1:
            m = run / ROLL
            if worst is None or m < worst:
                worst, worst_day = m, d
    return worst, worst_day


def liquidity_adequate_from(rows: list[dict]) -> str | None:
    """自该「窗口结束日」起，其后的**每个** 60 日窗口日均成交额均 ≥ 门槛。

    ⇒ 段起点 ≥ 该日即可通过 §2.4 ①。
    """
    clean = [(r["date"], r["amount"]) for r in rows if r["amount"] and r["amount"] > 0]
    if len(clean) < ROLL:
        return None
    wins, run = [], 0.0
    for i, (d, v) in enumerate(clean):
        run += v
        if i >= ROLL:
            run -= clean[i - ROLL][1]
        if i >= ROLL - 1:
            wins.append((d, run / ROLL))
    bad = [i for i, (_, m) in enumerate(wins) if m < LIQUIDITY_MIN_WAN * 1e4]
    if not bad:
        return wins[0][0]
    return wins[bad[-1] + 1][0] if bad[-1] + 1 < len(wins) else None


def yearly_worst_60(rows: list[dict]) -> dict:
    clean = [(r["date"], r["amount"]) for r in rows if r["amount"] and r["amount"] > 0]
    out, run = {}, 0.0
    for i, (d, v) in enumerate(clean):
        run += v
        if i >= ROLL:
            run -= clean[i - ROLL][1]
        if i >= ROLL - 1:
            m = run / ROLL / 1e4
            y = d[:4]
            if y not in out or m < out[y]:
                out[y] = m
    return {k: round(v, 1) for k, v in sorted(out.items())}


def max_gap_run(dateset: set, calendar: list[str]) -> tuple[int, dict | None]:
    run = best = 0
    cur: list[str] = []
    best_run = None
    def close(cur, run, best, best_run):
        if run > best:
            return run, {"from": cur[0], "to": cur[-1], "days": run}
        return best, best_run
    for d in calendar:
        if d in dateset:
            best, best_run = close(cur, run, best, best_run)
            run, cur = 0, []
        else:
            run += 1
            cur.append(d)
    best, best_run = close(cur, run, best, best_run)
    return best, best_run


def adj_audit(qfq: list[dict], raw: list[dict]) -> dict:
    """复权完整性审计。

    * **舍入感知的同日因子自洽**：qfq 四价是否 = raw 四价 × 同一倍率。
      预算含两序列各 0.001 的舍入及其传播项 —— 不加传播项会被舍入噪声淹没。
    * **日频收益失真度** `|qfq_ret − raw_ret|`：**决策相关**判据；合法情况下
      只应在「份额折算 / 分红除权」日显著。
    * **因子跳变**：`k = qfq_close/raw_close` 的日间变化（>0.5% / >1%），
      用于定位复权事件。
    """
    rm = {r["date"]: r for r in raw}
    bad, jumps05, jumps1 = [], [], []
    prev = None
    for x in qfq:
        y = rm.get(x["date"])
        if not y or not y["close"] or not x["close"]:
            continue
        k = x["close"] / y["close"]
        fields_bad = []
        for f in ("open", "high", "low"):
            if x[f] and y[f]:
                budget = 0.0005 * (1 + k) * (1 + y[f] / y["close"]) * 1.2
                if abs(x[f] - y[f] * k) > budget:
                    fields_bad.append(f)
        if fields_bad:
            bad.append({"date": x["date"], "fields": fields_bad})
        if prev:
            rel = abs(k / prev - 1)
            if rel > 0.01:
                jumps1.append({"date": x["date"], "factor_ratio": round(k / prev, 4)})
            elif rel > 0.005:
                jumps05.append({"date": x["date"], "factor_ratio": round(k / prev, 4)})
        prev = k

    dist = []
    for i in range(1, len(qfq)):
        d, qc = qfq[i]["date"], qfq[i]["close"]
        pc = qfq[i - 1]["close"]
        rc, prc = rm.get(d), rm.get(qfq[i - 1]["date"])
        if not rc or not prc or not pc or not prc["close"]:
            continue
        qr = qc / pc - 1
        rr = rc["close"] / prc["close"] - 1
        dist.append({"date": d, "diff_pp": abs(qr - rr) * 100,
                     "qfq_ret_pct": qr * 100, "raw_ret_pct": rr * 100})
    n1 = [x for x in dist if x["diff_pp"] > 1]
    n5 = [x for x in dist if x["diff_pp"] > 5]
    return {
        "same_day_factor_bad_days": len(bad),
        "same_day_factor_bad_sample": bad[:3],
        "factor_jump_gt1pct_count": len(jumps1),
        "factor_jump_gt1pct_sample": jumps1[:6],
        "factor_jump_0p5to1pct_count": len(jumps05),
        "return_distortion_gt1pp_count": len(n1),
        "return_distortion_gt1pp_ratio": round(len(n1) / max(1, len(dist)), 6),
        "return_distortion_gt1pp_by_year": _by_year(n1),
        "return_distortion_gt5pp_events": [
            {"date": x["date"], "diff_pp": round(x["diff_pp"], 2),
             "qfq_ret_pct": round(x["qfq_ret_pct"], 2), "raw_ret_pct": round(x["raw_ret_pct"], 2)}
            for x in n5],
        "max_single_day_raw_vs_qfq": _worst_single_day(dist, qfq, raw),
    }


def _by_year(rows: list[dict]) -> dict:
    out: dict[str, int] = {}
    for x in rows:
        y = x["date"][:4]
        out[y] = out.get(y, 0) + 1
    return dict(sorted(out.items()))


def _worst_single_day(dist: list[dict], qfq: list[dict], raw: list[dict]) -> dict | None:
    if not dist:
        return None
    w = min(dist, key=lambda x: x["raw_ret_pct"])
    return {"date": w["date"], "raw_ret_pct": round(w["raw_ret_pct"], 2),
            "qfq_ret_pct": round(w["qfq_ret_pct"], 2),
            "gap_pp": round(w["qfq_ret_pct"] - w["raw_ret_pct"], 2)}


def transform_audit(qfq: list[dict], raw: list[dict]) -> dict:
    """判定 fqt=1 相对 fqt=0 的**变换类型** —— 决定该前复权序列能否用于收益计算。

    三种形态（判据 = `raw−qfq` 与 `qfq/raw` 各自的变化点个数，容忍 3 位小数舍入）：

    * **A 比例式** `qfq = raw × k`，`k` 分段常数（变化点 ≈ 份额折算次数）
      ⇒ 非事件日收益与不复权序列**完全一致**，**可用于收益计算**。
    * **B 减法式** `qfq = raw − C`，`C` 分段常数（变化点 ≈ 分红次数）
      ⇒ 非事件日收益被系统性放大 `P/(P−C)` 倍，**会歪曲日频收益**；
      累计分红超过价格时前复权价可变为**负值** ⇒ 不是可用的价格序列。
    * **C 未定** 两种分段常数假设均不成立 ⇒ 变换机制未定，须人工裁决。

    注：本判定只比较 fqt=1 与 fqt=0 两条**同源**序列，**不拼接任何外部序列**。
    """
    rm = {r["date"]: r for r in raw}
    rows = [(x["date"], x["close"], rm[x["date"]]["close"])
            for x in qfq if x["date"] in rm and rm[x["date"]]["close"]]
    diff = [(t, rc - qc) for t, qc, rc in rows]
    ratio = [(t, qc / rc) for t, qc, rc in rows]

    def change_points(xs: list[tuple], tol: float) -> tuple[int, list[dict]]:
        n, pts = 0, []
        for i in range(1, len(xs)):
            if abs(xs[i][1] - xs[i - 1][1]) > tol:
                n += 1
                if len(pts) < 8:
                    pts.append({"date": xs[i][0], "value": round(xs[i][1], 4)})
        return n, pts

    d_n, d_pts = change_points(diff, 0.0015)
    k_n, k_pts = change_points(ratio, 0.0008)
    if k_n <= 30 and k_n < d_n:
        kind, why = "A 比例式", "非事件日收益与不复权序列一致，可用于收益计算"
    elif d_n <= 30 and d_n < k_n:
        kind, why = "B 减法式", "非事件日收益被系统性放大 P/(P−C) 倍，不可直接用于收益计算"
    else:
        kind, why = "C 未定", "分段常数假设均不成立，变换机制未定，须人工裁决"

    neg = [(t, qc) for t, qc, _ in rows if qc < 0]
    rv = [x[1] for x in ratio]
    return {
        "transform_kind": kind,
        "consequence": why,
        "diff_change_points": d_n,
        "diff_change_sample": d_pts,
        "ratio_change_points": k_n,
        "ratio_change_sample": k_pts,
        "ratio_min": round(min(rv), 4) if rv else None,
        "ratio_max": round(max(rv), 4) if rv else None,
        "negative_qfq_days": len(neg),
        "negative_qfq_min": round(min(q for _, q in neg), 3) if neg else None,
        "negative_qfq_sample": [t for t, _ in neg[:3]],
        "note": "A: qfq=raw×k（k 分段常数，份额折算族）/ B: qfq=raw−C（C 分段常数，分红减法族）/ C: 两者均不成立",
    }


def load_pool(code: str) -> dict[str, float]:
    p = POOL / f"{code}_qfq.csv"
    if not p.is_file():
        return {}
    out = {}
    with open(p, encoding="utf-8-sig", newline="") as fh:
        for r in csv.DictReader(fh):
            if r.get("close"):
                out[r["date"]] = float(r["close"])
    return out


def cross_source(qfq: list[dict], pool: dict[str, float]) -> dict | None:
    """与既有**腾讯池**在重叠窗的比较 —— **只用于「口径可比」判定，不产生拼接序列**。"""
    qm = {x["date"]: x["close"] for x in qfq}
    common = sorted(set(pool) & set(qm))
    if len(common) < 2:
        return None
    a = qm[common[-1]] / qm[common[0]] - 1
    b = pool[common[-1]] / pool[common[0]] - 1
    ratios = [pool[d] / qm[d] for d in common]
    return {"common_days": len(common), "first_common": common[0], "last_common": common[-1],
            "eastmoney_cum_pct": round(a * 100, 2), "tencent_pool_cum_pct": round(b * 100, 2),
            "cum_divergence_pp": round((a - b) * 100, 2),
            "price_ratio_min": round(min(ratios), 6), "price_ratio_max": round(max(ratios), 6),
            "identical": all(abs(r - 1.0) < 1e-12 for r in ratios)}


# ------------------------------------------------------------------ 主流程

def main() -> int:
    ap = argparse.ArgumentParser(description="M1-A 数据源能力与边界审计（10 只老 ETF）")
    ap.add_argument("--out", required=True, help="审计 JSON 输出路径")
    ap.add_argument("--cache", default=None, help="原始 payload 缓存目录（默认系统临时目录）")
    ap.add_argument("--offline", action="store_true", help="只用缓存，不联网")
    args = ap.parse_args()

    cache = Path(args.cache) if args.cache else Path(
        os.environ.get("TEMP", "/tmp")) / "m1a_em_cache"
    offline = bool(args.offline)
    get = lambda url: fetch(url, cache, offline=offline)   # noqa: E731

    master = {}
    with open(MASTER, encoding="utf-8-sig", newline="") as fh:
        for r in csv.DictReader(fh):
            master[r["code"]] = r
    uni = json.loads(UNIVERSE.read_text(encoding="utf-8"))

    cal_raw = get(kline_url(CALENDAR_SECID, 0))
    _, cal_rows = parse_klines(cal_raw)
    calendar = [r["date"] for r in cal_rows]

    out = {
        "audit": "M1-A 数据源能力与边界审计（10 只老 ETF）",
        "generated_on": date.today().isoformat(),
        "authority": {
            "freeze": "ml/gen2/reports/gen2_data_boundary_freeze_20260915.md (FROZEN v1.1)",
            "taskbook": "ml/gen2/reports/gen2_attack_side_taskbook_20260915.md (M0 rev5)",
            "master": "ml/gen2/universe/etf_master.csv",
            "universe": "ml/gen2/universe/universe_v1.json",
        },
        "source": {
            "provider": "东方财富 push2his kline",
            "endpoint": "https://push2his.eastmoney.com/api/qt/stock/kline/get",
            "klt": 101, "fqt_adjusted": 1, "fqt_raw": 0,
            "calendar_secid": CALENDAR_SECID,
            "calendar": {"first_date": calendar[0], "last_date": calendar[-1], "days": len(calendar)},
            "note": ("前复权基准 = **序列最后一个交易日**（随抓取日漂移）⇒ 跨抓取日/跨源拼接会产生"
                     "虚假跳变；原始 payload 的 sha256 只在 `generated_on` 当日有效。"),
        },
        "thresholds": {
            "warmup_days": WARMUP_DAYS, "suspension_max": SUSPENSION_MAX,
            "liquidity_min_wan": LIQUIDITY_MIN_WAN, "roll_window": ROLL,
            "distortion_ratio_max": DISTORTION_RATIO_MAX,
            "xsource_divergence_max_pp": XSOURCE_DIVERGENCE_MAX_PP,
        },
        "observed_segments": [{"name": a, "first": b, "last": c} for a, b, c in OBSERVED],
        "scoped_codes": TEN,
        "symbols": [],
    }

    for code in TEN:
        m = master.get(code, {})
        q_raw = get(kline_url(secid_of(code), 1))
        r_raw = get(kline_url(secid_of(code), 0))
        em_name, qfq = parse_klines(q_raw)
        _, raw = parse_klines(r_raw)

        dates = [x["date"] for x in qfq]
        first, last = dates[0], dates[-1]
        dateset = set(dates)
        cal_win = [d for d in calendar if first <= d <= last]
        gap_days = len(cal_win) - len(dateset)
        longest, longest_run = max_gap_run(dateset, cal_win)

        worst60, worst60_day = rolling_worst_60(qfq)
        seg_avg = (sum(x["amount"] for x in qfq if x["amount"]) /
                   max(1, sum(1 for x in qfq if x["amount"]))) / 1e4
        liq_from = liquidity_adequate_from(qfq)
        warm_from = dates[WARMUP_DAYS] if len(dates) > WARMUP_DAYS else None

        audit = adj_audit(qfq, raw)
        tform = transform_audit(qfq, raw)
        xs = cross_source(qfq, load_pool(code))

        overlap = [{"segment": n, "days": sum(1 for d in dateset if a <= d <= b)}
                   for n, a, b in OBSERVED]
        pre_days = sum(1 for d in dates if d < OBSERVED_MIN_DATE)
        pre_dev = dates[WARMUP_DAYS] if (len(dates) > WARMUP_DAYS and dates[WARMUP_DAYS] < OBSERVED_MIN_DATE) else None

        candidates = [x for x in (warm_from, liq_from) if x]
        merged = max(candidates) if len(candidates) == 2 else None

        # ---- 分类判定（规则随报告一起接受；门槛不自创）----
        reasons, klass = [], None
        if m.get("listing_date") != first:
            reasons.append("X? 新取数首日与真实上市日不一致")
        if not (m.get("tradable") == "1"):
            klass, reasons = "排除", reasons + ["X1 非场内可交易"]
        if longest > SUSPENSION_MAX:
            klass, reasons = "排除", reasons + [f"X3 连续停牌 {longest} > {SUSPENSION_MAX} 交易日"]
        if audit["return_distortion_gt1pp_ratio"] > DISTORTION_RATIO_MAX:
            reasons.append(f"口径疑问：日频收益失真 >1pp 占比 {audit['return_distortion_gt1pp_ratio']:.2%}"
                           f"（上限 {DISTORTION_RATIO_MAX:.0%}）")
        if xs and xs["cum_divergence_pp"] and abs(xs["cum_divergence_pp"]) > XSOURCE_DIVERGENCE_MAX_PP:
            reasons.append(f"口径疑问：与既有腾讯池累计收益偏离 {xs['cum_divergence_pp']:+.2f}pp"
                           f"（上限 ±{XSOURCE_DIVERGENCE_MAX_PP:g}pp）")
        if not tform["transform_kind"].startswith("A"):
            reasons.append(f"复权变换类型 = {tform['transform_kind']}（{tform['consequence']}）")
        if tform["negative_qfq_days"]:
            reasons.append(f"该源前复权序列出现 {tform['negative_qfq_days']} 个交易日**负价**"
                           f"（最低 {tform['negative_qfq_min']}）⇒ 不是可用的价格序列")
        if klass is None:
            if reasons:
                klass = "需人工裁决"
            else:
                klass = "可纳入"
                reasons.append("复权完整性、缺口、暖机、流动性均可判定；未命中 X1–X6")

        out["symbols"].append({
            "code": code, "name": m.get("name"), "em_name": em_name,
            "sector": m.get("sector"), "cluster": m.get("correlation_cluster"),
            "asset_class": m.get("asset_class"),
            # --- freeze §6.1 模板字段 ---
            "listing_date": m.get("listing_date"),
            "txn_eligible": m.get("tradable") == "1",
            "local_first_date": first, "local_last_date": last, "rows": len(dates),
            "rows_raw": len(raw),
            "first_day_matches_listing": m.get("listing_date") == first,
            "warmup_ok": len(dates) > WARMUP_DAYS,
            "adj_source": "eastmoney push2his kline fqt=1（前复权）",
            "adj_basis_date": last,
            "splice_anchor": "n/a（单一源，无拼接）",
            "max_suspension": longest,
            "max_suspension_run": longest_run,
            "avg_turnover_60d_wan": round(worst60 / 1e4, 1) if worst60 else None,
            "avg_turnover_60d_window_end": worst60_day,
            "avg_turnover_seg_wan": round(seg_avg, 1),
            "liquidity_ok_full_history": bool(worst60 and worst60 >= LIQUIDITY_MIN_WAN * 1e4),
            "observed_overlap": overlap,
            "evidence": {
                "qfq_payload_sha256": hashlib.sha256(q_raw).hexdigest(),
                "raw_payload_sha256": hashlib.sha256(r_raw).hexdigest(),
                "payload_bytes": {"qfq": len(q_raw), "raw": len(r_raw)},
                "command": "python scripts/ml/audit-m1a-etf-history.py",
            },
            "include_recommended": klass, "include_reasons": reasons,
            # --- 扩展审计 ---
            "capability": {
                "earliest_dev_start_250": warm_from,
                "liquidity_adequate_from": liq_from,
                "merged_earliest_dev_start": merged,
                "pre_observed_days": pre_days,
                "dev_start_pre_observed_ok": pre_dev,
                "usable_under_strict_date_reading": bool(pre_dev),
            },
            "gaps": {"calendar_days_in_span": len(cal_win), "missing_trading_days": gap_days,
                     "suspension_ok": longest <= SUSPENSION_MAX},
            "turnover_yearly_worst_60d_wan": yearly_worst_60(qfq),
            "adj": audit,
            "transform": tform,
            "cross_source_vs_pool": xs,
        })
        print(f"[M1-A] {code} {m.get('name')}  rows={len(dates)} {first}~{last} "
              f"class={klass} dist>1pp={audit['return_distortion_gt1pp_count']} "
              f"transform={tform['transform_kind']}")

    # ---- 汇总 ----
    syms = out["symbols"]
    by = {}
    for s in syms:
        by.setdefault(s["include_recommended"], []).append(s["code"])
    out["summary"] = {
        "counts": {k: len(v) for k, v in by.items()},
        "by_class": by,
        "clusters_all": sorted({s["cluster"] for s in syms if s["cluster"]}),
        "clusters_of_included": sorted({s["cluster"] for s in syms
                                        if s["include_recommended"] == "可纳入" and s["cluster"]}),
        "merged_earliest_dev_start_all": (max(s["capability"]["merged_earliest_dev_start"] for s in syms)
                                          if all(s["capability"]["merged_earliest_dev_start"] for s in syms) else None),
        "strict_date_reading_usable": sorted(s["code"] for s in syms
                                             if s["capability"]["usable_under_strict_date_reading"]),
        "strict_date_reading_common_dev_start": (max(s["capability"]["dev_start_pre_observed_ok"] for s in syms
                                                     if s["capability"]["dev_start_pre_observed_ok"])
                                                 if any(s["capability"]["dev_start_pre_observed_ok"] for s in syms) else None),
        "transform_kinds": {s["code"]: s["transform"]["transform_kind"] for s in syms},
    }
    # 截断普查（全池，支撑「还有谁可同法补全」）
    census = []
    for r in master.values():
        if r.get("listing_date") and r.get("data_start_date") and r["data_start_date"] > r["listing_date"]:
            census.append({"code": r["code"], "name": r["name"],
                           "listing_date": r["listing_date"], "local_data_start": r["data_start_date"]})
    out["truncation_census"] = {"total_in_master": len(master), "truncated": census,
                                "universe_v1_data_note_lists": 10}
    out["survivorship_note"] = ("存活偏差专项（freeze §2.5）**未完成**：需要「区间内曾存在但已清盘/合并/转型」"
                               "的 ETF 清单，本次未取到。按 §2.5，该清单缺失时，使用该段的结论"
                               "**只能用于机制否证，不得用于资格判定**，且报告须声明「本段存在未量化的生存偏差」。")

    outp = Path(args.out)
    outp.parent.mkdir(parents=True, exist_ok=True)
    outp.write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"[M1-A] wrote {outp}  ({outp.stat().st_size} bytes)")
    print(f"[M1-A] classify: {out['summary']['counts']}")
    print(f"[M1-A] merged earliest Dev (all 10): {out['summary']['merged_earliest_dev_start_all']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
