#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Assert Gen-1 artifacts are unchanged vs sealed checksums.

  python3 scripts/ml/assert-gen1-immutable.py
"""
from __future__ import annotations

import hashlib
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
MODEL_ID = "HVT-A-ET-20260830"
MODEL_DIR = ROOT / "ml" / "models" / MODEL_ID
LOCK = ROOT / "ml" / "manifests" / "GEN1_IMMUTABLE_LOCK.json"
BUNDLE = ROOT / "ml" / "manifests" / "SHADOW_BUNDLE_v1.json"


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def main() -> int:
    model = MODEL_DIR / "model.joblib"
    man = MODEL_DIR / "freeze_manifest.json"
    if not model.exists() or not man.exists():
        print("FAIL: Gen-1 artifacts missing", file=sys.stderr)
        return 2

    current = {
        "model_id": MODEL_ID,
        "model_sha256": sha256(model),
        "freeze_manifest_sha256": sha256(man),
        "bundle_sha256": sha256(BUNDLE) if BUNDLE.exists() else None,
    }

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
    ok = True
    for key in ("model_sha256", "freeze_manifest_sha256"):
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
