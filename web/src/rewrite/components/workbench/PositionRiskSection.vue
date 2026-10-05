<script setup>
/**
 * 仓位与风险区（web/src/rewrite/components/workbench/PositionRiskSection.vue）
 * 规范依据：M4-P0 §F.3（同名不同义 7 例）＋ 用户 M4-P1 指令
 *          ＋ owner 裁定 M5-P1（2026-10-01）· Single-Source Display
 *
 * ★★ 本区存在的**唯一理由**：把三个**不同轴**的仓位数字分开，⛔ 不放进同一个无标签卡。
 *   实测（513310 / 2026-09-29）：
 *     · `decision.core_position = 0.2`   ← **建议**（本次决策）
 *     · `position.core_position = 12.6`  ← **实际**（账户真实持仓）   ⇒ 相差 63×
 *     · `decision.target_min/std/max = 0.4 / 0.5 / 0.5` ← 本次决策带
 *     · `position.target_min/std/max = 20 / 25 / 30`    ← 配置标准带（etf_basic）
 *
 * ★ 禁止 1：⛔ 不重算 gap / 不重算防守分 / 不重算防守等级 / 不重算 final target。
 *
 * ★ M5-P1（Single-Source）本区**主位**：仓位缺口 `position_gap`、建议仓位、目标带、
 *   配置标准、仓位上限。
 *   ⇒ 原「风险」子块（风险等级 / 溢价状态 / 溢价率 / 风险事件）**已移除** ——
 *     它们的主位在「正式决策」（`risk_flag`）、「防守雷达」（`premium_*` / `over_alloc_status`）、
 *     「情报 / 基本面」（`risk_events`）；本区只保留 `risk_flag` 的**引用位**。
 */
import SectionHeader from '../SectionHeader.vue';
import FieldValue from '../domain/FieldValue.vue';
import Fact from '../domain/Fact.vue';
import { FACT, OWNER } from '../../domain/ownership.js';

defineProps({
  decision: { type: Object, required: true },
  position: { type: Object, required: true },
  risk: { type: Object, required: true },
  identity: { type: Object, required: true },
  boundaries: { type: Object, required: true }
});
</script>

