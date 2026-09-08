#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
拉取 V4.0 ML 训练池前复权日线 → deliverables/etf_daily_ml_pool/

票单：ml/universe-train-pool.json（train + benchmark + negative_control）

用法：
  python3 scripts/ml/refill-ml-train-pool.py
  python3 scripts/ml/refill-ml-train-pool.py --limit=4000
  python3 scripts/ml/refill-ml-train-pool.py --codes=588000,512480
"""
import json
import os
import sys
import time
import urllib.request

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "../.."))
POOL_JSON = os.path.join(ROOT, "ml/universe-train-pool.json")
OUT_DIR = os.path.join(ROOT, "deliverables/etf_daily_ml_pool")

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
    "Referer": "https://quote.eastmoney.com/",
}


def to_secid(code: str) -> str:
    return f"1.{code}" if code.startswith(("5", "6")) else f"0.{code}"


def fetch_em(code: str, limit: int) -> list:
    secid = to_secid(code)
    url = (
        "https://push2his.eastmoney.com/api/qt/stock/kline/get"
        f"?secid={secid}&fields1=f1,f2,f3,f4,f5,f6"
        f"&fields2=f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61"
        f"&klt=101&fqt=1&beg=0&end=20500101&lmt={limit}"
    )
    req = urllib.request.Request(url, headers=HEADERS)
    with urllib.request.urlopen(req, timeout=45) as resp:
        data = json.loads(resp.read().decode("utf-8"))
    klines = ((data.get("data") or {}).get("klines")) or []
    rows = []
    for line in klines:
        p = str(line).split(",")
        if len(p) < 6:
            continue
        rows.append((p[0], p[1], p[2], p[3], p[4], p[5], p[6] if len(p) > 6 else ""))
    return rows


def load_pool():
    with open(POOL_JSON, "r", encoding="utf-8") as f:
        cfg = json.load(f)
    items = []
    for e in cfg.get("train_pool") or []:
        items.append(e)
    if cfg.get("benchmark"):
        items.append(cfg["benchmark"])
    for e in cfg.get("holdout_negative") or []:
        items.append(e)
    # dedupe by code
    seen = set()
    out = []
    for e in items:
        if e["code"] in seen:
            continue
        seen.add(e["code"])
        out.append(e)
    return out


def main():
    limit = 4000
    code_filter = None
    for a in sys.argv[1:]:
        if a.startswith("--limit="):
            limit = int(a.split("=", 1)[1])
        elif a.startswith("--codes="):
            code_filter = set(c.strip() for c in a.split("=", 1)[1].split(",") if c.strip())
        elif a.startswith("--out="):
            global OUT_DIR
            OUT_DIR = a.split("=", 1)[1]

    os.makedirs(OUT_DIR, exist_ok=True)
    pool = load_pool()
    if code_filter:
        pool = [e for e in pool if e["code"] in code_filter]

    print(f"ML train pool → {OUT_DIR}  n={len(pool)}  limit={limit}\n")
    ok = 0
    for e in pool:
        code, name = e["code"], e.get("name") or code
        try:
            rows = fetch_em(code, limit)
            if not rows:
                print(f"✗ {code} {name}: 空")
                continue
            path = os.path.join(OUT_DIR, f"{code}_{name}_qfq.csv")
            with open(path, "w", encoding="utf-8-sig") as f:
                f.write("date,open,close,high,low,volume,amount\n")
                for p in rows:
                    f.write(f"{p[0]},{p[1]},{p[2]},{p[3]},{p[4]},{p[5]},{p[6]}\n")
            print(f"✓ {code} {name}: {len(rows)}  {rows[0][0]}~{rows[-1][0]}  [{e.get('role')}]")
            ok += 1
            time.sleep(0.55)
        except Exception as ex:
            print(f"✗ {code} {name}: {ex}")
    print(f"\n完成 {ok}/{len(pool)}")


if __name__ == "__main__":
    main()
