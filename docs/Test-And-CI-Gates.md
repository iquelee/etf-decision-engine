# 测试与 CI 门禁（Test & CI Gates）

日期：2026-09-08。本文固化统一测试入口 `scripts/test-all.js` 与 GitHub Actions 的完整门禁清单，作为「效果不明不部署」的工程依据。

## 统一测试入口

```bash
npm test            # = node scripts/test-all.js，5 阶段全量门禁
node scripts/test-all.js --stage A   # 只跑某阶段
```

任何阶段失败 → 整体 `exit 1`。

| Stage | 名称 | 内容 | 覆盖任务书测试 |
|---|---|---|---|
| A | Node 单元测试 | `tests/*.test.js`（13 文件） | test_common_single_source、test_risk_off_*、test_no_core_hard_exit、test_replacement_*、test_integrated_* |
| B | Gen-2 Python 单测 | `PYTHONPATH=ml python -m unittest discover ml/gen2/tests`（30 项） | Point-in-Time、No Future Leakage、Walk Forward、Purge/Embargo、Ledger |
| C | Immutable Checks | Gen-1 frozen model/manifest/inference SHA + model_id；V3.6.1 decision-v3/decision SHA | test_gen1_immutable、test_v361_immutable |
| D | Cross-language Parity | fixtures/gen2 30 只×12 日，Python↔Node 逐字段比对 | test_python_node_alpha/rank/role/weight_parity |
| E | Secret scan | 全文扫描 sk-/FRED/DEEPSEEK/OPENDART 密钥模式 | SecretScanGate |

## CI 门禁（.github/workflows/test.yml）

触发：`push` / `pull_request` 到 `master`。矩阵：Python 3.11 / 3.12，Node 22。

| Gate | 名称 | 失败即 CI FAIL |
|---|---|---|
| 1 | Node 单元测试 | Stage A |
| 2 | Python 单元测试 | Stage B |
| 3 | Immutable 冻结检查 | Stage C（Gen-1 frozen + V3.6.1） |
| 4 | Cross-language Parity | Stage D |
| 5 | Secret scan | Stage E |
| 6 | GEN2_RULE_V2_BUNDLE 冻结 | `git diff` 校验 bundle 未被改动 |

对应任务书要求的 Gate：`Gen1ImmutableGate`、`V361ImmutableGate`、`Gen2ParityGate`、`NoFutureDataGate`、`BuildCommonParityGate`、`SecretScanGate`（NoFutureData 由 Stage B 的 Point-in-Time/No-Leakage 覆盖；BuildCommonParity 由 `scripts/build-cloudfunctions.js` 的 duplicate parity 校验覆盖）。

## Build Common Parity（部署前）

`scripts/build-cloudfunctions.js` 从 `src/common/` canonical 构建 11 个云函数的 dist bundle，并校验「同名 common 文件跨函数 SHA 一致」+「与 src/common canonical 一致」。build 不通过 → 不得部署。

## 提交纪律（任务书 §28/§29）

- 每个 commit 必须 `npm test` 全绿 + immutable PASS + secret scan PASS。
- 若存在已知 legacy 失败，必须在报告/PR 中明确「known legacy failures」，不得声称 all tests passed。

## 当前状态

- Stage A 13/13、Stage B 30/30、Stage C 6/6、Stage D 通过、Stage E 通过 → **22/22 全绿**。
- 已知缺口（记入 parity-contract.md）：reason_codes 文案两端差异不比对；null liquidity 传播差异（有效 ETF 无 null）。
