# Gen-2 P1：Rule V2 结构重构 A/B 报告

> ⚠️ **旧角色语义审计基线 —— 不可与新结果逐位比较**
>
> 本报告产生于 PR #24 之前：角色语义来自旧实现（缺 NO_CORE 硬门槛与 Selection Permission），
> 回测账本为旧口径（现金腿被计入换手，持有现金缓冲的策略费用最多高估 2 倍）。
> 仅作**审计基线**留存；**不得**用于继续宣称 Rule V2 的经济表现。
> 新基线见 `ml/gen2/reports/gen2_b1_ledger_baseline_20260911.md`（WP-G2-02 / B1，唯一权威角色语义 + 唯一权威账本）。


**日期**：2026-09-05
**范围**：Selection Engine 重构（Alpha/Utility 分离 + Selection Permission + NO_CORE + label vs market）
**核心结论**：**把「找赢家」和「控风险」拆开后，选池信号 Rank IC 从 0.0023 提升到 0.0414（约 18 倍），Top-Bottom spread 由负翻正——结构重构方向正确。**

---

## 一、P1 实现内容

| 模块 | 说明 |
|---|---|
| `baseline/alpha_score.py` | `AlphaScore-v2` = Trend+RS+Breakout 等权（只回答「谁更强」）；`UtilityScore-v2` = Vol/Diversification/Liquidity（只用于「强者里谁适合一起拿」） |
| `portfolio/selection_permission.py` | 市场状态 → Selection 模式：RISK_ON=ACTIVE(5 CORE) / RANGE=REDUCED(3) / RISK_OFF=DISABLED(0) |
| `labels/build_labels.py` | 新增 `label_v2_excess_vs_market_20d`（ETF vs 510300，Universe 换不改目标函数；y_leader = 绝对超额>0 而非相对排名前 20%） |
| `baseline/rule_v2_ab.py` | A/B 对比脚本（信号层 IC + 分 regime + 组合层回测） |

---

## 二、信号层 A/B（核心结论）

| 指标 | V1 composite | V2 alpha | 变化 |
|---|---:|---:|---|
| Rank IC mean（20D） | 0.0023 | **0.0414** | **+18 倍** |
| IC > 0 占比 | 50.8% | **53.6%** | +2.8pp |
| Top-Bottom 20D spread | -0.29% | **+0.58%** | **翻正** |

**铁证：V1 的 Leadership Score 把正 IC 的 Alpha 因子（RS/Breakout/Trend）和负 IC 的风险因子（Vol/Diversification/Stage/Consolidation）混在一起，互相抵消成 IC≈0。拆开后只保留 Alpha 因子，IC 提升 18 倍、spread 翻正。**

## 三、分 regime Rank IC（vs market label）

| regime | V1 composite | V2 alpha |
|---|---:|---:|
| RISK_ON | +0.075 | **+0.122** |
| RANGE | +0.016 | **+0.082** |
| RISK_OFF | -0.083 | -0.059 |

**V2 alpha 在每个 regime 都优于 V1**，尤其 RISK_ON（+0.122）和 RANGE（+0.082）显著为正。但 **RISK_OFF 仍为负（-0.059）**——即便拆开 Alpha，熊市里「相对强弱」仍会反选。这坐实了 `Selection Permission` 的必要性：RISK_OFF 必须关闭进攻性 Ranking。

## 四、组合层经济指标（T+1 收盘执行，10bps）

| 策略 | 累计 | Sharpe | MDD | 总换手 |
|---|---:|---:|---:|---:|
| Main5 PIT 等权 | +183.5% | 0.75 | -45.8% | 3.6 |
| Rule V2（无防守） | +40.7% | 0.29 | -42.4% | 658 |
| Rule V2 + 防守 | +58.4% | 0.37 | -30.2% | 600 |

**诚实结论：组合层还没跟上信号层的提升。** 原因有二：
1. **换手过高（600+ 次）**：V2 角色每天按 alpha 前 20% 重选 CORE、无 persistence 滞后，CORE 成员频繁更替，10bps 成本被换手吃掉。V1 有 promotion/demotion 5 天滞后（换手 228），V2 当前没有。
2. **组合构建太简**：只是「alpha 前 20% 等权」，尚未接 Cluster 约束 / Portfolio Utility / Replacement。

信号层证明「选得对」（IC 0.0414），但「拿得住」（persistence + utility + rotation）还没建。

## 五、P1 后半段：persistence 滞后 + Selection Permission 落地

给 V2 补上完整角色状态机（promotion/demotion 5 天滞后 + DISABLED 关闭进攻 + NO_CORE 趋势闸门 + cluster cap），换手与回撤显著改善：

| 组合指标（10bps） | V2 简化版（无滞后） | V2 完整版（+persistence+Permission） |
|---|---:|---:|
| 总换手 | 600 | **327**（-45%） |
| MDD | -30.2% | **-26.9%** |
| 累计收益 | +58.4% | +45.4% |
| Sharpe | 0.37 | 0.33 |

**三个改进都符合预期**：persistence 压换手、DISABLED（RISK_OFF 空仓）+ NO_CORE 压回撤。但**收益同步下降**——promotion 滞后错过部分强势标的早期涨幅、RISK_OFF 空仓错过抄底。

**关键洞察：V2 的风险控制已超过 Main5（MDD -26.9% vs -45.8%），但收益不足（+45% vs +183%）。** 这是「信号好（IC 0.0414）但组合赚不够」的核心矛盾。

## 六、结论与下一步

**P1 已完成：信号层问题解决（IC 0.0414）+ 组合层拿得住（换手 327、回撤 -26.9%），但「赚得够」未解决（Sharpe 0.33 vs Main5 0.75，收益 +45% vs +183%）。**

剩余根因（指向 P1 更深层 / P2）：

1. **收益不足的根因待定位**：V2 选的「alpha 前 20%」在 30 只里绝对收益不足——需要拆开看是「选池信号」还是「Cluster 重复污染」（tech_hardware 7 只 / 软件 3 只拉低有效多样性）导致；
2. **两级选择（Cluster Leadership → ETF Selection）**：先选「钱该去哪类资产」，再选「哪个 ETF 表达」，可能比「30 只直选」更有效；
3. **Portfolio Utility 接仓位**：Vol/Diversification/Liquidity 用于 cluster 约束与仓位（而非排名），让组合更稳健；
4. **V2 换手仍 327（vs V1 228）**：alpha 信号更灵敏，可能需要更强的 promotion/demotion 滞后或 turnover 约束。

在 Economic Gate 通过（V2 vs Main5 PIT vs Universe EW vs V3.6.1 Replay）之前，不接生产、不进 Qlib。

---

## 输出文件

- `outputs/rule_v2_ab_backtest.csv`、`rule_v2_roles.csv`
- 新增 `baseline/alpha_score.py`、`portfolio/selection_permission.py`、`baseline/rule_v2_ab.py`
- label 新增 `build_labels_vs_market`
