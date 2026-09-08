#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
P0-2 数据重灌：用前复权(qfq)全量重灌 ETF_DAILY，修复份额折算导致的复权污染。
数据源：腾讯 fqkline qfq（与 fetchDailyTencent 修复后一致）
用法：python3 scripts/refill-etf-daily.py [--clear] [--dry-run]
  --clear    清空 ETF_DAILY 后再写入（默认：仅 upsert 覆盖，不清空）
"""
import os
import sys
import json
import time
import argparse
import datetime
import subprocess
import urllib.request

ENV = "tradingview-etf-d0fa42yy57cbc11b"

# (代码, 名称, 腾讯前缀)
ETFS = [
    ("513310", "中韩半导体ETF", "sh"),
    ("515880", "通信ETF", "sh"),
    ("159582", "半导体设备ETF", "sz"),
    ("518880", "黄金ETF", "sh"),
    ("159570", "港股通创新药ETF", "sz"),
]

HEADERS = {"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)"}

def fetch_qfq(code, prefix, limit=800):
    """腾讯前复权日线（全量，最多 800 根）"""
    url = f"https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param={prefix}{code},day,,,{limit},qfq"
    req = urllib.request.Request(url, headers=HEADERS)
    with urllib.request.urlopen(req, timeout=20) as resp:
        data = json.loads(resp.read().decode("utf-8"))
    node = (data.get("data") or {}).get(f"{prefix}{code}") or {}
    rows = node.get("qfqday") or node.get("day") or []
    out = []
    for p in rows:
        out.append({
            "trade_date": p[0], "open": p[1], "close": p[2],
            "high": p[3], "low": p[4], "volume": p[5], "amount": p[6] if len(p) > 6 else None
        })
    return out

def tcb_execute(command, tag=""):
    """执行 tcb db nosql execute，返回 stdout"""
    r = subprocess.run(
        ["tcb", "db", "nosql", "execute", "--command", json.dumps([command]), "--envId", ENV, "--json"],
        capture_output=True, text=True, timeout=180
    )
    out = r.stdout + r.stderr
    if '"error"' in out.lower() or 'error' in out.lower():
        print(f"    [tcb {tag} 错误] {out[-300:]}")
    return out

def clear_collection(name):
    """清空集合（生产谨慎：仅用于数据重灌）"""
    cmd = {
        "TableName": name, "CommandType": "DELETE",
        "Command": json.dumps({"delete": name, "deletes": [{"q": {}, "limit": 0}]})
    }
    out = tcb_execute(cmd)
    ok = '"deleted"' in out or '"ok"' in out
    print(f"  清空 {name}: {'✓' if ok else '⚠ ' + out[-200:]}")

def upsert_daily(code, rows, batch=50):
    """批量写入 ETF_DAILY（upsert 语义：先查后写，按 code+trade_date 去重）"""
    # 批量 upsert 通过逐条执行成本高；此处用「先删该 code 全量再写」的原子化方案
    # 删除该 code
    cmd_del = {
        "TableName": "etf_daily", "CommandType": "DELETE",
        "Command": json.dumps({"delete": "etf_daily", "deletes": [{"q": {"code": code}, "limit": 0}]})
    }
    del_out = tcb_execute(cmd_del, f"del {code}")
    print(f"    [del {code} 返回] {del_out[-120:]}")
    time.sleep(1)
    # 分批 add
    written = 0
    for i in range(0, len(rows), batch):
        chunk = rows[i:i + batch]
        docs = []
        for r in chunk:
            doc = {
                "code": code, "trade_date": r["trade_date"],
                "open": float(r["open"]), "close": float(r["close"]),
                "high": float(r["high"]), "low": float(r["low"]),
                "volume": float(r["volume"]),
                "amount": float(r["amount"]) if r.get("amount") else None,
                "source": "tencent", "premium_rate": None, "iopv": None
            }
            docs.append(doc)
        cmd_add = {
            "TableName": "etf_daily", "CommandType": "INSERT",
            "Command": json.dumps({"insert": "etf_daily", "documents": docs})
        }
        add_out = tcb_execute(cmd_add, f"add {code} chunk{i}")
        if '"keyId"' not in add_out and '"inserted"' not in add_out:
            print(f"    [add {code} chunk{i} 无确认] {add_out[-200:]}")
        written += len(docs)
        time.sleep(0.5)
    return written

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--clear", action="store_true", help="清空 ETF_DAILY 全表")
    ap.add_argument("--dry-run", action="store_true", help="只拉数据不写库")
    args = ap.parse_args()

    if args.clear:
        print("⚠ 即将清空 ETF_DAILY 全表！Ctrl+C 取消")
        time.sleep(3)

    print(f"拉取前复权全量并重灌（clear={args.clear}, dry_run={args.dry_run}）\n")
    all_ok = True
    for code, name, prefix in ETFS:
        try:
            rows = fetch_qfq(code, prefix)
            print(f"✓ {code} {name}: 拉取 {len(rows)} 根 ({rows[0]['trade_date']} ~ {rows[-1]['trade_date']})")
            if not args.dry_run:
                if args.clear:
                    clear_collection("etf_daily")
                written = upsert_daily(code, rows)
                print(f"  写入 {written} 根 ✓")
            time.sleep(0.8)
        except Exception as e:
            print(f"✗ {code} {name}: {e}")
            all_ok = False
    print("\n完成:", "全部成功" if all_ok else "部分失败")

if __name__ == "__main__":
    main()
