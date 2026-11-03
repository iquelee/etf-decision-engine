# -*- coding: utf-8 -*-
"""
§5.8 checkpoint 判别的 **Python ↔ JS 奇偶校验**（V6.0 FREEZE PREPARATION 批次）

目的：证明 **Python 侧判定**（`c1_capture.py`，★ 已为 v6.0 正式版）与
      **JS 侧判据**（`checkpoint_discriminator.js`）对**同一输入**给出**同一裁决**。

方法（⛔ 不做字符串对拍，做**运行时**对拍）：
  1. 直接读 **v6.0 正式文件** `c1_capture.py`（B3 已施加 ⇒ 抽取的就是采集工具将运行的那一份）。
  2. 抽出 `evaluate_checkpoint_v6` / `first_window_wins_checkpoint` 到命名空间执行。
  3. 读 JS 侧夹具 `checkpoint_windows_cases.json`（其 `expect` 由 JS 判别器产出/校验）。
  4. 对每条 case：Python 复合裁决 vs JS `expect`，逐字段比对 `(ok, window_id, reason)`。

⚠️ 已知且**已登记**的 API 切分差异（非语义差异）：
   JS `decideCapture()` 把「窗口命中」与「pinned decision_date 匹配」**合并在一个返回值**里
   （reason = `IN_WINDOW_AND_DATE_MATCH`）；Python `evaluate_checkpoint_v6()` **只判窗口**（reason = `IN_WINDOW`），
   日期匹配由 §5.8 规则 3 在**调用方**承担。本脚本按契约语义把两侧复合成同一 `(ok, window_id, reason)`
   三元组再比对 ⇒ 差异被显式吸收，⛔ 不是掩盖。

用法：python checkpoint_python_js_parity.py
"""
import datetime
import hashlib
import json
import os
import re
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
CARRIER = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
sys.path.insert(0, HERE)

FIX = os.path.join(HERE, "fixtures", "checkpoint_windows_cases.json")
SRC = os.path.join(HERE, "c1_capture.py")           # ★ 现已为 v6.0（B3 已施加）
V5REV = "7d2f39bddd681cce9d714558d518b06631451d01"  # v5.0 冻结封存提交
V5_SHA = "dd2ea8b0090853e36a28e8590fbf62519b2e7461ab7a5160c0e475a9841c8c42"


def _v5_source():
    """自 git 抽取 v5.0 **冻结字节**（⛔ 不用磁盘旧快照，避免陈旧）。"""
    b = subprocess.run(["git", "-C", CARRIER, "show",
                        "%s:scripts/gen1/evidence-capture/c1_capture.py" % V5REV],
                       capture_output=True, check=True).stdout
    assert hashlib.sha256(b).hexdigest() == V5_SHA, "v5.0 基线抽取失败"
    return b.decode("utf-8")

PASS, FAIL = [], []


def ck(name, cond, detail=""):
    (PASS if cond else FAIL).append(name)
    print("   [%s] %s %s" % ("PASS" if cond else "FAIL", name, detail))
    return cond


fx = json.load(open(FIX, encoding="utf-8"))

print("== §5.8 checkpoint Python ↔ JS 奇偶校验（v6.0 冻结态）==")
print("   Python 侧来源 = c1_capture.py（★ 已为 **v6.0 正式版**；B3 已施加）")
print("   JS 侧来源     = checkpoint_discriminator.js + fixtures/checkpoint_windows_cases.json")
print("   rule          = %s" % fx["rule"])
print()

# ---- 1. 构造 Python v6 命名空间（★ 直接读 v6.0 正式文件）--------------
v6src = open(SRC, encoding="utf-8").read()
assert "CHECKPOINT_WINDOWS = [" in v6src, "c1_capture.py 不是 v6.0（B3 未施加？）"
assert "PENDING_AT_V6_FREEZE" not in v6src, "c1_capture.py 仍为迁移方案（占位未填）"
ns = {"CHECKPOINT_WINDOWS": [
    {"id": w["id"], "start": w["start"], "end": w["end"], "day_offset": w["day_offset"]}
    for w in fx["windows"]]}
for name in ("_minute_of_day", "_hhmm_to_min", "evaluate_checkpoint_v6", "first_window_wins_checkpoint"):
    m = re.search(r"^def %s\(.*?(?=^def |\Z)" % re.escape(name), v6src, re.M | re.S)
    assert m, "无法抽取函数 " + name
    exec(compile(m.group(0).rstrip() + "\n", "<v6>", "exec"), ns)

ev6 = ns["evaluate_checkpoint_v6"]
fww = ns["first_window_wins_checkpoint"]


def py_decide(case):
    """Python 侧**复合**裁决：窗口命中（evaluate_checkpoint_v6）+ §5.8 规则 3（日期匹配）。"""
    now = datetime.datetime.strptime(case["capture_local"], "%Y-%m-%dT%H:%M:%S")
    if now.weekday() != case["weekday"]:
        return {"_ERR": "weekday 不一致（夹具自洽性错误）"}
    r = ev6(now)
    if not r["ok"]:
        return {"ok": False, "window_id": None, "reason": r["reason"]}
    if str(case["pinned_decision_date"]) != str(case["target_decision_date"]):
        return {"ok": False, "window_id": None, "reason": "DECISION_DATE_MISMATCH"}
    return {"ok": True, "window_id": r["window_id"], "reason": "IN_WINDOW_AND_DATE_MATCH"}


# ---- 2. capture_cases 对拍 -------------------------------------------
print("-- [1] capture_cases：Python 复合裁决 == JS expect --")
n_ok = 0
for c in fx["capture_cases"]:
    got = py_decide(c)
    exp = c["expect"]
    same = (got.get("ok") == exp["ok"]
            and got.get("window_id") == exp["window_id"]
            and got.get("reason") == exp["reason"])
    n_ok += 1 if same else 0
    print("   [%s] %-24s py=%-46s js=%s"
          % ("PASS" if same else "FAIL", c["id"], json.dumps(got, ensure_ascii=False),
             json.dumps(exp, ensure_ascii=False)))
