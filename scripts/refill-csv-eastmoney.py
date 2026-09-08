#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
东财前复权 CSV 长历史补全（fqt=1，lmt 可调，可超过腾讯 800 根上限）。
与 datasource.fetchDailyEastmoney 口径一致；写入 deliverables/etf_daily_qfq。

用法：
  python3 scripts/refill-csv-eastmoney.py
  python3 scripts/refill-csv-eastmoney.py deliverables/etf_daily_qfq --limit=3000
  python3 scripts/refill-csv-eastmoney.py --codes=518880,515880 --limit=5000
"""
import json
import os
import sys
import time
import urllib.request

ETFS = [
    ("513310", "中韩半导体ETF"),
    ("515880", "通信ETF"),
    ("159582", "半导体设备ETF"),
    ("518880", "黄金ETF"),
    ("159570", "港股通创新药ETF"),
]

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
    with urllib.request.urlopen(req, timeout=30) as resp:
        data = json.loads(resp.read().decode("utf-8"))
    node = (data.get("data") or {})
    klines = node.get("klines") or []
    rows = []
    for line in klines:
        p = str(line).split(",")
        if len(p) < 6:
            continue
        rows.append((p[0], p[1], p[2], p[3], p[4], p[5], p[6] if len(p) > 6 else ""))
    return rows


def parse_args():
    out_dir = "deliverables/etf_daily_qfq"
    limit = 3000
    codes = None
    args = [a for a in sys.argv[1:] if a]
    for a in args:
        if a.startswith("--limit="):
            limit = int(a.split("=", 1)[1])
        elif a.startswith("--codes="):
            codes = [c.strip() for c in a.split("=", 1)[1].split(",") if c.strip()]
        elif not a.startswith("--"):
            out_dir = a
    return out_dir, limit, codes


def main():
    out_dir, limit, code_filter = parse_args()
    os.makedirs(out_dir, exist_ok=True)
    pool = [e for e in ETFS if not code_filter or e[0] in code_filter]
    print(f"东财 fqt=1 补全 → {out_dir}  limit={limit}\n")

    starts = []
    for code, name in pool:
        try:
            rows = fetch_em(code, limit)
            if not rows:
                print(f"✗ {code} {name}: 空")
                continue
            out_file = os.path.join(out_dir, f"{code}_{name}_qfq.csv")
            with open(out_file, "w", encoding="utf-8-sig") as f:
                f.write("date,open,close,high,low,volume,amount\n")
                for p in rows:
                    f.write(f"{p[0]},{p[1]},{p[2]},{p[3]},{p[4]},{p[5]},{p[6]}\n")
            print(f"✓ {code} {name}: {len(rows)} 根  {rows[0][0]} ~ {rows[-1][0]}")
            starts.append(rows[0][0])
            time.sleep(0.6)
        except Exception as e:
            print(f"✗ {code} {name}: {e}")

    if starts:
        print(f"\n五票交集起点（取最晚）≈ {max(starts)}")
    print("完成。建议 node scripts/check-csv-coverage.js")


if __name__ == "__main__":
    main()
