# Gen-1 C-1 Evidence Capture（v5.0 语义）

本目录是 **C-1（EXTERNAL READ-ONLY DAILY SNAPSHOT）** 采集工具的**仓库内权威副本**。

## 1. 冻结绑定

| 项 | 值 |
|---|---|
| 契约 | `docs/gen1/GEN1_EVIDENCE_CONTRACT_V5.md` |
| 契约版本 | **v5.0（FROZEN 2026-10-02）** |
| carrier commit | `05da0efa73e948921bc7b9b60c0d500cc98e3e9b` |
| git blob id（sha1） | `7f86d12aaed99a877c170c25c5a481f21a661256` |
| content sha256 | `4fb9463f4a437e310cb52b04498a1d4cc0f23fbc64eb3c1d846d90a460a9f55b`（64580 B / LF） |

> ⚠️ **三种指纹不可混用**：`git blob id` 是 **sha1**（git 对象哈希）；`content sha256` 是**文件内容**哈希。
> ⛔ 冻结指纹由**封存记录**与载体 PR body 承载，⛔ **不写入契约文件本身**（避免自指矛盾）。

**迁移依据**：契约 **§11 元规则 规则 5** —— 「工具语义迁移与契约冻结**同批次**」；
契约 **§12 第 12 项** —— 迁移随冻结一并执行。
本目录即该「同批次」产物：契约冻结与工具改绑在**同一次推送**内完成。

## 2. 文件

| 文件 | 作用 |
|---|---|
| `c1_capture.py` | 每日 capture bundle 生成（八源 + 14 条 coherence gate + append-only 落盘） |
| `c1_gate_redproof.py` | **打红自证**（mutation test）：归纳基线 14/14 PASS ⇒ 逐条变异 ⇒ 目标规则必 FAIL |

## 3. v5.0 相对 v3.0 的语义变更

| # | 变更 |
|---|---|
| 1 | 读源整体改绑 **run 轴**：`decision_result` → `run_candidate_decision`；`portfolio_snapshot` → `run_candidate_portfolio` |
| 2 | 源集合 **5 → 8**：新增 `run_manifest` / `active_run_pointer` / `run_history` |
| 3 | **SELECTOR = `S-PROMOTED`**：pin `active_run_pointer[scope="production"].run_id`，读一次即 pin |
| 4 | 行键 `(date, code)` → **`(run_id, code)`**（消除实测键碰撞） |
| 5 | bundle 新增 `run_id` / `pointer_revision` / `run_manifest.*` / `run_history.*` |
| 6 | gate **9 → 14 条**（规则 1/2 改按 pointer revision；新增组 A1/A2/A3 与 B3/B4） |
| 7 | checkpoint 工作日 09:00 → **工作日 `[22:30:00, 23:30:00)`（北京）** |
| 8 | CHAIN PROOF 重锚到 **22:00 入口管线**（`fetchDailyData`），⛔ 不再要求落在 capture 窗口内 |

⛔ `decision_result` / `portfolio_snapshot` **退出**评分源，但仍是**生产前台现行读链** ——
两者**不得混为一谈**（承重墙 R7；见契约 §5.9 `EVIDENCE OBJECT BOUNDARY`）。

## 4. 用法

```bash
# 只跑 gate 并打印，不落盘
python c1_capture.py --dry-run

# 正常执行（append-only 落盘到仓库外 _evidence-capture-YYYYMMDD/）
python c1_capture.py

# 门逻辑打红自证
python c1_gate_redproof.py
```

## 5. 硬约束（与契约一致，⛔ 勿改）

1. **只读**：云端仅 `QUERY/find` + `COMMAND/count` + `logs search`；⛔ 零 `INSERT/UPDATE/DELETE`
2. 八源 capture bundle + 逐源 SHA256
3. `BUNDLE COHERENCE GATE` **14 条**；任一不过 ⇒ 非正式 bundle（**fail-closed**）
4. **append-only**：同名已存在 ⇒ 拒绝写入，⛔ 不覆盖
5. ⛔ **不倒填**（`NO RETROACTIVE RECONSTRUCTION`）
6. 只写**仓库外**归档目录；⛔ 不写生产 DB

## 6. 环境依赖（⚠️ 如实声明）

本工具**不在仓库内自带凭据**，依赖只读通道模块 `cb_connect`：

| 环境变量 | 默认 | 说明 |
|---|---|---|
| `CB_CONNECT_DIR` | 开发机默认路径 | `cb_connect.py` 所在目录（提供 `assert_readonly` / `run_tcb` / `do_login` / `load_cred`） |
| `GEN1_EVIDENCE_ROOT` | 开发机默认路径 | capture 归档根目录（`_evidence-capture-YYYYMMDD/` 建在其下） |
| `CB_NODE` / `CB_CLI` | 开发机默认路径 | node 与 `@cloudbase/cli` 的 `tcb` 入口 |

⚠️ 默认值指向**开发机绝对路径**，属**已知可移植性债**：本副本的用途是
「把**语义**置于版本控制之下、与冻结契约同批次」，而不是提供开箱即用的分发。
⛔ 不得据此认为该工具可在任意机器直接运行。

## 7. 已知局限

- SCF 调用日志**不含** `engine_run_id` 字段 ⇒ CHAIN PROOF 第 ③ 条以
  「`[START, Report]` 区间包含 `run_manifest[R].created_at`」作**间接**归属证明，
  ⛔ 不主张为直接证得（见 `c1_capture.chain_proof()` 的 `limitation` 字段）。
- 规则 14（⛔ `(IV) CALENDAR TRADE DATE` 不得进入任一判据）为**结构性禁令**：
  以「`evaluate_gate` 签名与实现不含任何日历量」自证，⛔ 无对应状态位可变异。
