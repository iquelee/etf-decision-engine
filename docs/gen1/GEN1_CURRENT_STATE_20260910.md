# Gen-1 当前状态基线快照（G1-00）

**生成时间**：2026-09-10（WP-G1 Production Readiness 起点）
**用途**：证明本轮整改的对齐基线；任何与本文不一致的状态，禁止继续整改。

---

## 一、版本锚点

| 项 | 值 |
|---|---|
| git commit | `ede351fb5bb3c1a2888fb5d29cf7b74f603e3e73` |
| branch | `master`（整改分支 `feat/wp-g1-p1` 由此切出） |
| 生成时间戳 | 2026-09-10 Asia/Shanghai |
| Gen-1 model_id | `HVT-A-ET-20260830` |
| V3.6.1 engine version | `V3.6.1`（`runtime_status.production_engine`） |
| Gen-2 engine id | `gen2-rule-v2.1.0`（FROZEN，Gate-OFF；另见 PR #10） |

## 二、Artifact 哈希（P0-A 真 SHA 锁）

`node scripts/verify-immutable.js` → **11/11 PASS**（当前 master；V2.1 lock 在 PR #10）

| 文件 | sha256（LF 归一化） |
|---|---|
| `frozen-model.json` | `d5e667c66a5f888bb5489b8adcad9e6a141bfbcf0006a955d6ad40e269a7e712` |
| `frozen-manifest.json` | `30f5fe1c92e2e7be25e3c1b77f5c5dabd4ce3402ff6f4b712c2ae25cc2b0a5f0` |
| `frozen-node-inference.js` | `8e741912a7883d38f016ed234d091e2799cf56e28c41bfff208b373ec8c5b819` |

`python scripts/ml/assert-gen1-immutable.py` → **PASS: Gen-1 immutable ( HVT-A-ET-20260830 )**

## 三、CI 基线

`npm test` → **18/18 PASS**（Stage A Node 单测 / B Gen-2 Python / C Immutable 11 项 / D Parity 360 行 / E Secret scan / F Build parity）

---

## 四、权限现状（整改前）

| 维度 | 值 | 说明 |
|---|---|---|
| Gen-1 authority | **ADVISORY**（隐式） | 无显式状态机；由 `ml_shadow_observe` + `ml_advisory_enabled` 两个 boolean 表达 |
| Gen-1 execution authority | **false** | `ml_execution_enabled` 默认 false，但 `runtimeStatus` 直读 config（**未硬关**） |
| `final_target` authority | **V3.6.1** | `runDecisionEngine` 中 `ml_fast_path_enabled` 被硬编码 `false`，`ml_effective: false` |
| auto trading | **false** | 无券商接线 |
| `ml_effective` | **false** | 顶层与 mlMeta 双处冗余语义 |
| `ml_fast_path_enabled`（config 默认） | `true` | ⚠️ 配置层默认为 true，但运行时代码强制忽略（存在被误读为「已获生产权限」的风险） |

## 五、模型 / 特征契约

| 项 | 值 |
|---|---|
| model id | `HVT-A-ET-20260830` |
| threshold `signal_p` | `0.65`（**本轮禁止修改**） |
| abstain | `0.35` / `0.65` |
| features_core（15） | `ma20_slope, px_ma20, px_ma60, price_position, volume_ratio, sideway_days, sideway_range, consolidation_score, atr20, change_5d, bias_20d, breakout, ret_5d, ret_20d, rs_20d` |
| features_cat（5） | `w_state, d_state, h_state, v_state, sector` |
| feature schema hash | `sha256(features_core + features_cat)`，运行时由 `runGen1ShadowEod` 计算 |
| calibration | `CalibratedClassifierCV(method=isotonic, cv=3)`；capability = `UNPROVEN` |

## 六、Domain 覆盖现状

| ETF | sector | observed_folds | domain_status |
|---|---|---|---|
| 159570 | biotech | 3/3 | **IN_DOMAIN** |
| 513310 | storage | 2/3 | **PARTIAL_COVERAGE** |
| 515880 | ai_network | 2/3 | **PARTIAL_COVERAGE** |
| 159582 | semi_equip | 2/3 | **PARTIAL_COVERAGE** |
| 518880 | gold | 0/3 | **OUT_OF_DOMAIN** |

> 整改前 domain_status 仅为展示元数据，**不影响**任何权限判断。

## 七、运行开关现状

| 开关 | 默认 | 现状 |
|---|---|---|
| `ml_shadow_observe` | true | 观察开 |
| `ml_advisory_enabled` | true | 人工建议开 |
| `ml_fast_path_enabled` | true | ⚠️ 配置默认 true，但运行时代码忽略 |
| `ml_execution_enabled` | false | ⚠️ `runtimeStatus` 直读 config，未硬关 |
| `ml_challenger_model_id` | `HVT-A-ET-20260830` | 冻结 |
| `ml_gen1_frozen` | true | 冻结 |

