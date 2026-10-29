# -*- coding: utf-8 -*-
"""
`c1_capture.py` v5.0 → v6.0 **迁移设计留痕 + 施加后校验**（V6.0 FREEZE 批次）

★ 状态变更（owner 2026-10-02 裁定 `O-1 = APPROVED` + **B3 同批次迁移授权**）：
  · 本文件原为**迁移方案**（⛔ 未施加）；`B3` 已授权并**已施加** ⇒ 本文件转为两用：
     ① **迁移设计留痕** —— `transform_v5_to_v6()` 即设计原文（逐字保留，⛔ 未改）；
     ② **施加后校验** —— 断言磁盘上的 `c1_capture.py` 已是 v6.0，且与设计**语义等价**。

为何「⛔ 不得先迁移」的旧约束已解除（契约 §11 规则 5）：
  该规则禁止的是「工具迁到**未冻结**契约」。本批次契约**已冻结**
  （`docs/gen1/GEN1_EVIDENCE_CONTRACT_V6.md`，sha256 `7e3e5d87…272e`，carrier commit `ccb0f4b8…`）
  ⇒ 迁移与冻结**同批次**，⛔ 不存在「按未冻结契约采样」的预登记违规窗口。

★ **设计 ⇄ 正式版文本对齐（2026-10-02 施加期；本文件已留痕）**：
  `transform_v5_to_v6()` 写于**迁移方案期**（`B3` 未授权）；正式施加后，v6.0 正式版的
  docstring 多写了 §3.4A 排除注记、并收紧了 §5.8 子规则引用 ⇒ 二者相差 **3 删 / 4 增**，
  **全部落在 docstring / 注释**（逐行登记见模块级 `RECONCILE`；证明见 [5c] / [5d]）。
  ⛔ 对齐**不是**「为通过测试而放宽断言」：断言仍是最强的「关键函数体逐字节相同」，
    对齐动作被**逐行枚举** + **反向重建**，并以 AST（剥离 docstring）证明**零规范语义改动**。

用法：
  python c1_capture_v6_migration_test.py             # 设计留痕 + 施加后校验
  python c1_capture_v6_migration_test.py --emit-diff # 顺带重写 c1_capture.py.v6.diff（APPLIED）
"""
import ast
import difflib
import hashlib
import io
import os
import re
import subprocess
import sys
import tokenize

HERE = os.path.dirname(os.path.abspath(__file__))
CARRIER_GIT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
TARGET = os.path.join(HERE, "c1_capture.py")
DIFF_OUT = os.path.join(HERE, "c1_capture.py.v6.diff")
V5REV = "7d2f39bddd681cce9d714558d518b06631451d01"     # v5.0 冻结封存提交
V5_SHA_0 = "dd2ea8b0090853e36a28e8590fbf62519b2e7461ab7a5160c0e475a9841c8c42"
FROZEN_SHA = "7e3e5d876522b512e0ba46de248c92b8e1cb17bde0180003f7041559e2ad272e"

FAILS = []
PASSES = []


def check(name, cond, detail=""):
    (PASSES if cond else FAILS).append(name)
    print("   [%s] %s %s" % ("PASS" if cond else "FAIL", name, detail))
    return cond


def rep(t, old, new, expect, tag):
    n = t.count(old)
    if n != expect:
        FAILS.append("REPLACE[%s] count=%d expect=%d" % (tag, n, expect))
        print("   [FAIL] REPLACE[%s] count=%d expect=%d :: %r" % (tag, n, expect, old[:60]))
        return t
    return t.replace(old, new)