<template>
  <section class="section prio-position">
    <SectionHeader
      eyebrow="仓位与风险"
      title="实际 / 建议 / 目标（三个不同轴）"
      subtitle="本区刻意分区显示：同名数字在 decision 与 position 两块中语义不同，⛔ 不得合并。"
    />

    <p class="state-sub mb-3">{{ boundaries.positionRiskScopeNote }}</p>

    <div class="pos-grid">
      <!-- ① 实际持仓（position 块） -->
      <div class="pos-card">
        <div class="pos-card-head">
          <span class="pos-card-kind">{{ position.kindLabel }}</span>
          <span class="pos-card-src">position 块</span>
        </div>
        <div class="pos-card-note">{{ position.kindNote }}</div>
        <div class="pos-card-main">
          <div class="pos-num" :class="{ 'is-missing': position.currentPositionText.missing }">
            <Fact :fact="FACT.ACTUAL_POSITION">{{ position.currentPositionText.text }}</Fact>
          </div>
          <div class="pos-num-label">当前仓位</div>
        </div>
        <div class="kv-grid">
          <div class="kv"><span class="kv-k">核心（实际）</span><span class="kv-v">{{ position.realCoreText.text }}</span></div>
          <div class="kv"><span class="kv-k">交易（实际）</span><span class="kv-v">{{ position.realTradeText.text }}</span></div>
          <div class="kv"><span class="kv-k">份额</span><span class="kv-v"><FieldValue :d="position.sharesText" /></span></div>
          <div class="kv"><span class="kv-k">成本价</span><span class="kv-v"><FieldValue :d="position.avgCostText" /></span></div>
        </div>
      </div>

      <!-- ② 本次建议与目标（decision 块）★ 仓位缺口的主位在本卡 -->
      <div class="pos-card">
        <div class="pos-card-head">
          <span class="pos-card-kind">{{ boundaries.positionKinds.suggested }}</span>
          <span class="pos-card-src">decision 块</span>
        </div>
        <div class="pos-card-note">{{ boundaries.positionKindNotes.suggested }}</div>
        <div class="pos-card-main">
          <div class="pos-num" :class="{ 'is-missing': decision.finalTargetText.missing }">
            <Fact :fact="FACT.FINAL_TARGET" role="ref" :ref-to="OWNER.PRIMARY_DECISION">{{ decision.finalTargetText.text }}</Fact>
          </div>
          <div class="pos-num-label">最终目标</div>
        </div>
        <div class="kv-grid">
          <div class="kv"><span class="kv-k">建议核心</span><span class="kv-v">{{ decision.suggestedCoreText.text }}</span></div>
          <div class="kv"><span class="kv-k">建议交易</span><span class="kv-v">{{ decision.suggestedTradeText.text }}</span></div>
          <div class="kv">
            <span class="kv-k">建议仓位</span>
            <span class="kv-v"><Fact :fact="FACT.SUGGESTED_POSITION"><FieldValue :d="decision.suggestedPositionText" /></Fact></span>
          </div>
          <div class="kv">
            <span class="kv-k">决策目标带</span>
            <span class="kv-v"><Fact :fact="FACT.TARGET_BAND">{{ decision.targetBand.rangeText }}</Fact></span>
          </div>
        </div>
        <!-- ★ M5-P1：仓位缺口的**主位**（「正式决策」区只作引用位） -->
        <div class="kv-grid mt-2">
          <div class="kv">
            <span class="kv-k">仓位缺口（正式决策值）</span>
            <span class="kv-v">
              <Fact :fact="FACT.POSITION_GAP">
                {{ decision.gapText.text }}
                <span class="text-11" style="color:var(--c-text-3)"> · {{ decision.gapNote }}</span>
              </Fact>
            </span>
          </div>
        </div>
      </div>

      <!-- ③ 配置标准（position/basic 块） -->
      <div class="pos-card">
        <div class="pos-card-head">
          <span class="pos-card-kind">{{ position.configBand.kindLabel }}</span>
          <span class="pos-card-src">position / basic 块</span>
        </div>
        <div class="pos-card-note">{{ position.configBand.kindNote }}</div>
        <div class="pos-card-main">
          <div class="pos-num" :class="{ 'is-missing': position.configBand.stdText.missing }">
            {{ position.configBand.stdText.text }}
          </div>
          <div class="pos-num-label">配置标准目标</div>
        </div>
        <div class="kv-grid">
          <div class="kv"><span class="kv-k">配置带</span><span class="kv-v">{{ position.configBand.rangeText }}</span></div>
          <div class="kv"><span class="kv-k">仓位上限</span><span class="kv-v"><Fact :fact="FACT.MAX_POSITION"><FieldValue :d="position.maxPositionText" /></Fact></span></div>
          <div class="kv"><span class="kv-k">战略上限</span><span class="kv-v"><FieldValue :d="position.maxStrategicText" /></span></div>
          <div class="kv">
            <span class="kv-k">标的配置目标</span>
            <span class="kv-v"><Fact :fact="FACT.CONFIG_TARGET"><FieldValue :d="identity.configTargetText" /></Fact></span>
          </div>
        </div>
      </div>
    </div>

    <p class="state-sub mt-2">{{ boundaries.noRecomputeNote }}</p>

    <hr class="divider" />

    <!-- ★ M5-P1：风险族**不在本区展开**（各自有主位）⇒ 此处只给引用位，⛔ 不形成第二套风险结论 -->
    <p class="state-sub">
      风险旗标：
      <Fact :fact="FACT.RISK_FLAG" role="ref" :ref-to="OWNER.PRIMARY_DECISION">{{ risk.flagText }}</Fact>
    </p>
  </section>
</template>
