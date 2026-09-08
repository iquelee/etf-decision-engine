# Gen-2 当前状态核验快照

**生成时间**：2026-09-05 07:40 +08:00  
**执行者**：WorkBuddy Agent  
**来源规格书**：`ETF决策系统_Gen2开发交接与技术规格书_2026-09-05.md`  
**规格书 SHA256**：`bad5cd0a1f319bbc0b51a894048e96b0557f909bfb33e5b3a836704e372e4d26`

---

## 1. 当前源码与版本身份

| 项目 | 当前值 | 状态 |
|---|---|---|
| Git commit | 仓库未初始化 / 当前目录不是 git repo | 已记录 |
| 版本文件 | `VERSION.txt` | 存在 |
| `VERSION.txt` SHA256 | `fe135c3a530c72d10db67db57902c8fe945fdd85f98415fe3767ea36bf2ace4d` | 已记录 |
| Production Engine | `V3.6.1` | FROZEN |
| Gen-1 Model ID | `HVT-A-ET-20260830` | FROZEN |
| Shadow Observe | `true` | 仅观察 |
| Fast Path | `false` / `NOT_CONNECTED` | 硬关 |
| Production ML | `BLOCKED` | 禁止接入生产 |
| Auto Trading | 未发现生产开关；按规格书固定为 `OFF` | 关闭 |

---

## 2. 当前 Main5

| Code | 名称 | 当前 sector | 当前定位 |
|---|---|---|---|
| 513310 | 中韩半导体 ETF(QDII) | storage | incumbent |
| 159582 | 半导体设备 ETF | semi_equip | incumbent |
| 515880 | 通信 ETF | ai_network | incumbent |
| 159570 | 港股通创新药 ETF | biotech | incumbent |
| 518880 | 黄金 ETF | gold | incumbent / defensive |

三只科技 incumbent（513310 / 159582 / 515880）存在高相关暴露，Gen-2 必须引入 `correlation_cluster` 与 cluster cap。

---

## 3. Gen-1 Immutable 核验

执行命令：

```bash
/Users/li/.workbuddy/binaries/python/versions/3.14.3/bin/python3 scripts/ml/assert-gen1-immutable.py
```

结果：

```text
PASS: Gen-1 immutable ( HVT-A-ET-20260830 )
```

关键哈希：

| Artifact | Path | SHA256 |
|---|---|---|
| model | `ml/models/HVT-A-ET-20260830/model.joblib` | `4c0e65378817eb4760f07cb776fd83fd1c6eb9ab57ec01d78d2ae3d8d36cc218` |
| freeze manifest | `ml/models/HVT-A-ET-20260830/freeze_manifest.json` | `bc3870db673b8164d8c24fd85024682035228fa9edd19773988e10e42ddf12d1` |
| immutable lock | `ml/manifests/GEN1_IMMUTABLE_LOCK.json` | `92f39b77792bb4424b61c3b0df8a44326ef0ee0dae3ede8f8183244ff5f9abdc` |
| shadow bundle | `ml/manifests/SHADOW_BUNDLE_v1.json` | `80ab0581ef53ec7d692c42073f34734534506b4e1519a70a20cb2c1e10c32087` |

结论：**Gen-1 模型、manifest、bundle 与 lock 完全一致，未发生漂移。**

---

## 4. V3.6.1 / Safety Core 状态

`ml/manifests/ENGINE_V361_v1.json` 标记：

```text
engine_version = v3.6.1
state = FROZEN
role = Production Baseline
stage_logic = FROZEN
target_curve = FROZEN
risk = FROZEN
portfolio_cap = FROZEN
fast_path_permission = RULE_ONLY_NO_ML
```

当前源码关键默认：

```text
tech_sector_max = 65%
single_etf_max  = 30%
trend_stage_enabled = true
```

Gen-2 第一阶段不得修改这些 Safety Core 边界。

---

## 5. 既有测试状态

执行命令：

```bash
/Users/li/.workbuddy/binaries/node/versions/22.12.0/bin/node scripts/run-tests.js
```

结果摘要：

```text
bars-through.test.js      PASS  7/7
decision.test.js          PASS  8/8
fundamental.test.js       PASS 27/27
scan-secrets.test.js      PASS  8/8
phase1.test.js            FAIL 28 passed / 5 failed
```

`phase1.test.js` 当前 5 个失败点：

1. `ENGINE_VERSION` 当前为 `V3.6.1`，测试期望 `V3.9`；
2. V3.9 E3：515880 W4 零仓 B+ 期望 BUILD，实际 WAIT；
3. V3.9.1：core NaN 时 TAC 期望 HOLD 当前仓，实际 NaN；
4. V4.2：detectDState 数据不足时期望 D3，实际 D5；
5. V4.2b：仓位未知时期望 pause，实际 undefined。

判定：这是**Gen-2 开始前已存在的 V3.9/V4.2 行为回归或测试期望漂移**，不是 Gen-2 引入。Gen-2 不在本任务中修改这些问题。

---

## 6. 可用数据源核验

Gen-2 `dev_universe_v0` 使用本地研究数据，不写生产 CloudBase。

| 数据源 | 路径 | 覆盖 | 结论 |
|---|---|---|---|
| ETF 日线前复权 CSV | `deliverables/etf_daily_ml_pool/` | 15 只 | 推荐主源 |
| Universe 训练池 | `ml/universe-train-pool.json` | 13 train + 518880 negative + 510300 benchmark | 可作为 dev universe 基础 |
| Gen-1 日线特征面板 | `ml/datasets/daily_stage_panel_2026-08-29.csv` | 15 只 | 只作字段参照，不作为 Gen-2 唯一源 |

日线 CSV 字段：

```text
date,open,close,high,low,volume,amount
```

数据源说明：腾讯 fqkline / 东财 fqt=1，前复权（qfq）。Gen-2 需在 loader 中补齐 `adj_close`（第一版可等于 close）与 `source/source_trade_date`。

---

## 7. 与 2026-08-30 snapshot 的已知差异

根据 2026-09-05 规格书，8 月 30 日之后线上已发生但本仓库不一定完整体现的变化包括：

- Gen-1 EOD 推理链已经接通；
- `model.joblib` 已确认是 `CalibratedClassifierCV`，内部为 `ColumnTransformer + ExtraTreesClassifier`；
- 本地 EOD 推理结果已同步到 CloudBase `ml_shadow_signal`；
- 非 S2 标的也写入当日状态；
- API 最新交易日 stale 判定已修正；
- 产品层面 Gen-1 已提升为 Primary Advisory，但自动交易仍 OFF；
- UI 正在重构为“Gen-1 主建议，V3.6.1 基线默认隐藏到技术详情”；
- Gen-1 能力审计已于 2026-09-04 完成；
- 线上另有独立 Security Hardening 工作流。

Gen-2 处理方式：上述差异只记录，不在本任务修改；Gen-2 先保持离线、只读、Shadow-only。

---

## 8. 本快照结论

```text
PRODUCTION WRITE = OFF
AUTO TRADING     = OFF
GEN1 MODIFIED    = NO
V361 MODIFIED    = NO
GEN2 MODE        = RESEARCH ONLY
```

可以进入 Gen-2 M0 工程地基建设。
