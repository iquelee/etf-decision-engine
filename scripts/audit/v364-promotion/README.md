# Gate P-B 重放审计 —— 可复现说明

本目录是 **V3.6.4 Production Promotion Qualification** 的重放审计工具与垫片。
配套报告：`docs/V364_PRODUCTION_PROMOTION_QUALIFICATION.md`、`docs/V364_INDICATOR_PIPELINE_PROVENANCE.md`。

> ⚠️ **审计工具，不参与生产运行时。** 不被任何云函数引用，不被 `npm test` 执行（不在 `tests/`）。
> 位于 `scripts/audit/` 下，仅用于人工复核。

---

## 1. 为什么要两个源码根

Gate P-B 要求 OLD 必须是**当前线上 V3.6.1 部署件的真实语义**，而不是泛泛的旧 repo commit。
因此 OLD 从**线上 `runDecisionEngine` 包**（部署 2026-09-17 14:24:41）解压得到，
NEW 从**冻结 commit** `aa634e26…`（tag `v3.6.4-frozen^{}`）取出。

两个根必须是**各自自洽的完整源码树**（各带自己的 `src/common/**`），
重放 harness 才能分别加载该根自己的决策链。

## 2. 垫片（`shims/`）—— 必须存在的理由

重放 harness `scripts/lib/v364-replay-harness.js` 在 V3.6.4 期编写，它 `require` 了两个
**只有新树才有的文件**：

| 垫片 | 为什么旧树需要它 | 语义（为何与生产逐位一致） |
|---|---|---|
| `swing-structure.js` | V3.6.1 生产树**没有**这个文件 | 委托给**该树自己的** `trend-stage.swingHighLow`，后者只返回 `{higherLow, lowerHigh}` —— **没有 `lowerLow` 属性** ⇒ 与历史生产「`lowerLow` 恒假」逐位一致 |
| `trade-date-idempotence.js` | 它是 R1 新增的**调用侧接缝**，生产当时不存在 | `planRunInput(state) → { engine_state: state, replaying: false }`（**直通**）、`finalizeState(x) → x`（**恒等**）⇒ 与生产 `trend-stage` 状态原样进出逐位一致 |

**保真性可断言**（应输出两条 true）：

```bash
node -e "const s=require('./shims/swing-structure.js');const t=require('./shims/trade-date-idempotence.js');
const b=Array.from({length:14},(_,i)=>({high:200-i*2,low:190-i*2}));
console.log(s.swingHighLow(b).lowerLow===undefined);
const st={x:1};console.log(t.planRunInput(st).engine_state===st);"
```

## 3. 重建工作目录

```bash
WORK=<工作目录>          # 建议放在仓库外，例如 ../.v364-audit-work
mkdir -p $WORK/old/src $WORK/new/src $WORK/mi/src

# OLD = 线上 runDecisionEngine 包（2026-09-17）的 common/**
#   下载方式：CloudBase getFunctionDownloadUrl + unzip，校验本地 sha256 == API CodeSha256
cp -r <online-runDecisionEngine>/common          $WORK/old/src/common
cp shims/swing-structure.js shims/trade-date-idempotence.js  $WORK/old/src/common/utils/

# NEW = 冻结 commit
git archive aa634e264270f26207c59c19ef3e1c31dde01e64 src/common | tar -x -C $WORK/new

# MI = 线上 materializeIndicators 包（2026-09-08）的 common/**（P-A 对照用）
cp -r <online-materializeIndicators>/common      $WORK/mi/src/common

# 每个根还需要：deliverables/etf_daily_ml_pool/*.csv 与 scripts/lib/v364-replay-harness.js
for r in old new mi; do
  mkdir -p $WORK/$r/deliverables $WORK/$r/scripts/lib
  cp -r <repo>/deliverables/etf_daily_ml_pool $WORK/$r/deliverables/
  cp <repo>/scripts/lib/v364-replay-harness.js $WORK/$r/scripts/lib/
done
```

`cf-breakout-nd` 反事实根 = 复制 `new` 为 `new-bnd`，并在其 harness 的
`LIVE_SNAPSHOT_FIELDS` 集合里**加回** `'breakout_nd'`（其余不动）。

## 4. 复跑

```bash
export V364_PB_DIR=<工作目录>

# 4.1 字段集合探针（P-A 决定性问题：某棵树 computeSnapshot 到底返回哪些键）
for r in old new mi; do node probe-keys.js $V364_PB_DIR/$r; done

# 4.2 四组重放
node pb-driver.js $V364_PB_DIR/old     1 $V364_PB_DIR/old-r1.json
node pb-driver.js $V364_PB_DIR/new     1 $V364_PB_DIR/new-r1.json
node pb-driver.js $V364_PB_DIR/old     3 $V364_PB_DIR/old-r3.json
node pb-driver.js $V364_PB_DIR/new     3 $V364_PB_DIR/new-r3.json
node pb-driver.js $V364_PB_DIR/new-bnd 1 $V364_PB_DIR/new-bnd-r1.json   # 反事实

# 4.3 分类与统计
node pb-diff.js       # 主 replay 分类 + 同日压力 → $V364_PB_DIR/pb-diff.json
node state-audit.js   # NEW 的 day-end state 差异是否仅审计字段
node cf-diff.js       # breakout_nd 反事实（⚠️ 仅严重度判断，不混入主 Gate）
```

## 5. 分类规则

`pb-diff.js` 文件头即分类规则**声明处**，规则在**执行前**写定，**不得**事后调整：

- `INTENDED_CORRECTNESS_CHANGE`
  - **I1** 同日重复运行漂移（缺陷 #1）——仅体现在 `runsPerDay=3` 的日内比较
  - **I2** SlowBreak 链 swing 修复（缺陷 #2）——`slow_break_score` / `slow_break_high`，
    以及仅当同票同日 `slow_break_*` 同时变化时的 `defense_score` / `defense_penalty`
- `DIAGNOSTIC_ONLY` —— 只读诊断字段（本比较集内无）
- `UNEXPECTED_CHANGE` —— 其余一切；**计数 > 0 ⇒ Promotion Gate = FAIL**

## 6. 已知边界

- 两个根都按线上 `indicator_snapshot` 的**真实 31 字段**裁剪输入（harness 的 `LIVE_SNAPSHOT_FIELDS`，
  已实测 `== S_db == 线上 mI 产出集`），实测 `dropped = ["breakout_nd"]`。
- harness 对 `position` / `fundamental` / `risk` 使用常量（两变体相同）⇒ 不影响 OLD/NEW 差异结论，
  但不代表真实资金/基本面路径。`premium_rate` 未注入。
- 账面从 0 自洽滚动；未注入真实持仓。
