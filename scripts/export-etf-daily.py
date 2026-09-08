#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
导出 5 只 ETF 近两年日线 OHLCV（前复权 qfq），输出 CSV。
数据源：东方财富 push2his K 线接口（fqt=1 前复权；与 AKShare fund_etf_hist_em 同源）
用法：python3 scripts/export-etf-daily.py [输出目录]
"""
import os
import sys
import time
import json
import datetime
import urllib.request

# 5 只追踪 ETF（代码, 名称, 腾讯前缀）
ETFS = [
    ("513310", "中韩半导体ETF", "sh"),
    ("515880", "通信ETF", "sh"),
    ("159582", "半导体设备ETF", "sz"),
    ("518880", "黄金ETF", "sh"),
    ("159570", "港股通创新药ETF", "sz"),
]

HEADERS = {"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)"}

def fetch_kline_tencent(code, prefix, start, end, retries=4):
    """腾讯 fqkline 前复权日线，失败自动重试"""
    url = (
        "https://web.ifzq.gtimg.cn/appstock/app/fqkline/get"
        f"?param={prefix}{code},day,{start},{end},800,qfq"
    )
    last_err = None
    for attempt in range(retries):
        try:
            req = urllib.request.Request(url, headers=HEADERS)
            with urllib.request.urlopen(req, timeout=20) as resp:
                data = json.loads(resp.read().decode("utf-8"))
            node = (data.get("data") or {}).get(f"{prefix}{code}") or {}
            rows = node.get("qfqday") or node.get("day") or []
            if rows:
                out = []
                for p in rows:
                    out.append({
                        "date": p[0], "open": p[1], "close": p[2],
                        "high": p[3], "low": p[4], "volume": p[5], "amount": ""
                    })
                return out
            time.sleep(2 * (attempt + 1))
        except Exception as e:
            last_err = e
            time.sleep(2 * (attempt + 1))
    raise last_err if last_err else RuntimeError("未知错误")

def main():
    out_dir = sys.argv[1] if len(sys.argv) > 1 else "deliverables/etf_daily_qfq"
    os.makedirs(out_dir, exist_ok=True)

    today = datetime.date.today()
    start = today - datetime.timedelta(days=730)
    # 腾讯接口日期需 YYYY-MM-DD 格式
    start_str = start.strftime("%Y-%m-%d")
    end_str = today.strftime("%Y-%m-%d")
    print(f"窗口: {start_str} ~ {end_str}（近两年，前复权 qfq）\n")

    summary = []
    for code, name, prefix in ETFS:
        try:
            rows = fetch_kline_tencent(code, prefix, start_str, end_str)
            if not rows:
                print(f"✗ {code} {name}: 空数据")
                summary.append((code, name, 0, "空数据"))
                continue
            out_file = os.path.join(out_dir, f"{code}_{name}_qfq.csv")
            with open(out_file, "w", encoding="utf-8-sig") as f:
                f.write("date,open,close,high,low,volume,amount\n")
                for r in rows:
                    f.write(f"{r['date']},{r['open']},{r['close']},{r['high']},{r['low']},{r['volume']},{r['amount']}\n")
            print(f"✓ {code} {name}: {len(rows)} 根  {rows[0]['date']} ~ {rows[-1]['date']}  → {os.path.basename(out_file)}")
            summary.append((code, name, len(rows), "ok"))
            time.sleep(1.5)
        except Exception as e:
            print(f"✗ {code} {name}: {e}")
            summary.append((code, name, 0, str(e)[:60]))

    print("\n════════ 汇总 ════════")
    total = 0
    for code, name, n, status in summary:
        print(f"  {code} {name}: {n} 根 [{status}]")
        total += n
    print(f"  合计 {total} 根 | 输出目录: {out_dir}")

if __name__ == "__main__":
    main()