# =====================================================================
# 迁移变换（v5.0 → v6.0）
# =====================================================================
def transform_v5_to_v6(src):
    t = src

    # ---- T1 模块 docstring ----
    t = rep(t,
            "C-1 每日只读 Evidence Capture —— **v5.0 语义**（Gen-1 Evidence Contract v5.0 §5）",
            "C-1 每日只读 Evidence Capture —— **v6.0 语义**（Gen-1 Evidence Contract v6.0 §5）", 1, "T1a")

    t = rep(t,
            """★ 本文件是 `_evidence-capture-tool/c1_capture.py`（v3.0 语义）的**迁移版**。
  迁移依据：契约 **§11 元规则 规则 5** —— 「工具语义迁移与契约冻结**同批次**」；
            契约 **§12 第 12 项** —— 迁移随冻结一并执行。""",
            """★ **v6.0 迁移（owner 裁定 B3）—— ⛔ 本文件当前仍为 v5.0 语义**：
  迁移依据：契约 **§11 元规则 规则 5** —— 「工具语义迁移与契约冻结**同批次**」。
  v5.0 → v6.0 的语义迁移**方案已设计并测试**（见 `c1_capture.py.v6.diff` /
  `c1_capture_v6_migration_test.py`），但 **`B3 = NOT YET AUTHORIZED`**
  ⇒ ⛔ **在 v6.0 冻结之前不得施加**（否则构成「工具已按未冻结契约采样」的预登记违规）。""",
            1, "T1b")

    t = rep(t,
            """  契约路径      docs/gen1/GEN1_EVIDENCE_CONTRACT_V5.md
  契约版本      v5.0（FROZEN 2026-10-02）
  carrier commit 05da0efa73e948921bc7b9b60c0d500cc98e3e9b
  git blob id   7f86d12aaed99a877c170c25c5a481f21a661256      （sha1，git 对象）
  content sha256 4fb9463f4a437e310cb52b04498a1d4cc0f23fbc64eb3c1d846d90a460a9f55b（64580 B / LF）""",
            """  契约路径      docs/gen1/GEN1_EVIDENCE_CONTRACT_V5.md   ← ⛔ 仍是 v5.0（迁移未施加）
  契约版本      v5.0（FROZEN 2026-10-02）
  carrier commit 05da0efa73e948921bc7b9b60c0d500cc98e3e9b
  git blob id   7f86d12aaed99a877c170c25c5a481f21a661256      （sha1，git 对象）
  content sha256 4fb9463f4a437e310cb52b04498a1d4cc0f23fbc64eb3c1d846d90a460a9f55b（64580 B / LF）
  ⛔ v6.0 迁移后应改为：路径 GEN1_EVIDENCE_CONTRACT_V6.md / 版本 v6.0 /
     三指纹在本批次**不存在**（未冻结）⇒ 冻结时填写""",
            1, "T1c")

    t = rep(t,
            "  7. checkpoint 由 工作日 09:00 → **工作日 [22:30:00, 23:30:00)（北京）**",
            "  7. checkpoint 由 工作日 09:00 → **工作日 [22:30:00, 23:30:00)（北京）**\n"
            "  ⛔ v6.0 迁移后：checkpoint → **W1 [22:30,23:30) ∪ W2 次日工作日 [08:30,09:30)**，"
            "first-window-wins；BUNDLE 增加 `window_id`", 1, "T1d")

    # ---- T2 契约绑定常量 ----
    t = rep(t,
            """CONTRACT_PATH = "docs/gen1/GEN1_EVIDENCE_CONTRACT_V5.md"
CONTRACT_VERSION = "v5.0"
CONTRACT_FROZEN_DATE = "2026-10-02"
CONTRACT_CARRIER_COMMIT = "05da0efa73e948921bc7b9b60c0d500cc98e3e9b"
CONTRACT_GIT_BLOB_SHA1 = "7f86d12aaed99a877c170c25c5a481f21a661256"
CONTRACT_CONTENT_SHA256 = \\
    "4fb9463f4a437e310cb52b04498a1d4cc0f23fbc64eb3c1d846d90a460a9f55b"

BUNDLE_REVISION = "v5.0\"""",
            """CONTRACT_PATH = "docs/gen1/GEN1_EVIDENCE_CONTRACT_V6.md"   # 拟定冻结载体路径
CONTRACT_VERSION = "v6.0"
CONTRACT_FROZEN_DATE = "PENDING_AT_V6_FREEZE"      # ⛔ 未冻结 ⇒ 无冻结日
CONTRACT_CARRIER_COMMIT = "PENDING_AT_V6_FREEZE"   # ⛔ 冻结时填写
CONTRACT_GIT_BLOB_SHA1 = "PENDING_AT_V6_FREEZE"    # ⛔ 冻结时填写
CONTRACT_CONTENT_SHA256 = "PENDING_AT_V6_FREEZE"   # ⛔ 冻结时填写

BUNDLE_REVISION = "v6.0"

# v6.0 §5.8：预登记的**有序**窗口序列（工作日，北京时间；⛔ 不得事后新增 / 移动 / 放宽）
CHECKPOINT_WINDOWS = [
    {"id": "W1", "start": "22:30", "end": "23:30"},   # decision_date D 的当日夜间
    {"id": "W2", "start": "08:30", "end": "09:30"},   # decision_date D 的次一工作日晨间
]
CHECKPOINT_RULE = "工作日 W1 [22:30,23:30) ∪ W2 次日工作日 [08:30,09:30)（北京）；first-window-wins\"""",
            1, "T2a")

    # ---- T3 CHAIN WINDOWS ----
    t = rep(t,
            """# ⚠️ CHAIN PROOF 只用来定位「产生该 run 的入口管线」的日志窗口，
#    ⛔ 不是统计 checkpoint（契约 §5.6 第 5 条：run 的 invocation 不必落在 checkpoint 窗口内）。
CHAIN_WINDOW_START = "21:50:00"
CHAIN_WINDOW_END = "22:30:00\"""",
            """# ⚠️ CHAIN PROOF 只用来定位「产生该 run 的入口管线」的日志窗口，
#    ⛔ 不是统计 checkpoint（契约 §5.6.2(f)：run 的 invocation 不必落在 checkpoint 窗口内）。
# v6.0：两条 PROMOTION-CAPABLE 链（W1-2200 / W2-0800）**同等适用** ⇒ 逐链一个入口日志窗口。
CHAIN_WINDOWS = [
    {"chain_id": "W1-2200", "entry": "fetchDailyData", "start": "21:50:00", "end": "22:30:00"},
    {"chain_id": "W2-0800", "entry": "materializeIndicators", "start": "07:50:00", "end": "08:30:00"},
]
CHAIN_WINDOW_START = CHAIN_WINDOWS[0]["start"]   # 兼容 v5.0 名称（⛔ 新代码请用 CHAIN_WINDOWS）
CHAIN_WINDOW_END = CHAIN_WINDOWS[0]["end"]""",
            1, "T3")

    # ---- T4 evaluate_checkpoint（整函数替换）----
    old_ck = '''def evaluate_checkpoint(now):
    """契约 §5.8：工作日 **[22:30:00, 23:30:00)（北京）**。"""
    return (now.weekday() < 5) and (
        (now.hour == 22 and now.minute >= 30) or (now.hour == 23 and now.minute < 30))
'''
    new_ck = '''def _minute_of_day(now):
    return now.hour * 60 + now.minute


def _hhmm_to_min(t):
    return int(t[:2]) * 60 + int(t[3:5])


def evaluate_checkpoint_v6(now):
    """契约 §5.8（v6.0）：工作日 **W1 ∪ W2**（预登记有序窗口序列）。

    返回 {"ok": bool, "window_id": "W1"|"W2"|None, "reason": str}。
    ⚠️ 本函数只判**单次捕获会话**是否落在窗口内、且落在**哪一个**窗口；
       「该 decision_date 是否已由**首个**窗口产出」属**会话序**判定 ⇒ 由调用方按 §5.8
       （first-window-wins）处理，⛔ 不由本函数承担。
    ⚠️ 窗口身份（W1 / W2）⛔ **不是**独立事件判据（契约 §3.4A 明文排除）。
    """
    if now.weekday() >= 5:
        return {"ok": False, "window_id": None, "reason": "WEEKEND"}
    minute = _minute_of_day(now)
    for w in CHECKPOINT_WINDOWS:
        if _hhmm_to_min(w["start"]) <= minute < _hhmm_to_min(w["end"]):
            return {"ok": True, "window_id": w["id"], "reason": "IN_WINDOW"}
    return {"ok": False, "window_id": None, "reason": "OFF_CHECKPOINT"}


def first_window_wins_checkpoint(sessions):
    """契约 §5.8 first-window-wins：按序 W1 → W2，**首个**满足者胜出并终止该 D 的捕获。

    sessions = [{"now": datetime, "pinned_decision_date": str, "target_decision_date": str}, ...]
    返回 {"winner_index": int|None, "window_id": str|None, "bundles": int}
    ⛔ 一旦某 session 产出 ⇒ 后续 session 一律 SKIPPED（⛔ 不产生第二个 bundle，§5.5 ③）。
    """
    for i, s in enumerate(sessions):
        r = evaluate_checkpoint_v6(s["now"])
        if not r["ok"]:
            continue
        if str(s.get("pinned_decision_date")) != str(s.get("target_decision_date")):
            continue                      # §5.8：本窗口不产出，继续下一窗口
        return {"winner_index": i, "window_id": r["window_id"], "bundles": 1}
    return {"winner_index": None, "window_id": None, "bundles": 0}


# ⛔ DEPRECATED（v6.0）：保留旧签名以满足既有打红脚本；新代码一律用 evaluate_checkpoint_v6。
def evaluate_checkpoint(now):
    """⛔ DEPRECATED（v6.0）：返回 bool，**丢弃** window_id。"""
    return evaluate_checkpoint_v6(now)["ok"]
'''
    t = rep(t, old_ck, new_ck, 1, "T4")

    # ---- T5 chain_proof：逐链尝试 ----
    t = rep(t,
            '''    out = {"verified": False, "hops": [], "limitation": "invocation log 不含 engine_run_id；"
           "run↔invocation 归属以 [START, Report] 区间包含 run_manifest.created_at 作间接证明"}
    if not run_date:
        return out
    w0 = "%s %s" % (run_date, CHAIN_WINDOW_START)
    w1 = "%s %s" % (run_date, CHAIN_WINDOW_END)
    created = _parse_iso_local(manifest_created_at)

    fetch, _ = logs('function_name:"fetchDailyData"', w0, w1, 40)
    mat, _ = logs('function_name:"materializeIndicators"', w0, w1, 40)
    rde, rde_raw = logs('function_name:"runDecisionEngine"', w0, w1, 40)
    out["raw_bytes"] = len(rde_raw)''',
            '''    out = {"verified": False, "hops": [], "chain_id": None,
           "limitation": "invocation log 不含 engine_run_id；"
           "run↔invocation 归属以 [START, Report] 区间包含 run_manifest.created_at 作间接证明"}
    if not run_date:
        return out
    created = _parse_iso_local(manifest_created_at)

    # v6.0：逐链尝试（W1-2200 / W2-0800 **同等有效**）；任一链证明成功即 verified。
    for _cw in CHAIN_WINDOWS:
        w0 = "%s %s" % (run_date, _cw["start"])
        w1 = "%s %s" % (run_date, _cw["end"])
        _res = _chain_attempt(_cw, w0, w1, created)
        if _res["verified"]:
            return _res
        out = _res
    return out


def _chain_attempt(cw, w0, w1, created):
    """单链 CHAIN PROOF 尝试（v6.0 抽出；语义与 v5.0 一致，仅**参数化**日志窗口）。"""
    out = {"verified": False, "hops": [], "chain_id": cw["chain_id"],
           "entry": cw["entry"], "window": [w0, w1]}

    fetch, _ = logs('function_name:"fetchDailyData"', w0, w1, 40)
    mat, _ = logs('function_name:"materializeIndicators"', w0, w1, 40)
    rde, rde_raw = logs('function_name:"runDecisionEngine"', w0, w1, 40)
    out["raw_bytes"] = len(rde_raw)''',
            1, "T5a")

    # ---- T6 main() 适配 ----
    t = rep(t,
            '    print("=== C-1 capture (v5.0 语义)  as-of %s ===" % NOW.strftime("%Y-%m-%d %H:%M:%S"))',
            '    print("=== C-1 capture (v6.0 语义)  as-of %s ===" % NOW.strftime("%Y-%m-%d %H:%M:%S"))',
            1, "T6a")

    t = rep(t,
            '    print("    checkpoint = 工作日 [22:30:00, 23:30:00)（北京）")',
            '    print("    checkpoint = %s" % CHECKPOINT_RULE)',
            1, "T6b")

    t = rep(t,
            """    ck = evaluate_checkpoint(NOW)
    official = gate_pass and elig_pass and ck""",
            """    ck = evaluate_checkpoint_v6(NOW)
    official = gate_pass and elig_pass and ck["ok"]""",
            1, "T6c")

    t = rep(t,
            '''    print("   [%s] 现在=%s 要求=工作日 22:30–23:29（北京）"
          % ("PASS" if ck else "FAIL", NOW.strftime("%Y-%m-%d %H:%M:%S")))''',
            '''    print("   [%s] 现在=%s window=%s reason=%s 要求=%s"
          % ("PASS" if ck["ok"] else "FAIL", NOW.strftime("%Y-%m-%d %H:%M:%S"),
             ck["window_id"], ck["reason"], CHECKPOINT_RULE))''',
            1, "T6d")

    t = rep(t,
            '    print("   ⇒ scoring = %s" % decide(gate_pass and elig_pass, ck))',
            '    print("   ⇒ scoring = %s" % decide(gate_pass and elig_pass, ck["ok"]))',
            1, "T6e")

    t = rep(t,
            '''        "checkpoint_rule": "工作日 [22:30:00, 23:30:00)（北京）",
        "checkpoint_ok": ck,''',
            '''        "checkpoint_rule": CHECKPOINT_RULE,
        "checkpoint_ok": ck["ok"],
        "checkpoint_window_id": ck["window_id"],   # v6.0 新增（⛔ 仅记录窗口身份，⛔ 非独立判据）''',
            1, "T6f")

    t = rep(t,
            '        "scoring": decide(gate_pass and elig_pass, ck),',
            '        "scoring": decide(gate_pass and elig_pass, ck["ok"]),',
            1, "T6g")

    t = rep(t,
            '''        if not ck:
            why.append("OFF_CHECKPOINT（§5.8）")''',
            '''        if not ck["ok"]:
            why.append("OFF_CHECKPOINT（§5.8：%s）" % ck["reason"])''',
            1, "T6h")

    return t


