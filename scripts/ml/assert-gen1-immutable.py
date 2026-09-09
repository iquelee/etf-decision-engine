#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Assert Gen-1 artifacts are unchanged vs sealed checksums.

检查目标：Node 推理侧 frozen artifacts（cloudfunctions/runGen1ShadowEod/），
这是仓库里实际入库、线上真实加载的 Gen-1 产物。
（训练侧 ml/models/<id>/model.joblib 未入库，不在此检查范围内。）

  python3 scripts/ml/assert-gen1-immutable.py
"""
from __future__ import annotations

import hashlib
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
MODEL_ID = "HVT-A-ET-20260830"
MODEL_DIR = ROOT / "cloudfunctions" / "runGen1ShadowEod"
LOCK = ROOT / "ml" / "manifests" / "GEN1_IMMUTABLE_LOCK.json"


def sha256(path: Path) -> str:
    """冻结内容 sha256（P0-A 修正 2026-09-09）：先做 \r\n→\n 归一化，
    使 lock 基准与平台行尾无关（Windows worktree=CRLF / Linux CI=LF）。"""
    raw = path.read_bytes().replace(b"\r\n", b"\n")
    return hashlib.sha256(raw).hexdigest()


def main() -> int:
    artifacts = {
        "model_sha256": MODEL_DIR / "frozen-model.json",
        "freeze_manifest_sha256": MODEL_DIR / "frozen-manifest.json",
        "inference_sha256": MODEL_DIR / "frozen-node-inference.js",
    }
    missing = [name for name, p in artifacts.items() if not p.exists()]
    if missing:
        print(f"FAIL: Gen-1 artifacts missing: {missing}", file=sys.stderr)
        return 2

    current = {"model_id": MODEL_ID}
    for name, p in artifacts.items():
        current[name] = sha256(p)

    if not LOCK.exists():
        payload = {
            **current,
            "sealed_at": "2026-08-30",
            "rule": "Gen-2 must not modify these hashes. Challenge via new model_id only.",
        }
        LOCK.write_text(json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8")
        print("SEED lock:", json.dumps(payload, indent=2, ensure_ascii=False))
        return 0

    lock = json.loads(LOCK.read_text(encoding="utf-8"))
    # 兼容旧 LOCK（训练侧 ml/models 产物）→ 键集合不匹配时按需重 SEED
    if not all(k in lock for k in artifacts):
        payload = {
            **current,
            "sealed_at": "2026-08-30",
            "rule": "Gen-2 must not modify these hashes. Challenge via new model_id only.",
        }
        LOCK.write_text(json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8")
        print("RESEED lock (Node-side frozen artifacts):", json.dumps(payload, indent=2, ensure_ascii=False))
        return 0

    ok = True
    for key in artifacts:
        if lock.get(key) != current.get(key):
            print(f"FAIL: {key} drift\n  lock={lock.get(key)}\n  now ={current.get(key)}", file=sys.stderr)
            ok = False
    if ok:
        print("PASS: Gen-1 immutable (", MODEL_ID, ")")
        return 0
    print("Gen-2 / edits must NOT touch Gen-1. Create a new model_id instead.", file=sys.stderr)
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
