#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""Gen-2 O2 —— 扩池候选的机械枚举与边界审计。

裁决 C（2026-09-15）：
    O2 扩池**批准**，但先做**候选清单与边界审计**，不做策略回测。
    候选池**至少新增 12 只**此前未观察、较早上市、可交易 ETF，给准入淘汰留缓冲。
    **选取只能依据 上市、流动性、类别覆盖，不得看收益表现。**

本脚本据此：
  ① 机械枚举东财 ETF 全表（`clist`，含上市日 `f26`）—— 保证候选不是手工挑的；
  ② 以 `scripts/ml/build-cluster-taxonomy.py` 的 `keyword_rule_v1` 指派 L2 cluster；
  ③ 逐只取**东财全历史前复权**（`fqt=1`，与 M1-A 同源同法）算：真实上市日、250 日暖机、
     最长连续缺口（停牌）、§2.4① 口径的 60 日滚动最差成交额；
  ④ **全程不读** 涨跌幅字段（f2/f3/f4/f15..f18），从代码层面杜绝「看收益挑标的」。

裁决 E：本脚本**只**产出日线与成交额读数；生存偏差证据由交易所官方公告另行承担
（见 `ml/gen2/reports/gen2_m1b_survivorship_20260915.md`）。

用法：
    python scripts/ml/screen-o2-candidates.py --out ml/gen2/reports/gen2_m1b_o2_candidates_20260915.json
    python scripts/ml/screen-o2-candidates.py --out <p> --offline        # 只用缓存
    python scripts/ml/screen-o2-candidates.py --out <p> --cache <dir>    # 指定缓存