`FROZEN_PARAM_KEYS`（后台禁改）：`volume_ratio_mild, tech_sector_max, ml_fast_path_enabled, ml_challenger_model_id, ml_gen1_frozen, ml_shadow_bundle_id`

## 八、已知缺口（WP-G1 待修）

1. **G1-02**：`gen1RulePermission()` 已实现但**从未被 runDecisionEngine 调用**；主链字段 `rule_permission_source` 仍为 `EOD_STAGE_PRECHECK`，未升级为 `SAFETY_CORE`。
2. **G1-01**：无显式 `gen1_authority` 状态机。
3. **G1-03**：无 canary counterfactual 路径（`ml_counterfactual_target` 仅存在于 signal 行，未走「重跑 V3.6.1 + clamp」）。
4. **G1-04**：feature pipeline 无 immutable hash。
5. **G1-05**：`510300` benchmark 缺失时 `officialBars('510300').catch(() => [])` → `rs_20d = null` 静默继续（**未 fail closed**）。
6. **G1-06**：domain_status 不影响权限。
7. **G1-07**：circuit breaker 无 runtime gate。
8. **G1-08**：无 Python↔Node golden parity。
9. **G1-09**：execution 未硬关（config 可被置 true）。
10. **G1-10**：Gen-1 Health 页面缺若干字段。
11. **G1-11**：无 Gen-1 专属 CI gates（含 Production No-op）。

---

## 九、一致性断言（不满足即 STOP）

```text
Gen-1 model          = HVT-A-ET-20260830        ✅
Gen-1 model immutable= PASS                     ✅
final_target authority = V3.6.1                 ✅
ml_effective         = false                    ✅
ml_execution_enabled = false                    ✅
auto trading         = false                    ✅
threshold signal_p   = 0.65（未改）             ✅
```

以上全部满足 → 允许继续整改。

---

# 附录 A：整改后状态（WP-G1 → WP-G1.1 → WP-G1.2，2026-09-10）

> 上文的「整改前」快照保留作审计基线。以下是当前实际状态。

## A.1 权限现状（当前）

| 维度 | 值 |
|---|---|
| Gen-1 authority | **ADVISORY**（显式状态机 `gen1-authority.js`；`gen1_authority` 走 `param_config`，可逆单字段） |
| 状态机 | `OFF / SHADOW / ADVISORY / CANARY / PRODUCTION`（**PRODUCTION 永久锁定**） |
| `production_write` | **恒 false** |
| `auto_execution` | **恒 false**（`ml_execution_enabled=true` 也无法开启，另记审计） |
| `final_target` authority | **V3.6.1**（Gen-1 只产 `gen1_canary_*` 反事实，运行期 `verifyProductionNoop` 强制校验） |
| Safety source | `SAFETY_CORE`（由 `runDecisionEngine` 真产出） |
| 三层权限语义 | `model_candidate`（S2 严格 + ml_fast + P≥0.65 + model_id 精确）→ `safety`（规则允许）→ `effective_*`（AND 数据/域/健康/authority） |

## A.2 健康状态（WP-G1.2 后为唯一真相）

| 读取结果 | 运行时门 | 允许 ADVISORY | 允许 CANARY | 落库 |
|---|---|---|---|---|
| `FOUND` | `ACTIVE` | 按 latch | 按 latch | 是 |
| `NOT_INITIALIZED` | `PENDING` | ✅ | ❌ | 否 |
| `READ_ERROR` | `READ_ERROR`（= ML_OFF） | ❌ | ❌ | **否**（绝不伪造 OK） |

- 权限链**唯一**消费 `healthStateToGate()`；`ml_shadow_signal.gen1_health_status` 降级为审计快照。
- latch 集合 `gen1_health_state`（单文档 `key='gen1-health-state'`），跨 CloudBase 冷启动保持，DEGRADED/ML_OFF 须人工复核才可恢复。

## A.3 组合占用（唯一算法）

`sectorOccupation(current, suggested, target)` —— 生产与 Canary 共用；
`canarySectorUsed` 种子 = `portfolio.tech_position`，`limit = max(0, cap − (used − current))` 与生产同式。

## A.4 独立事件口径

`event_cluster_id` 去重 + **真实交易日历** 40D 间隔（无日历时 1.5× 自然日保守阈值，显式标注 `gap_basis`）。

## A.5 门禁

`npm test` → **35/35**；Gen-1 Production Gates **G1-A~Q 17/17**；Immutable 11/11；Pipeline Lock 10/10（frozen 管线文件零改动）。

## A.6 当前裁决

```text
ADVISORY_PRODUCTION              PASS
COUNTERFACTUAL_CANARY（工程）     PASS（待最终 review 后由 param_config 开启）
CANARY_ECONOMIC_GATE             FAIL / INSUFFICIENT（3 簇 / 2 独立事件；BULL=0；无 IN_DOMAIN 事件）
LIMITED / FULL PRODUCTION        BLOCKED（缺 Economic Health 自动闭环 + 经济样本）
AUTO TRADING                     OFF
threshold signal_p = 0.65（未改）
Gen-1 frozen model（未改，SHA d5e667c6…）
```

