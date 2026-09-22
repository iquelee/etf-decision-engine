# V3.6.4 Gate C —— Swing Parity Report

- 生成时间：2026-09-22T05:18:46.688Z
- 被比对的实现：
  - OLD：`src/common/utils/trend-stage.js::swingHighLow`（**Gen-1 冻结件，不得修改/删除**）
  - NEW：`src/common/utils/swing-structure.js::swingHighLow`（R1 的 SlowBreak 修复依赖）
- 扫描口径：对每条 K 线序列枚举**每一个长度 12 的 rolling window**（`bars.slice(i, i+12)`），逐窗口比对

## 判定：**PASS**

| 指标 | 值 |
|---|---|
| **total_windows** | **5483** |
| **mismatch_count** | **0** |
| 共享字段 | `higherLow` · `lowerHigh` |
| 非共享字段（新实现专有，不参与 parity） | `higherHigh` · `lowerLow` · `computable` · `window` · `sample` · `priorHigh` · `priorLow` · `recentHigh` · `recentLow` |
| 真实历史窗口 | 4566（5 只生产 ETF） |
| 合成语料窗口 | 917（30 条序列） |

要求：**`mismatch_count = 0`**。

## 数据源

### 1) 真实历史 K 线（`deliverables/etf_daily_ml_pool/*.qfq.csv`）

| code | windows | mismatches |
|---|---|---|
| 159570 | 624 | 0 |
| 159582 | 571 | 0 |
| 513310 | 887 | 0 |
| 515880 | 1685 | 0 |
| 518880 | 799 | 0 |

- ⚠️ **`deliverables/` 已 gitignore ⇒ CI 上该源必然 unavailable。**
  因此 CI 的 parity 保障来自下面的确定性合成语料（不伪造真实数据）。

### 2) 确定性合成语料（CI 上始终可用，保证门禁真实有效）

| 类别 | 用途 |
|---|---|
| `up_*` / `down_*` / `flat_*` | 单调上涨 / 下跌 / 水平 —— 语义锚定 |
| `tie_*` | 高点或低点严格相等 —— 压 tie 语义（应全 false） |
| `exactly_12` / `len_11` / `empty` | 边界与退化长度 |
| `null_highs` / `null_lows` | 残缺 high/low |
| `random_*` | 确定性 PRNG（不用 `Math.random`）多长度随机游走 |
| `discrete_*` | 离散价格（大量并列值） |

序列数：**30**，窗口数：**917**

## 永久门禁

```
node tests/v364-swing-parity.test.js     # CI Stage A 自动执行（tests/*.test.js）
```

该测试在默认的 `node scripts/test-all.js` Stage A 里被自动发现并执行，
因此**任何对 `swing-structure.js` 的改动只要让 `higherLow` / `lowerHigh` 漂移，CI 立即失败**。

### 门禁自身的首轮 CI 表现（2026-09-22，PR #52 run #143）

首轮 CI **红**，且红在本门禁上 —— 但**不是 parity 破裂**：

```
✗ C.2 扫描规模足够（真实历史 + 确定性合成语料都覆盖）: total_windows 过少：917
```

- `C.1（mismatch_count = 0）` 在 CI 上**照样 PASS** ⇒ 共享语义未漂移。
- 失败原因是 **C.2 的阈值 `total_windows > 3000` 按本机环境标定**：
  本机 5483（真实 4566 + 合成 917），CI 无 `deliverables/` ⇒ 只剩 917。
  **这是本门禁的测试缺陷，不是产品缺陷。**
- 已修为**环境感知**：合成语料底线环境无关恒强制；真实历史仅在**可用时**才强制 `> 3000`；
  不可用时打印 `[NOTICE]` 显式披露「本环境未覆盖真实历史」。**不静默放宽、不伪造数据。**
- 复现验证：`scanParity({ includeReal: false })` → `total_windows = 917`，与 CI 逐位吻合。

> 结论：本门禁**确实咬得住**（CI 一跑就暴露了「按本机标定」的隐患）。修复后仍保持
> `mismatch_count = 0` 的硬约束，只是把「语料规模」这一维度按环境正确分层。

## 退化输入

| case | 两份实现均不抛异常 |
|---|---|
| #0 | ✅ |
| #1 | ✅ |
| #2 | ✅ |
| #3 | ✅ |
| #4 | ✅ |

## 设计说明：为什么允许两份实现并存

- `trend-stage.js::swingHighLow` 是 `GEN1_FEATURE_PIPELINE_LOCK.json` 钉死的 role 文件
  （`role = trend_stage_implementation`），删它 = 修改冻结工件 ⇒ 必须走重锁 + 审批。
- `swing-structure.js::swingHighLow` 是 R1 修复 SlowBreak 链所必需（提供 `lowerLow`）。
- 二者是**不同函数对象**（测试 `C.3` 断言），共享语义由本 Gate 逐窗口锁定。
- 代价：源码层面仍有两份算法；这是**已登记的残留冲突**（见 `V364_CANDIDATE_QUALIFICATION.md` §未解决风险）。
- 收敛路径（需单独授权，本轮不做）：① 授权重锁后把唯一实现移入 `trend-stage.js`；② 升版 V3.6.5+。