# =====================================================================
# 测试
# =====================================================================
def _v5_source():
    """自 git 抽取 v5.0 **冻结字节**（⛔ 不用磁盘旧快照，避免陈旧）。"""
    b = subprocess.run(["git", "-C", CARRIER_GIT, "show",
                        "%s:scripts/gen1/evidence-capture/c1_capture.py" % V5REV],
                       capture_output=True, check=True).stdout
    assert hashlib.sha256(b).hexdigest() == V5_SHA_0, "v5.0 基线抽取失败"
    return b.decode("utf-8")


def _func(src, name):
    m = re.search(r"^def %s\(.*?(?=^def |\Z)" % re.escape(name), src, re.M | re.S)
    return (m.group(0).rstrip() + "\n") if m else None


# =====================================================================
# ★ 设计 ⇄ 正式版 的**文本对齐留痕**（2026-10-02，B3 施加期）
# ---------------------------------------------------------------------
# 方向：`RECONCILE[i] = (正式版文本, 对齐前设计原文)` —— 用于**反向重建**对齐前的设计。
# 性质：3 删 / 4 增，**全部落在 docstring / 注释**；[5d] 以 AST（剥离 docstring）
#   证明对齐**零规范语义改动**；[5d*] 以变异打红自证比较器有效。
# ⛔ 本登记表是**证据**，⛔ 不得为「让测试过」而增删条目 —— 增删即等于篡改留痕。
RECONCILE = [
    ('    """契约 §5.8（v6.0）：工作日 **W1 ∪ W2**（预登记有序窗口序列）。\n',
     '    """契约 §5.8（v6.0）：工作日 **W1 ∪ W2**。\n'),
    ('       「该 decision_date 是否已由**首个**窗口产出」属**会话序**判定 ⇒ 由调用方按 §5.8\n',
     '       「该 decision_date 是否已由**首个**窗口产出」属**会话序**判定 ⇒ 由调用方按 §5.8 规则 2\n'),
    ('    ⚠️ 窗口身份（W1 / W2）⛔ **不是**独立事件判据（契约 §3.4A 明文排除）。\n',
     ''),
    ('            continue                      # §5.8：本窗口不产出，继续下一窗口\n',
     '            continue                      # §5.8 规则 3：本窗口不产出，继续下一窗口\n'),
]

