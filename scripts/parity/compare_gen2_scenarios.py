"""WP-G2-01 —— Gen-2 场景双端比对器 + 待裁决差异清单。

职责：
  1. 读 fixtures/gen2/golden_scenarios_v1.json（三层结构）与双端 runner 输出；
  2. 先校验「已确认业务不变量」（不变量失败 = 红，直接 exit 1）；
  3. 逐字段比对双端输出，并对差异分类：
       ALIGNED / EXPLAINED / PENDING_RULING / EXCLUDED_BY_DESIGN
     任何未被 known_differences 登记的差异 → UNLOCATED（exit 1）；
  4. 输出报告 outputs/gen2-wp-g2-01/diff-report.{md,json}。

门禁：0 个未记录、未定位的差异。允许已登记并定位的 EXPLAINED / PENDING_RULING。
本脚本**不改规则、不写库、不部署**。

用法：
    python scripts/parity/compare_gen2_scenarios.py \
        --fixture fixtures/gen2/golden_scenarios_v1.json \
        --js outputs/gen2-wp-g2-01/js-observations.json \
        --py outputs/gen2-wp-g2-01/py-observations.json \
        --out-dir outputs/gen2-wp-g2-01
"""
from __future__ import annotations

import argparse
import fnmatch
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]

UNLOCATED = "UNLOCATED"


def get_path(obj, dotted: str):
    cur = obj
    for part in dotted.split("."):
        if isinstance(cur, dict) and part in cur:
            cur = cur[part]
        else:
            return None
    return cur


def flat(obj, prefix: str = "") -> dict:
    out: dict = {}
    for k, v in obj.items():
        key = f"{prefix}.{k}" if prefix else k
        if isinstance(v, dict):
            out.update(flat(v, key))
        else:
            out[key] = v
    return out


def evaluate_invariants(fixture: dict, js: dict, py: dict) -> list:
    results = []
    for sc in fixture["scenarios"]:
        for inv in sc.get("invariants", []):
            for side in (("js", js), ("python", py)):
                name, obs = side
                if inv["applies_to"] not in ("both", name):
                    continue
                node = obs["scenarios"].get(sc["id"])
                if node is None:  # 该场景未运行（PENDING_SEAM 等）
                    continue
                case = node.get(inv["case"], {}) if inv.get("case") else node
                actual = get_path(case, inv["field"])
                op, val = inv["op"], inv.get("value")
                if op == "eq":
                    ok = actual == val
                elif op == "ne":
                    ok = actual != val
                elif op == "gte":
                    ok = isinstance(actual, (int, float)) and actual >= val
                elif op == "lte":
                    ok = isinstance(actual, (int, float)) and actual <= val
                elif op == "is_true":
                    ok = actual is True
                elif op == "is_false":
                    ok = actual is False
                elif op == "is_null":
                    ok = actual is None
                elif op == "not_null":
                    ok = actual is not None
                elif op == "contains":
                    ok = isinstance(actual, str) and str(val) in actual
                else:
                    raise SystemExit(f"unknown op {op}")
                results.append(
                    {
                        "invariant": inv["id"],
                        "scenario": sc["id"],
                        "case": inv.get("case"),
                        "field": inv["field"],
                        "op": op,
                        "expected": val,
                        "engine": name,
                        "actual": actual,
                        "passed": bool(ok),
                    }
                )
    return results


