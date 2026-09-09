# Gen-2 Rule V2 归档记录（Champion Baseline）

归档日期：2026-09-09（M0，协议 v0.4 APPROVED 后）。状态：**已冻结归档，任何后续不得改动**。

## 归档对象（全部 SHA 已由 verify-immutable.js 真锁锁死）

| 对象 | 标识 |
|---|---|
| `ml/gen2/manifests/GEN2_RULE_V2_BUNDLE.json` | bundle_version `gen2-rule-v2.0`，sha256 `1df81e33...`（GEN2_RULE_V2_LOCK 锁） |
| `ml/gen2/manifests/GEN2_RULE_V2_LOCK.json` | sealed 2026-09-08 |
| 资格判定报告 | `ml/gen2/reports/gen2_qualification_2026-09-08.md`（v3：WP9.2 + WP9.3A） |
| V2 经济基线 | `outputs/gen2_wp93a_econ.csv` / `gen2_wp93a_events.csv` / `gen2_wp93a_demotion.csv` |

## V2 冻结结论（2026-09-09 锁定）

```text
Promotion-Actionable Alpha   = CONDITIONAL PASS（+0.100 / 62.2%，740 日，WP9.2）
Stateful Economic Replay     = Economic Gate FAIL（§31 Case B，WP9.3A）
  vs Main5 PIT               bootstrap CI mean −0.00034/日 [−0.00088, +0.00017]
  Turnover                   147.2（vs Main5 12.5）
  Sharpe / MDD              0.482 / −23.4%
Role                         生产对照基线 Champion Baseline
Production Advisory / Effective   BLOCKED（永久红线不变）
```

## 归档语义

- V2 = **Champion Baseline**：Gen-2.1 一切对比的 frozen 参照，不得为其结果改写 V2 参数/阈值（真 SHA 锁 + CI 强制）。
- 后续研究迭代一律在 **V2.1 DRAFT → 新 freeze 版本链**（`GEN2_RULE_V21_DRAFT.json` → Freeze Point 生成 v2.1.0 BUNDLE+LOCK）进行；v2.1.x FAIL 后另开下一版本，**不得复用已观察的 Frozen 段**（协议 §2.2）。
- V2 相关数值报告如需引用，必须附带本归档记录与 manifest 数据身份声明。
