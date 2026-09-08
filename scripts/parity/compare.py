"""Gen-2 跨语言 Parity 比较器（Stage D 核心）。

运行 Node 与 Python 两个 runner，对同一 fixture 逐字段比对决策输出。

比对契约：
  - 精确一致（字符串/布尔/整数）：role, proposed_role, defense_state, regime, trend_gate, rank
  - 浮点容差：rank_percentile(1e-9)；leadership_score/alpha_score_v2/trend_score/rs_score(1e-2，Node 输出四舍五入 2dp)；
    target_weight(1e-4，Node 输出四舍五入 4dp)

退出码：0 = 全部一致；1 = 存在不一致。

用法：
  PYTHONPATH=ml python scripts/parity/compare.py [--node <node>] [--python <python>] [--fixture <fixture.json>]
"""
from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]

EXACT_FIELDS = ["role", "proposed_role", "defense_state", "regime", "trend_gate", "rank"]
FLOAT_TOL = {
    "rank_percentile": 1e-9,
    "leadership_score": 1e-2,
    "alpha_score_v2": 1e-2,
    "trend_score": 1e-2,
    "rs_score": 1e-2,
    "target_weight": 1e-4,
}


def run(cmd: list[str], cwd: Path, env: dict) -> str:
    r = subprocess.run(cmd, cwd=str(cwd), env=env, capture_output=True, text=True)
    if r.returncode != 0:
        print(f"  [ERROR] runner 失败: {' '.join(cmd)}\n  stderr: {r.stderr[:800]}", file=sys.stderr)
        sys.exit(2)
    return r.stdout


def compare(node_out: list[dict], py_out: list[dict]) -> list[str]:
    errors: list[str] = []
    nm = {(r["code"], r["trade_date"]): r for r in node_out}
    pm = {(r["code"], r["trade_date"]): r for r in py_out}
    if set(nm) != set(pm):
        errors.append(f"key 集合不一致：only_node={sorted(set(nm) - set(pm))[:5]} only_py={sorted(set(pm) - set(nm))[:5]}")
        return errors

    n = len(nm)
    for k in sorted(nm):
        a, b = nm[k], pm[k]
        for f in EXACT_FIELDS:
            if a[f] != b[f]:
                errors.append(f"{k[1]} {k[0]} {f}: node={a[f]} py={b[f]}")
        for f, tol in FLOAT_TOL.items():
            av, bv = a[f], b[f]
            if av is None or bv is None:
                if av != bv:
                    errors.append(f"{k[1]} {k[0]} {f}: node={av} py={bv}")
                continue
            if abs(av - bv) > tol:
                errors.append(f"{k[1]} {k[0]} {f}: node={av} py={bv} diff={abs(av - bv):.3e}")
        if len(errors) > 40:
            errors.append("...（截断，前 40 条不一致已列）")
            break
    return errors


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--node", default=os.environ.get("TCB_NODE") or "node")
    ap.add_argument("--python", default=os.environ.get("TCB_PYTHON") or sys.executable)
    ap.add_argument("--fixture", default=str(ROOT / "fixtures" / "gen2" / "parity_fixture.json"))
    args = ap.parse_args()

    env = {**os.environ, "PYTHONPATH": str(ROOT / "ml")}
    node_script = str(ROOT / "scripts" / "parity" / "run_node.js")
    py_script = str(ROOT / "scripts" / "parity" / "run_python.py")

    print("  运行 Node runner ...")
    node_raw = run([args.node, node_script, args.fixture], ROOT, env)
    print("  运行 Python runner ...")
    py_raw = run([args.python, py_script, args.fixture], ROOT, env)

    node_out = json.loads(node_raw)
    py_out = json.loads(py_raw)

    print(f"  Node rows={len(node_out)}  Python rows={len(py_out)}")
    errors = compare(node_out, py_out)

    # 场景覆盖自检：确认 fixture 非平凡（多角色、含 RISK_OFF 防守、含 CORE）
    roles = {r["role"] for r in node_out}
    defense_states = {r["defense_state"] for r in node_out}
    cores = [r for r in node_out if r["role"] == "CORE"]
    print(f"  角色分布={sorted(roles)}  防守状态={sorted(defense_states)}  CORE 行数={len(cores)}")

    if errors:
        print(f"\n  [FAIL] Parity 不一致 {len(errors)} 处：")
        for e in errors:
            print(f"    - {e}")
        sys.exit(1)

    print(f"\n  [PASS] Python ↔ Node 决策链逐字段一致（{len(node_out)} 行，role/rank 精确、score/weight 容差内）")


if __name__ == "__main__":
    main()
