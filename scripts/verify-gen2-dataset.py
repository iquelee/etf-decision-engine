#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Gen-2 研究日线数据集清单：生成 + 校验（P0-D，OOS 可核验复现锚）。

问题：31 个规范化日线 csv 在 monorepo `deliverables/etf_daily_ml_pool/`，但该目录被
.gitignore 排除 → 线上仓库无法独立复现资格报告的 OOS。本脚本把「数据身份」
（code/filename/first_date/last_date/rows/sha256）固化成 manifest 入库：
任何 OOS 结论都可核验「用的确实是 manifest 对应的那套数据」。

用法：
  重新生成（数据更新后）：python scripts/verify-gen2-dataset.py --gen
  校验（默认）：python scripts/verify-gen2-dataset.py [--require]
    --require：数据缺失按 FAIL（CI/纯净 clone 上期望缺数据属正常，本地恢复 deliverables/ 后再验）
"""
from __future__ import annotations

import csv
import hashlib
import json
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
POOL = REPO / "deliverables" / "etf_daily_ml_pool"
MANIFEST = REPO / "ml" / "gen2" / "data" / "DATASET_MANIFEST_V1.json"
UNIVERSE = REPO / "ml" / "gen2" / "universe" / "universe_v1.json"


def file_meta(path: Path) -> dict:
    raw = path.read_bytes()
    sha = hashlib.sha256(raw).hexdigest()
    rows = 0
    first = last = None
    with path.open("r", encoding="utf-8-sig", newline="") as f:
        for r in csv.DictReader(f):
            d = (r.get("date") or "").strip()
            if not d:
                continue
            rows += 1
            if first is None:
                first = d
            last = d
    return {"filename": path.name, "first_date": first, "last_date": last, "rows": rows, "sha256": sha}


def required_codes() -> list[str]:
    u = json.loads(UNIVERSE.read_text(encoding="utf-8"))
    codes = [str(c).zfill(6) for c in u.get("eligible_codes", [])]
    bench = str(u.get("benchmark_code", "510300")).zfill(6)
    return sorted(set(codes) | {bench})


def build_manifest() -> dict:
    files = {}
    for code in required_codes():
        matches = sorted(POOL.glob(f"{code}_*.csv"))
        if not matches:
            raise FileNotFoundError(f"缺 {code} 日线：{POOL}")
        files[code] = file_meta(matches[0])
    return {
        "manifest_id": "DATASET_MANIFEST_V1",
        "generated_at": "2026-09-08",
        "pool_dir": str(POOL.relative_to(REPO)),
        "universe_file": str(UNIVERSE.relative_to(REPO)),
        "source": "local_csv_qfq",
        "adjustment": "qfq",
        "note": "数据文件不入 git（.gitignore deliverables/）；清单+本脚本保证某次 OOS 用的数据可核验",
        "files": files,
    }


def main() -> int:
    if "--gen" in sys.argv:
        m = build_manifest()
        MANIFEST.write_text(json.dumps(m, ensure_ascii=False, indent=2), encoding="utf-8")
        print(f"[OK] 已写 {MANIFEST.relative_to(REPO)}（{len(m['files'])} 文件）")
        return 0

    require = "--require" in sys.argv
    if not MANIFEST.exists():
        print("[FAIL] 缺 manifest，先跑 python scripts/verify-gen2-dataset.py --gen")
        return 1
    m = json.loads(MANIFEST.read_text(encoding="utf-8"))
    failed = 0
    missing = []
    for code, exp in m["files"].items():
        matches = sorted(POOL.glob(f"{code}_*.csv")) if POOL.exists() else []
        if not matches:
            missing.append(code)
            continue
        act = file_meta(matches[0])
        if act != exp:
            failed += 1
            print(f"[FAIL] {code}: 实际 {act} != manifest {exp}")
        else:
            print(f"[PASS] {code}: {act['rows']} 行 {act['first_date']}→{act['last_date']} sha={act['sha256'][:12]}…")
    if missing:
        print(f"[缺数据] {len(missing)} 个代码无文件（clone 仓库本就不含数据，本地恢复 deliverables/ 后再验）：{','.join(missing)}")
        if require:
            failed += len(missing)
    total = len(m["files"])
    print(f"\n=== Dataset：{total - failed - len(missing)}/{total} 与 manifest 一致" + (f"，缺数据 {len(missing)}" if missing else "") + " ===")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