ck("[1] %d 条 capture_case 全部奇偶一致" % len(fx["capture_cases"]),
   n_ok == len(fx["capture_cases"]), "%d/%d" % (n_ok, len(fx["capture_cases"])))

# ---- 3. first_window_wins_cases 对拍 ---------------------------------
print("\n-- [2] first_window_wins_cases：Python 会话序 == JS expect --")
n_ok2 = 0
for c in fx["first_window_wins_cases"]:
    sess = []
    for s in c["sessions"]:
        sess.append({
            "now": datetime.datetime.strptime(s["capture_local"], "%Y-%m-%dT%H:%M:%S"),
            "pinned_decision_date": s["pinned_decision_date"],
            "target_decision_date": s["target_decision_date"],
        })
    r = fww(sess)
    got_winner = None if r["winner_index"] is None else c["sessions"][r["winner_index"]]["capture_local"]
    same = (got_winner == c["expect"]["winner"]
            and r["window_id"] == c["expect"]["window_id"]
            and r["bundles"] == c["expect"]["bundles_produced"])
    n_ok2 += 1 if same else 0
    print("   [%s] %-30s py={winner:%s,window:%s,bundles:%s} js=%s"
          % ("PASS" if same else "FAIL", c["id"], got_winner, r["window_id"], r["bundles"],
             json.dumps(c["expect"], ensure_ascii=False)))
ck("[2] %d 条 first-window-wins case 全部奇偶一致" % len(fx["first_window_wins_cases"]),
   n_ok2 == len(fx["first_window_wins_cases"]),
   "%d/%d" % (n_ok2, len(fx["first_window_wins_cases"])))

# ---- 4. 边界矩阵（Python 侧独立复算，覆盖 [start, end) 半开区间）------
print("\n-- [3] 边界矩阵：Python 侧独立复算（半开区间 [start, end)）--")
MATRIX = [
    ("2026-10-01T22:29:00", "2026-10-01", "2026-10-01", (False, None)),
    ("2026-10-01T22:30:00", "2026-10-01", "2026-10-01", (True, "W1")),
    ("2026-10-01T23:29:00", "2026-10-01", "2026-10-01", (True, "W1")),
    ("2026-10-01T23:30:00", "2026-10-01", "2026-10-01", (False, None)),
    ("2026-10-02T08:29:00", "2026-10-01", "2026-10-01", (False, None)),
    ("2026-10-02T08:30:00", "2026-10-01", "2026-10-01", (True, "W2")),
    ("2026-10-02T09:29:00", "2026-10-01", "2026-10-01", (True, "W2")),
    ("2026-10-02T09:30:00", "2026-10-01", "2026-10-01", (False, None)),
    ("2026-10-03T22:35:00", "2026-10-02", "2026-10-02", (False, None)),   # 周六
    ("2026-10-04T08:45:00", "2026-10-02", "2026-10-02", (False, None)),   # 周日
]
bad = []
for ts, pdd, tdd, exp in MATRIX:
    now = datetime.datetime.strptime(ts, "%Y-%m-%dT%H:%M:%S")
    r = ev6(now)
    got = (r["ok"], r["window_id"])
    if r["ok"] and str(pdd) != str(tdd):
        got = (False, None)          # §5.8 规则 3：日期不匹配 ⇒ 本窗口不产出
    if got != exp:
        bad.append((ts, exp, got))
    print("   [%s] %s wd=%d  expect=%s got=%s"
          % ("PASS" if got == exp else "FAIL", ts, now.weekday(), exp, got))
ck("[3] 边界矩阵 10 项全部符合 (ok, window_id) 预期", not bad, "不符=%s" % bad)

# ---- 5. 反向证明：v5.0 单窗口语义在 W2 上必然 FAIL -------------------
print("\n-- [4] 反向证明：v5.0 单窗口语义在 W2 上必然丢样（v5 源自 git 冻结提交抽取）--")
m5 = re.search(r"^def evaluate_checkpoint\(now\):\n(?:.*\n)*?        \(now\.hour == 22 and now\.minute >= 30\) or "
               r"\(now\.hour == 23 and now\.minute < 30\)\)\n", _v5_source(), re.M)
ns5 = {}
exec(compile(m5.group(0), "<v5>", "exec"), ns5)
t_w2 = datetime.datetime(2026, 10, 2, 8, 45)
t_w1 = datetime.datetime(2026, 10, 1, 22, 45)
ck("[4] v5.0 在 W2（2026-10-02 08:45）判 False（⇒ 单窗口语义必然丢样）", ns5["evaluate_checkpoint"](t_w2) is False,
   "v5(W2)=%s" % ns5["evaluate_checkpoint"](t_w2))
ck("[4] v6.0 在 W2（2026-10-02 08:45）判 ok/W2",
   ev6(t_w2) == {"ok": True, "window_id": "W2", "reason": "IN_WINDOW"}, str(ev6(t_w2)))
ck("[4] 两侧在 W1（2026-10-01 22:45）一致判命中",
   ns5["evaluate_checkpoint"](t_w1) is True and ev6(t_w1)["window_id"] == "W1")

print("\n======================================================")
print("Python ↔ JS 奇偶校验：%s（%d PASS / %d FAIL）"
      % ("✅ ALL PASS" if not FAIL else "❌ 存在 FAIL", len(PASS), len(FAIL)))
for f in FAIL:
    print("   FAIL: %s" % f)
print("======================================================")
sys.exit(0 if not FAIL else 1)
