# Gen-2 — Cross-ETF Leadership / Dynamic Rotation

> 2026-09-05 起，Gen-2 主任务已从旧的「继续挑战 Gen-1 Early Transition 特征」升级为「Cross-ETF Leadership / Dynamic Rotation」。正式开发入口为 `GEN2_CHARTER.md` 与根目录《ETF决策系统_Gen2开发交接与技术规格书_2026-09-05.md》。旧 README 中「寻找低相关 Gen-1 特征」的使命视为历史记录。

**当前状态**：Gen-2.0 Research Foundation / Rule Baseline  
**硬规则**：Gen-2 may challenge Gen-1; Gen-2 may never modify Gen-1.

```text
PRODUCTION WRITE = OFF
AUTO TRADING     = OFF
GEN1 MODIFIED    = NO
V361 MODIFIED    = NO
```

---

## 1. 当前目录

```text
ml/gen2/
├── GEN2_CHARTER.md
├── CURRENT_STATE_SNAPSHOT.md
├── config/
├── universe/
├── data/
├── features/
├── labels/
├── baseline/
├── ranking/
├── portfolio/
├── backtest/
├── evaluation/
├── outputs/
├── reports/
├── manifests/
└── tests/
```

---

## 2. 快速复现

在项目根目录执行：

```bash
# 1) Gen-1 immutable guard
/Users/li/.workbuddy/binaries/python/versions/3.14.3/bin/python3 scripts/ml/assert-gen1-immutable.py

# 2) Gen-2 单元测试
PYTHONPATH=ml /Users/li/.workbuddy/binaries/python/envs/default/bin/python -m unittest discover -s ml/gen2/tests -t . -v

# 3) Universe 审计
PYTHONPATH=ml /Users/li/.workbuddy/binaries/python/envs/default/bin/python -m gen2.universe.universe_audit

# 4) 数据质量报告
PYTHONPATH=ml /Users/li/.workbuddy/binaries/python/envs/default/bin/python -m gen2.data.quality

# 5) Rule Leadership Baseline 全链路
PYTHONPATH=ml /Users/li/.workbuddy/binaries/python/envs/default/bin/python -m gen2.baseline.rule_rotation
```

---

## 3. 当前数据源

- Universe 合约：`universe/etf_master.csv`
- Dev Universe：`universe/dev_universe_v0.json`
- 本地日线：`deliverables/etf_daily_ml_pool/`
- 数据格式：前复权 CSV，字段 `date,open,close,high,low,volume,amount`
- 成交额缺失：第一版用 `close × volume` 估算并在质量报告中披露

---

## 4. 当前基线产物

最新完整运行产物：

```text
outputs/feature_matrix_v1.csv
outputs/daily_rankings.csv
outputs/daily_roles.csv
outputs/rotation_events.csv
outputs/portfolio_candidates.csv
outputs/portfolio_nav.csv
outputs/benchmark_nav.csv
outputs/universe_eligibility.csv
outputs/feature_coverage.csv
outputs/cluster_exposure.csv
reports/universe_data_quality_v0.md
reports/gen2_rule_baseline_report.md
manifests/gen2-exp-0001-rule-baseline-dev-universe-v0.json
```

---

## 5. 禁止事项

- 不训练 ML，不接 Qlib；
- 不修改 `HVT-A-ET-20260830`；
- 不修改 V3.6.1 Stage / Target / Risk / Cap；
- 不写生产 CloudBase；
- 不把 Top-N Rank 直接当 Portfolio；
- 不 Random Split；
- 不把 `dev_universe_v0` 当正式 25-35 只 Universe。
