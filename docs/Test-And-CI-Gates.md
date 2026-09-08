# Test & CI Gates（测试与 CI 门禁）— v2（2026-09-08 晚，P0-A~D 加固）

日期：2026-09-08。本文固化统一测试入口 `scripts/test-all.js` 与 GitHub Actions 门禁清单，作为「效果不明不部署」的工程依据。v2 变更：P0-A 真 SHA 锁替换 git-diff 假锁、P0-B Build Common Parity 进测试、P0-C CI 补 Node 16、P0-D 数据集清单可核验。

## 统一测试入口

```bash
npm test            # = node scripts/test-all.js，6 阶段全量门禁
node scripts/test-all.js --stage A   # 只跑某阶段
```

任何阶段失败 → 整体 `exit 1`。

| Stage | 名称 | 内容 |
|---|---|---|
| A | Node 单元测试 | `tests/*.test.js`（13 文件） |
| B | Gen-2 Python 单测 | `PYTHONPATH=ml python -m unittest discover ml/gen2/tests`（30 项） |
| C | **Immutable 真 SHA 锁**（P0-A） | `scripts/verify-immutable.js`：实际文件 sha256 == lock expected（Gen-1 frozen×3+model_id / V3.6.1 decision×2 / GEN2 bundle×2，共 8 项） |
| D | Cross-language Parity | fixtures/gen2 30 只×12 日，Python↔Node 逐字段比对（360 行） |
| E | Secret scan | 全文扫描 sk-/FRED/DEEPSEEK/OPENDART 密钥模式 |
| F | **Build Common Parity**（P0-B） | `npm run build`：src/common → 11 云函数 dist + 同名文件跨函数 SHA 一致 |

## P0-A 说明：为什么从 `git diff` 换成真 SHA 锁

旧 Stage C / CI Gate 6 用 `git diff --quiet HEAD -- file`。在 CI 干净 checkout 上工作区恒等于 HEAD，即使**历史 commit 修改了 frozen 文件也 PASS** —— 它证明的是「工作区无未提交改动」，不是「冻结引擎未被修改」（假绿灯）。

v2 改为实际文件 SHA256 vs lock 文件 expected：

| lock | 覆盖 | 升级方式 |
|---|---|---|
| `ml/manifests/GEN1_IMMUTABLE_LOCK.json` | frozen-model/manifest/inference + model_id | 新 model_id 挑战，不得改旧 |
| `ml/manifests/V361_IMMUTABLE_LOCK.json`（新） | decision-v3.js / decision.js | 升版 V3.6.2+，不得静默改旧 |
| `ml/gen2/manifests/GEN2_RULE_V2_LOCK.json`（新） | GEN2_RULE_V2_BUNDLE.json + bundle_version | 新 bundle/version/lock（Rule V2.1 另立） |

负向测试已验证：篡改 decision.js 任一字符 → Stage C FAIL（7/8），还原即绿。

## CI 门禁（.github/workflows/test.yml）

触发：`push` / `pull_request` 到 master。矩阵（P0-C 对齐 CloudBase 生产 Nodejs16.13 + 面向未来）：

```yaml
matrix:
  node-version: ['16', '22']
  python-version: ['3.11', '3.12']
```

| Gate | 名称 | 失败即 CI FAIL |
|---|---|---|
| 1-6 | `node scripts/test-all.js`（Stage A-F） | 任一 stage 失败 |
| 7 | `node scripts/verify-immutable.js`（显式重跑 Stage C） | 任一 frozen 对象被改 |

注：Node 22 PASS 不完全等价 CloudBase Nodejs16.13 PASS —— 两个 runtime 都测，任何一边红都阻断。

## 数据集可核验性（P0-D，非 CI 门禁）

研究日线数据（`deliverables/etf_daily_ml_pool/`，31 csv）被 `.gitignore` 排除，线上 clone 无法独立复现 OOS。v2 固化数据身份：

- `ml/gen2/data/DATASET_MANIFEST_V1.json`：每代码 filename/first_date/last_date/rows/sha256/source/adjustment。
- `scripts/verify-gen2-dataset.py`：`--gen` 重新生成 / 默认校验（31/31 一致）；`--require` 缺数据按 FAIL。
- 任何 OOS/资格结论必须声明所用数据与 manifest 一致。

## 提交纪律（任务书 §28/§29）

- 每个 commit 必须 `npm test` 全绿 + immutable PASS + secret scan PASS。
- 已知 legacy 失败必须在报告/PR 明确「known legacy failures」，不得声称 all tests passed。

## 当前状态

`npm test` 18/18 全绿（A 13/13、B 30 项、C 8 项锁、D 360 行、E、F build parity）。已知缺口（记入 parity-contract.md）：reason_codes 文案两端差异不比对；null liquidity 传播差异（有效 ETF 无 null）。