"""
from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import sys
import time
import urllib.request
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
TAXY_PATH = ROOT / "scripts" / "ml" / "build-cluster-taxonomy.py"

# ---------------------------------------------------------------- 冻结门槛（freeze §2.4）
WARMUP = 250                 # 暖机期，交易日
SUSP_MAX = 20                # 停牌上限，连续交易日（严格大于才排除）
LIQ_MIN_WAN = 3000.0         # 流动性下限，万元
ROLL = 60                    # 流动性滚动窗口，交易日
OBSERVED_END = "2018-04-02"  # 未被观察的最后一日（观察段自 2018-04-03 起）
EARLY_LISTING_CUTOFF = "2017-12-31"
MIN_NEW_CANDIDATES = 12      # 裁决 C 的下限

UA = {"User-Agent": ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                     "(KHTML, like Gecko) Chrome/124.0 Safari/537.36"),
      "Referer": "https://quote.eastmoney.com/center/gridlist.html", "Accept": "*/*"}
UT = "bd1d9ddb04089700cf9c27f6f7426281"
CLIST_FIELDS = "f1,f2,f3,f4,f5,f6,f12,f13,f14,f15,f16,f17,f18,f20,f21,f26"
CLIST_FS = "b:MK0021,b:MK0023,b:MK0022,b:MK0024"
CLIST_HOSTS = ["push2.eastmoney.com", "1.push2.eastmoney.com", "7.push2.eastmoney.com",
               "82.push2.eastmoney.com", "push2delay.eastmoney.com"]
KL_HOSTS = ["push2his.eastmoney.com", "1.push2his.eastmoney.com", "7.push2his.eastmoney.com",
            "82.push2his.eastmoney.com", "push2his.eastmoney.com"]
KLINE_TPL = ("https://push2his.eastmoney.com/api/qt/stock/kline/get?secid={secid}&ut={ut}"
             "&fields1=f1,f2,f3,f4,f5,f6&fields2=f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61"
             "&klt=101&fqt={fqt}&beg=0&end=20500101&lmt=1000000")


# ---------------------------------------------------------------- 取数
def _get(url: str, hosts: list[str], tries: int = 8, pause: float = 0.5) -> bytes:
    last = None
    for i in range(tries):
        u = url.replace(hosts[0], hosts[i % len(hosts)], 1)
        try:
            req = urllib.request.Request(u, headers=UA)
            with urllib.request.urlopen(req, timeout=30) as r:
                b = r.read()
            time.sleep(pause)
            return b
        except Exception as e:  # noqa: BLE001
            last = e
            time.sleep(1.0 * (i + 1))
    raise RuntimeError(f"取数失败 {url}: {type(last).__name__}: {last}")


def cached(url: str, cache: Path, hosts: list[str], offline: bool = False,
           pause: float = 0.5) -> bytes:
    cache.mkdir(parents=True, exist_ok=True)
    fp = cache / f"{hashlib.sha256(url.encode()).hexdigest()[:16]}.json"
    if fp.exists():
        return fp.read_bytes()
    if offline:
        raise FileNotFoundError(f"offline 且无缓存：{url}")
    b = _get(url, hosts, pause=pause)
    fp.write_bytes(b)
    return b


def clist_all(cache: Path, offline: bool) -> list[dict]:
    rows: dict[str, dict] = {}
    pn, pz = 1, 100
    total = None
    while True:
        url = (f"https://push2.eastmoney.com/api/qt/clist/get?pn={pn}&pz={pz}&po=0&np=1"
               f"&fltt=2&invt=2&fid=f12&fs={CLIST_FS}&fields={CLIST_FIELDS}&ut={UT}")
        d = json.loads(cached(url, cache / "clist", CLIST_HOSTS, offline))
        data = d.get("data") or {}
        total = int(data.get("total") or 0) if total is None else total
        diff = data.get("diff") or []
        if not diff:
            break
        for r in diff:
            rows[str(r["f12"])] = r
        if len(rows) >= total or pn > 40:
            break
        pn += 1
    return list(rows.values())


# ---------------------------------------------------------------- M1-A 原语
def _load_m1a():
    p = ROOT / "scripts" / "ml" / "audit-m1a-etf-history.py"
    spec = importlib.util.spec_from_file_location("m1a", p)
    m = importlib.util.module_from_spec(spec)
    assert spec and spec.loader
    spec.loader.exec_module(m)
    return m


def _load_taxy():
    spec = importlib.util.spec_from_file_location("taxy", TAXY_PATH)
    m = importlib.util.module_from_spec(spec)
    assert spec and spec.loader
    spec.loader.exec_module(m)
    return m


def main() -> int:
    ap = argparse.ArgumentParser(description="O2 扩池候选机械枚举与边界审计")
    ap.add_argument("--out", required=True)
    ap.add_argument("--cache", default=None)
    ap.add_argument("--offline", action="store_true")
    ap.add_argument("--enum", default=None,
                    help="复用已落盘的 clist 枚举 JSON（跳过枚举请求，便于复核与限流期重跑）")
    ap.add_argument("--master", default=str(ROOT / "ml/gen2/universe/etf_master.csv"))
    a = ap.parse_args()

    cache = Path(a.cache) if a.cache else Path.home() / ".cache" / "gen2-o2-screen"
    m1a, taxy = _load_m1a(), _load_taxy()
    import csv
    pool = {r["code"] for r in csv.DictReader(open(a.master, encoding="utf-8-sig", newline=""))}

    # ① 枚举
    if a.enum:
        enum = json.loads(Path(a.enum).read_text(encoding="utf-8"))
        enum_src = f"复用落盘枚举 {a.enum}"
    else:
        enum = clist_all(cache, a.offline)
        enum_src = f"实时枚举（fs={CLIST_FS}）"
    print(f"[screen] 枚举 ETF = {len(enum)} | 现有池 = {len(pool)} | {enum_src}")

    def f26(r: dict) -> str | None:
        v = r.get("f26")
        s = str(v) if v not in (None, "", "-", 0) else None
        return f"{s[:4]}-{s[4:6]}-{s[6:]}" if s else None

    # ② 分类 + 初筛
    rows = []
    for r in enum:
        code, name = str(r["f12"]), str(r.get("f14") or "")
        cl, kind = taxy.classify_name(name)
        rows.append({
            "code": code, "name": name,
            "market": "SH" if str(r.get("f13")) == "1" else "SZ",
            "listing_date_vendor": f26(r),
            "in_current_pool": code in pool,
            "l2_cluster": cl, "kind": kind,
            "l1_sector": taxy.L2_TO_L1.get(cl),
            "coverage_eligible": cl not in taxy.NON_SECTOR_CLUSTERS,
            "amount_wan_today": (round(float(r["f6"]) / 1e4, 1)
                                 if isinstance(r.get("f6"), (int, float)) else None),
            "mktcap_yi_today": (round(float(r["f20"]) / 1e8, 2)
                                if isinstance(r.get("f20"), (int, float)) else None),
        })
    cand = [r for r in rows
            if not r["in_current_pool"] and r["listing_date_vendor"]
            and r["listing_date_vendor"] <= EARLY_LISTING_CUTOFF
            and r["kind"] != "excluded"]
    cand.sort(key=lambda r: (r["listing_date_vendor"], r["code"]))
    print(f"[screen] 候选（未观察 & 上市<={EARLY_LISTING_CUTOFF} & 非货基/债）= {len(cand)}")

    # ③ 逐只边界读数
    # ⚠ 日历用 fqt=0：与 M1-A 的日历缓存同键（日历与复权无关，指数序列日期一致）
    cal_url = m1a.kline_url(m1a.CALENDAR_SECID, 0)
    calendar: list[str] = []
    cal_err = None
    try:
        _cn, crows = m1a.parse_klines(cached(cal_url, cache / "kline", KL_HOSTS, a.offline))
        calendar = [c["date"] for c in crows]
        print(f"[screen] 日历 {calendar[0]} → {calendar[-1]} ({len(calendar)} 日)")
    except Exception as e:  # noqa: BLE001
        cal_err = f"{type(e).__name__}: {e}"
        print(f"[screen] ⚠ 日历不可得（{cal_err}）⇒ 暖机/停牌读数留空，仍出候选")

    ok = pending = 0
    for i, rec in enumerate(cand, 1):
        url = m1a.kline_url(m1a.secid_of(rec["code"]), 1)
        try:
            _n, k = m1a.parse_klines(cached(url, cache / "kline", KL_HOSTS, a.offline))
        except Exception as e:  # noqa: BLE001
            rec.update({"data_ok": False, "data_error": f"{type(e).__name__}: {e}"})
            pending += 1
            continue
        ok += 1
        dates = [x["date"] for x in k]
        rec.update({
            "data_ok": True, "rows": len(k),
            "local_first_date": dates[0], "local_last_date": dates[-1],
            "listing_matches_vendor": dates[0] == rec["listing_date_vendor"],
            "earliest_dev_start_250": dates[WARMUP - 1] if len(dates) >= WARMUP else None,
        })
        sub = [x for x in k if x["date"] <= OBSERVED_END]
        rec["pre_observed_days"] = len(sub)
        if len(dates) >= WARMUP:
            rec["warmup_ready_before_observed_end"] = dates[WARMUP - 1] <= OBSERVED_END
        if calendar and sub:
            lo, hi = sub[0]["date"], sub[-1]["date"]
            longest, run = m1a.max_gap_run({x["date"] for x in sub},
                                           [d for d in calendar if lo <= d <= hi])
            rec["max_suspension_pre_observed"] = longest
            rec["max_suspension_run"] = run
            rec["suspension_ok"] = longest <= SUSP_MAX
        w_all, w_all_d = m1a.rolling_worst_60(k)
        w_pre, w_pre_d = (m1a.rolling_worst_60(sub) if len(sub) >= ROLL else (None, None))
        rec["w60_wan_full"] = round(w_all / 1e4, 1) if w_all else None
        rec["w60_full_end"] = w_all_d
        rec["w60_wan_pre_observed"] = round(w_pre / 1e4, 1) if w_pre else None
        rec["w60_pre_end"] = w_pre_d
        rec["liquidity_ok_pre_observed"] = bool(w_pre and w_pre >= LIQ_MIN_WAN * 1e4)
        rec["liquidity_ok_full"] = bool(w_all and w_all >= LIQ_MIN_WAN * 1e4)
        if i % 15 == 0 or i == len(cand):
            print(f"  [{i:03d}/{len(cand)}] ok={ok} pending={pending} {rec['code']}")

    # ④ 汇总
    by_cluster: dict[str, int] = {}
    for r in cand:
        by_cluster[r["l2_cluster"]] = by_cluster.get(r["l2_cluster"], 0) + 1
    sector_covered = sorted(c for c in by_cluster
                            if c not in taxy.NON_SECTOR_CLUSTERS and by_cluster[c] > 0)
    liq_ok = [r for r in cand if r.get("liquidity_ok_pre_observed")]
    summary = {
        "candidates_total": len(cand),
        "candidates_with_kline": ok,
        "candidates_pending_data": pending,
        "calendar": ({"first": calendar[0], "last": calendar[-1], "days": len(calendar),
                      "error": cal_err} if calendar else {"available": False, "error": cal_err}),
        "by_cluster": dict(sorted(by_cluster.items())),
        "sector_clusters_covered": sector_covered,
        "n_sector_clusters_covered": len(sector_covered),
        "coverage_denominator": 8,
        "coverage_meets_gate_ge6": len(sector_covered) >= 6,
        "min_12_new_satisfied": len(cand) >= MIN_NEW_CANDIDATES,
        "unmatched_needs_review": [{"code": r["code"], "name": r["name"]}
                                   for r in cand if r["kind"] == "unknown"],
        "liquidity_pass_pre_observed": [r["code"] for r in liq_ok],
        "n_liquidity_pass": len(liq_ok),
    }
    payload = {
        "audit": "gen2_m1b_o2_candidate_screen",
        "generated_on": date.today().isoformat(),
        "authority": {
            "ruling_C": ("O2 扩池批准：≥12 只未观察/较早上市/可交易；只依据上市、流动性、"
                         "类别覆盖；不得看收益表现"),
            "ruling_D": "cluster 归属以 ml/gen2/universe/cluster_taxonomy_v1.json 为准",
            "ruling_E": "本文件只承担日线与成交额；生存偏差由交易所官方公告承担",
            "freeze": "ml/gen2/reports/gen2_data_boundary_freeze_20260915.md (FROZEN v1.1)",
        },
        "method": {
            "enumeration": (f"东财 clist fs={CLIST_FS}（含 f26 上市日），主机轮换+缓存；"
                            f"本次来源 = {enum_src}"),
            "classification": "keyword_rule_v1（scripts/ml/build-cluster-taxonomy.py，单一真相源）",
            "price_source": "东财 push2his kline fqt=1（与 M1-A 同源同法）",
            "return_blindness": "全程未读取 f2/f3/f4/f15..f18 等涨跌字段",
        },
        "thresholds": {"warmup_days": WARMUP, "suspension_max_consecutive": SUSP_MAX,
                       "liquidity_min_wan": LIQ_MIN_WAN, "roll_window": ROLL,
                       "observed_end": OBSERVED_END,
                       "early_listing_cutoff": EARLY_LISTING_CUTOFF},
        "summary": summary,
        "candidates": cand,
        "universe_scan": {"enumerated_total": len(enum), "pool_size": len(pool),
                          "all_rows_by_kind": {k: sum(1 for r in rows if r["kind"] == k)
                                               for k in sorted({r["kind"] for r in rows})}},
    }
    outp = Path(a.out)
    outp.parent.mkdir(parents=True, exist_ok=True)
    outp.write_text(json.dumps(payload, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"[screen] wrote {outp}")
    print(f"[screen] 候选 {len(cand)} | 有日线 {ok} | 待取数 {pending}")
    print(f"[screen] sector 覆盖 {len(sector_covered)}/8 -> {sector_covered}")
    print(f"[screen] ≥12 新增：{'OK' if summary['min_12_new_satisfied'] else 'NOT MET'}"
          f" | ≥6/8：{'OK' if summary['coverage_meets_gate_ge6'] else 'NOT MET'}")
    print(f"[screen] 流动性通过（未观察窗）n={len(liq_ok)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
