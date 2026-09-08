#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
五票前复权 CSV 全量重灌（本地 deliverables，不进 CloudBase）。
数据源：腾讯 fqkline qfq，最多约 800 根/票。

用法：
  python3 scripts/refill-csv-qfq.py
  python3 scripts/refill-csv-qfq.py deliverables/etf_daily_qfq
"""
import json
import os
import sys
import time
import urllib.request

ETFS = [
    ("513310", "中韩半导体ETF", "sh"),
    ("515880", "通信ETF", "sh"),
    ("159582", "半导体设备ETF", "sz"),
    ("518880", "黄金ETF", "sh"),
    ("159570", "港股通创新药ETF", "sz"),
]

HEADERS = {"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)"}
LIMIT = 800


def fetch_qfq(code, prefix, limit=LIMIT):
    url = (
        "https://web.ifzq.gtimg.cn/appstock/app/fqkline/get"
        f"?param={prefix}{code},day,,,{limit},qfq"
    )
    req = urllib.request.Request(url, headers=HEADERS)
    with urllib.request.urlopen(req, timeout=25) as resp:
        data = json.loads(resp.read().decode("utf-8"))
    node = (data.get("data") or {}).get(f"{prefix}{code}") or {}
    rows = node.get("qfqday") or node.get("day") or []
    return rows


def main():
    out_dir = sys.argv[1] if len(sys.argv) > 1 else "deliverables/etf_daily_qfq"
    os.makedirs(out_dir, exist_ok=True)
    print(f"重灌五票 qfq CSV → {out_dir}（limit={LIMIT}）\n")

    summary = []
    for code, name, prefix in ETFS:
        try:
            rows = fetch_qfq(code, prefix)
            if not rows:
                print(f"✗ {code} {name}: 空数据")
                summary.append((code, 0, None, None))
                continue
            out_file = os.path.join(out_dir, f"{code}_{name}_qfq.csv")
            with open(out_file, "w", encoding="utf-8-sig") as f:
                f.write("date,open,close,high,low,volume,amount\n")
                for p in rows:
                    amt = p[6] if len(p) > 6 else ""
                    f.write(f"{p[0]},{p[1]},{p[2]},{p[3]},{p[4]},{p[5]},{amt}\n")
            print(
                f"✓ {code} {name}: {len(rows)} 根  "
                f"{rows[0][0]} ~ {rows[-1][0]}  → {os.path.basename(out_file)}"
            )
            summary.append((code, len(rows), rows[0][0], rows[-1][0]))
            time.sleep(0.8)
        except Exception as e:
            print(f"✗ {code} {name}: {e}")
            summary.append((code, 0, None, str(e)))

    print("\n── 五票交集提示 ──")
    starts = [s[2] for s in summary if s[2]]
    if starts:
        print(f"  五票共同可用起点（取最晚）≈ {max(starts)}")
        print(f"  调参窗前 OOS 建议：--from={max(starts)} --to=2025-02-24")
    print("\n完成。")


if __name__ == "__main__":
    main()