def classify(diff: dict, registry: list) -> dict:
    """按 known_differences 判定差异是否已登记（字段用 fnmatch 通配）；未登记 → UNLOCATED。"""
    for entry in registry:
        if entry["scenario"] != diff["scenario"]:
            continue
        if entry.get("case") and entry["case"] != diff["case"]:
            continue
        patterns = entry.get("fields") or ([entry["field"]] if entry.get("field") else ["*"])
        target = diff.get("field_in_case") or diff["field"]
        if not any(fnmatch.fnmatch(target, p) for p in patterns):
            continue
        return {
            "status": entry["status"],
            "difference_id": entry["id"],
            "location": entry.get("location"),
            "reason": entry.get("reason"),
        }
    return {"status": UNLOCATED, "difference_id": None, "location": None, "reason": None}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--fixture", default=str(ROOT / "fixtures" / "gen2" / "golden_scenarios_v1.json"))
    ap.add_argument("--js", default=str(ROOT / "outputs" / "gen2-wp-g2-01" / "js-observations.json"))
    ap.add_argument("--py", default=str(ROOT / "outputs" / "gen2-wp-g2-01" / "py-observations.json"))
    ap.add_argument("--out-dir", default=str(ROOT / "outputs" / "gen2-wp-g2-01"))
    args = ap.parse_args()

    fixture = json.loads(Path(args.fixture).read_text(encoding="utf-8"))
    js = json.loads(Path(args.js).read_text(encoding="utf-8"))
    py = json.loads(Path(args.py).read_text(encoding="utf-8"))

    inv_results = evaluate_invariants(fixture, js, py)
    inv_failed = [r for r in inv_results if not r["passed"]]

    diffs = []
    scenario_status = {}
    for sc in fixture["scenarios"]:
        sid = sc["id"]
        if sid not in js["scenarios"] and sid not in py["scenarios"]:
            scenario_status[sid] = "PENDING_SEAM(未运行)"
            continue
        a, b = flat(js["scenarios"].get(sid, {})), flat(py["scenarios"].get(sid, {}))
        keys = sorted(set(a) | set(b))
        sc_diffs = []
        for k in keys:
            if a.get(k, "__MISSING__") == b.get(k, "__MISSING__"):
                continue
            parts = k.split(".")
            case = parts[0] if len(parts) > 1 else None
            diff = {
                "scenario": sid,
                "case": case,
                "field": k,
                "field_in_case": ".".join(parts[1:]) if case else k,
                "js": a.get(k),
                "python": b.get(k),
            }
            diff.update(classify(diff, fixture.get("known_differences", [])))
            sc_diffs.append(diff)
        diffs.extend(sc_diffs)
        classified = {d["status"] for d in sc_diffs}
        scenario_status[sid] = "ALIGNED" if not sc_diffs else "|".join(sorted(classified))

    unlocated = [d for d in diffs if d["status"] == UNLOCATED]
    pending_ruling = [d for d in diffs if d["status"] == "PENDING_RULING"]
    explained = [d for d in diffs if d["status"] == "EXPLAINED"]
    gate_ok = not inv_failed and not unlocated

    report = {
        "work_package": "WP-G2-01",
        "fixture": Path(args.fixture).name,
        "js_source": js.get("source"),
        "py_source": py.get("source"),
        "gate": "0 个未记录、未定位的差异",
        "gate_ok": gate_ok,
        "summary": {
            "scenarios_total": len(fixture["scenarios"]),
            "scenarios_run": len([s for s, v in scenario_status.items() if "PENDING_SEAM" not in v]),
            "invariants_checked": len(inv_results),
            "invariants_failed": len(inv_failed),
            "differences_total": len(diffs),
            "differences_unlocated": len(unlocated),
            "differences_pending_ruling": len(pending_ruling),
            "differences_explained": len(explained),
        },
        "scenario_status": scenario_status,
        "invariants_failed": inv_failed,
        "differences": diffs,
        "pending_scenarios": js.get("pending", []),
    }

    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / "diff-report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")

    lines = [
        "# WP-G2-01 Gen-2 场景双端比对报告",
        "",
        f"- 夹具：`{report['fixture']}`",
        f"- 双端：JS `{report['js_source']}` / Python `{report['py_source']}`",
        f"- **门禁**：{report['gate']} → {'✅ PASS' if gate_ok else '❌ FAIL'}",
        "",
        "## 汇总",
        "",
        "| 指标 | 值 |",
        "|---|---|",
    ]
    for k, v in report["summary"].items():
        lines.append(f"| {k} | {v} |")
    lines += ["", "## 场景状态", "", "| 场景 | 状态 |", "|---|---|"]
    for sid, st in scenario_status.items():
        lines.append(f"| {sid} | {st} |")

    lines += ["", "## 差异汇总（按登记项聚合；全量逐条见 diff-report.json）", "",
              "| 登记项 | 分类 | 场景 | case | 字段数 | 示例 |", "|---|---|---|---|---|---|"]
    groups = {}
    for d in diffs:
        key = (d.get("difference_id") or "UNLOCATED", d["status"], d["scenario"], d.get("case"))
        groups.setdefault(key, []).append(d)
    if not diffs:
        lines.append("| — | — | — | — | 0 | 无差异 |")
    for (did, status, sc_id, case), items in groups.items():
        ex = items[0]
        example = f"`{ex['field']}` js={ex['js']!r} / py={ex['python']!r}"
        lines.append(f"| {did} | {status} | {sc_id} | {case} | {len(items)} | {example} |")

    if inv_failed:
        lines += ["", "## ❌ 不变量失败", ""]
        for r in inv_failed:
            lines.append(f"- `{r['invariant']}` {r['scenario']}/{r['case']} `{r['field']}` {r['op']} {r['expected']} → 实际 `{r['actual']}`（{r['engine']}）")

    if report["pending_scenarios"]:
        lines += ["", "## 待解决 seam（本包不运行，已登记归属）", ""]
        for p in report["pending_scenarios"]:
            lines.append(f"- `{p['id']}` → `{p.get('deferred_to')}`：{p.get('reason')}")

    lines += ["", "## 备查：已登记差异（known_differences）", ""]
    for e in fixture.get("known_differences", []):
        fields = e.get("fields") or [e.get("field")]
        lines.append(
            f"- **{e['id']}** [{e['status']}] `{e['scenario']}/{e.get('case')}` "
            f"字段 `{', '.join(str(f) for f in fields)}`：{e['reason']}"
        )
        lines.append(f"  - 定位：`{e.get('location')}`")

    (out_dir / "diff-report.md").write_text("\n".join(lines) + "\n", encoding="utf-8")

    print(f"[compare] invariants {len(inv_results) - len(inv_failed)}/{len(inv_results)} passed")
    print(f"[compare] differences total={len(diffs)} unlocated={len(unlocated)} pending_ruling={len(pending_ruling)} explained={len(explained)}")
    print(f"[compare] gate: {'PASS' if gate_ok else 'FAIL'} ({report['gate']})")
    print(f"[compare] report → {out_dir / 'diff-report.md'}")
    return 0 if gate_ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