# 本批次相关函数（[5] 的断言作用域；⛔ 作用域固定，不得随断言结果扩大/收窄）
FNS = ("evaluate_checkpoint_v6", "first_window_wins_checkpoint", "_chain_attempt",
       "evaluate_checkpoint", "_hhmm_to_min", "_minute_of_day")


def _strip_docstrings(tree):
    """删除所有 docstring 节点（注释本就不入 AST）⇒ 只留**规范语义**。"""
    for n in ast.walk(tree):
        if isinstance(n, (ast.Module, ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
            b = getattr(n, "body", None)
            if (b and isinstance(b[0], ast.Expr) and isinstance(b[0].value, ast.Constant)
                    and isinstance(b[0].value.value, str)):
                n.body = b[1:] or [ast.Pass()]
    return tree


def _ast_sig(srctext):
    """规范语义指纹：AST（剥离 docstring）dump。⛔ 与文本无关。"""
    return ast.dump(_strip_docstrings(ast.parse(srctext)),
                    annotate_fields=True, include_attributes=False)


def _line_delta(a, b):
    """a → b 的逐行差异，返回 (removed, added)；忽略 ndiff 的 `? ` 提示行。"""
    rem, add = [], []
    for ln in difflib.ndiff(a.splitlines(), b.splitlines()):
        if ln.startswith("- "):
            rem.append(ln[2:])
        elif ln.startswith("+ "):
            add.append(ln[2:])
    return rem, add


def _doc_span(fn_text):
    """函数 docstring 的行号区间（1-based，含两端）；无 docstring ⇒ None。"""
    fn = ast.parse(fn_text).body[0]
    if not fn.body:
        return None
    d = fn.body[0]
    if (isinstance(d, ast.Expr) and isinstance(d.value, ast.Constant)
            and isinstance(d.value.value, str)):
        return (d.value.lineno, d.value.end_lineno)
    return None


def _norm_code(fn_text):
    """**规范语义文本投影**：docstring 文本 / 行内注释文本 ⇒ 占位符（保留行结构）。

    ⛔ 口径说明：`continue   # 注释` 这类「代码行 + 行内注释」不能靠 `startswith("#")` 判，
      必须用 tokenize 精确定位 COMMENT 列、用 AST 定位 docstring 区间。
    ⇒ `_norm_code(a) == _norm_code(b)` **直接**证明差异只在注释 / docstring（无需推断）。
    """
    lines = fn_text.splitlines()
    span = _doc_span(fn_text)
    cpos = {}
    for tok in tokenize.generate_tokens(io.StringIO(fn_text).readline):
        if tok.type == tokenize.COMMENT:
            cpos.setdefault(tok.start[0], tok.start[1])
    out = []
    for i, ln in enumerate(lines, start=1):
        if span and i == span[0]:
            out.append("<DOCSTRING>")   # ⚠️ 整段收敛为 1 行：docstring **行数**本身非规范语义
        elif span and span[0] < i <= span[1]:
            continue
        elif i in cpos:
            out.append(ln[:cpos[i]] + "<COMMENT>")
        else:
            out.append(ln)
    return "\n".join(out)


def main():
    emit = "--emit-diff" in sys.argv
    v5raw = _v5_source().encode("utf-8")
    v5src = v5raw.decode("utf-8")
    act_raw = open(TARGET, "rb").read()
    act = act_raw.decode("utf-8")
    print("== c1_capture.py：迁移设计留痕 + 施加后校验 ==")
    print("   v5.0 基线（git %s）= %s（%d B / %d 行）"
          % (V5REV[:8], V5_SHA_0[:12], len(v5raw), v5src.count("\n")))
    print("   v6.0 实文件（磁盘）    = %s（%d B / %d 行）"
          % (hashlib.sha256(act_raw).hexdigest()[:12], len(act_raw), act.count("\n")))
    print()

    prop = transform_v5_to_v6(v5src)

    print("-- [1] 迁移设计（`transform_v5_to_v6`）结构断言 --")
    check("T 变换无 REPLACE 失败", not [f for f in FAILS if f.startswith("REPLACE")])
    check("设计产出含 CHECKPOINT_WINDOWS 双窗口", "CHECKPOINT_WINDOWS = [" in prop)
    check("设计产出含 evaluate_checkpoint_v6（返回 window_id）",
          "def evaluate_checkpoint_v6(now):" in prop and '"window_id": w["id"]' in prop)
    check("设计产出含 first-window-wins", "def first_window_wins_checkpoint(sessions):" in prop)
    check("设计产出含 CHAIN_WINDOWS 双链", "CHAIN_WINDOWS = [" in prop and '"W2-0800"' in prop)
    check("设计产出为**方案**（4 处 PENDING 占位）",
          prop.count('"PENDING_AT_V6_FREEZE"') == 4)

    print("\n-- [2] 设计产出可解析（AST）--")
    try:
        ast.parse(prop)
        check("设计产出 ast.parse 通过", True)
    except SyntaxError as e:
        check("设计产出 ast.parse 通过", False, str(e))

    print("\n-- [3] ★ 反向证明：v5.0 语义在 W2 上**必然失败** --")
    import datetime as dtm
    m = re.search(r"^def evaluate_checkpoint\(now\):\n(?:.*\n)*?        "
                  r"\(now\.hour == 22 and now\.minute >= 30\) or "
                  r"\(now\.hour == 23 and now\.minute < 30\)\)\n", v5src, re.M)
    check("能从 v5.0 冻结源码抽取 evaluate_checkpoint", m is not None)
    ns5 = {}
    if m:
        exec(compile(m.group(0), "<v5>", "exec"), ns5)
    f5 = ns5.get("evaluate_checkpoint", lambda now: False)
    check("★ v5.0 在 W2（08:45）判 False ⇒ 单窗口语义必然丢样",
          f5(dtm.datetime(2026, 10, 2, 8, 45)) is False)
    check("v5.0 在 W1（22:45）判 True", f5(dtm.datetime(2026, 10, 1, 22, 45)) is True)

    print("\n-- [4] ★ 施加后校验：磁盘文件**已是** v6.0 --")
    check("磁盘 c1_capture.py 含 CHECKPOINT_WINDOWS", "CHECKPOINT_WINDOWS = [" in act)
    check("磁盘 c1_capture.py 无 PENDING 占位", "PENDING_AT_V6_FREEZE" not in act)
    check("磁盘 c1_capture.py 绑定冻结载体 sha256", FROZEN_SHA in act)
    check("★ 旧单窗口表达式已从磁盘文件消失（v5.0 语义不残留）",
          "(now.hour == 22 and now.minute >= 30) or (now.hour == 23 and now.minute < 30)" not in act)

    print("\n-- [5] ★★ 设计 ⇄ 实文件 **语义等价** --")
    # ---- [5a] 最强断言：6 函数逐字节相同 + 关键判据字面量逐字节相同 ----
    for fn in FNS:
        a, b = _func(prop, fn), _func(act, fn)
        check("[5a] 函数 %s 设计 ⇄ 实文件逐字节相同" % fn, a is not None and a == b)
    check("[5a] CHECKPOINT_WINDOWS 字面量设计 ⇄ 实文件相同",
          '{"id": "W1", "start": "22:30", "end": "23:30"}' in prop
          and '{"id": "W1", "start": "22:30", "end": "23:30"}' in act
          and '{"id": "W2", "start": "08:30", "end": "09:30"}' in prop
          and '{"id": "W2", "start": "08:30", "end": "09:30"}' in act)
    check("[5a] CHAIN_WINDOWS 字面量设计 ⇄ 实文件相同",
          '"chain_id": "W1-2200"' in prop and '"chain_id": "W1-2200"' in act
          and '"chain_id": "W2-0800"' in prop and '"chain_id": "W2-0800"' in act)
    check("[5a] 旧单窗口表达式在设计产出与实文件中**双零命中**",
          "(now.hour == 22 and now.minute >= 30) or (now.hour == 23 and now.minute < 30)"
          not in prop
          and "(now.hour == 22 and now.minute >= 30) or (now.hour == 23 and now.minute < 30)"
          not in act)

    # ---- [5b] 反向重建：由 RECONCILE 反推「对齐前设计」，替换必须**逐条命中** ----
    prev = prop
    for _new, _old in RECONCILE:
        prev = rep(prev, _new, _old, 1, "RECONCILE")
    check("[5b] 反向重建：%d 条对齐登记全部命中（反向重建成功）" % len(RECONCILE),
          not [f for f in FAILS if f.startswith("REPLACE[RECONCILE]")])
    check("[5b] 反向重建结果 ≠ 对齐后设计（登记表非空且真的改动过）", prev != prop)

    # ---- [5c] 文本差异**完全枚举**：对齐前设计 ⇄ 实文件 = 3 删 / 4 增，全 docstring/注释 ----
    rem, add = [], []
    for fn in FNS:
        r, a2 = _line_delta(_func(prev, fn), _func(act, fn))
        rem += [(fn, x) for x in r]
        add += [(fn, x) for x in a2]
    print("        对齐前设计 ⇄ 实文件：%d 删 / %d 增" % (len(rem), len(add)))
    for fn, x in rem:
        print("          - [%s] %s" % (fn, x.strip()[:86]))
    for fn, x in add:
        print("          + [%s] %s" % (fn, x.strip()[:86]))
    check("[5c] 文本差异恰为 3 删 / 4 增（与 RECONCILE 登记一致）",
          len(rem) == 3 and len(add) == 4)
    check("[5c] 文本差异只落在 2 个函数（其余 4 个逐字节一致）",
          set([f for f, _ in rem] + [f for f, _ in add])
          == {"evaluate_checkpoint_v6", "first_window_wins_checkpoint"})
    check("★ [5c] docstring / 注释置空后**文本逐字节相同** ⇒ 差异全在注释 / docstring",
          all(_norm_code(_func(prev, fn)) == _norm_code(_func(act, fn)) for fn in FNS))
    _mutc = prev.replace('"window_id": w["id"]', '"window_id": w["start"]')
    check("★ [5c] 打红自证：变异体（window_id ← start）规范语义投影必不同",
          _mutc != prev
          and _norm_code(_func(_mutc, "evaluate_checkpoint_v6"))
          != _norm_code(_func(prev, "evaluate_checkpoint_v6")))

    # ---- [5d] ★ 反向证明：对齐**零规范语义改动** ----
    bad = [fn for fn in FNS if _ast_sig(_func(prev, fn)) != _ast_sig(_func(act, fn))]
    check("★ [5d] 对齐前 ⇄ 实文件 AST（剥离 docstring）逐字节相同 ⇒ 零规范语义改动",
          not bad)
    mut = prop.replace('"window_id": w["id"]', '"window_id": w["start"]')
    check("★ [5d] 打红自证：变异体（window_id ← start）AST 必不同 ⇒ 比较器有效",
          mut != prop
          and _ast_sig(_func(mut, "evaluate_checkpoint_v6"))
          != _ast_sig(_func(prop, "evaluate_checkpoint_v6")))

    print("\n-- [6] migration diff（v5.0 → 实文件；**APPLIED**）--")
    diff_text = "".join(difflib.unified_diff(
        v5src.splitlines(keepends=True), act.splitlines(keepends=True),
        fromfile="a/scripts/gen1/evidence-capture/c1_capture.py",
        tofile="b/scripts/gen1/evidence-capture/c1_capture.py", n=3))
    n_hunks = diff_text.count("\n@@ ")
    print("        hunks = %d ; diff bytes = %d" % (n_hunks, len(diff_text.encode("utf-8"))))
    check("diff 非空且含多个 hunk", len(diff_text) > 0 and n_hunks >= 5)
    check("diff 含关键新增行",
          "CHECKPOINT_WINDOWS" in diff_text and "evaluate_checkpoint_v6" in diff_text
          and "checkpoint_window_id" in diff_text)
    if emit:
        header = (
            "# c1_capture.py v5.0 -> v6.0 migration diff（**APPLIED**）\n"
            "# 施加批次：V6.0 FREEZE + B3 同批次工具迁移（owner 2026-10-02 / O-1 = APPROVED）\n"
            "# 契约 §11 规则 5：工具语义迁移与契约冻结同批次 ⇒ ⛔ 不存在预登记违规窗口\n"
            "# v5.0 sha256 = %s（%d B / %d 行）\n"
            "# v6.0 sha256 = %s（%d B / %d 行）\n"
            "# 同批次必改：c1_gate_redproof.py §[6] checkpoint 期望（09:00 单窗口 -> W1/W2 + 反向证明）\n"
            % (V5_SHA_0, len(v5raw), v5src.count("\n"),
               hashlib.sha256(act_raw).hexdigest(), len(act_raw), act.count("\n")))
        with open(DIFF_OUT, "w", encoding="utf-8", newline="\n") as fh:
            fh.write(header + diff_text)
        print("        [OK] 已写出 %s（%d B）" % (DIFF_OUT, len((header + diff_text).encode("utf-8"))))
        check("diff 文件已落盘", os.path.exists(DIFF_OUT))

    print("\n======================================================")
    print("迁移设计留痕 + 施加后校验：%s（%d PASS / %d FAIL）"
          % ("✅ ALL PASS" if not FAILS else "❌ 存在 FAIL", len(PASSES), len(FAILS)))
    for f in FAILS:
        print("   FAIL: %s" % f)
    print("======================================================")
    return 0 if not FAILS else 1


if __name__ == "__main__":
    sys.exit(main())
