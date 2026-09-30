<script setup>
/**
 * 仓位与风险区（web/src/rewrite/components/workbench/PositionRiskSection.vue）
 * 规范依据：M4-P0 §F.3（同名不同义 7 例）＋ 用户 M4-P1 指令
 *
 * ★★ 本区存在的**唯一理由**：把三个**不同轴**的仓位数字分开，⛔ 不放进同一个无标签卡。
 *   实测（513310 / 2026-09-29）：
 *     · `decision.core_position = 0.2`   ← **建议**（本次决策）
 *     · `position.core_position = 12.6`  ← **实际**（账户真实持仓）   ⇒ 相差 63×
 *     · `decision.target_min/std/max = 0.4 / 0.5 / 0.5` ← 本次决策带
 *     · `position.target_min/std/max = 20 / 25 / 30`    ← 配置标准带（etf_basic）
 *
 * ★ 禁止 1：⛔ 不重算 gap / 不重算防守分 / 不重算防守等级 / 不重算 final target。
 */
import SectionHeader from '../SectionHeader.vue';
import FieldValue from '../domain/FieldValue.vue';
import ToneBadge from '../domain/ToneBadge.vue';

defineProps({
  decision: { type: Object, required: true },
  position: { type: Object, required: true },
  risk: { type: Object, required: true },
  identity: { type: Object, required: true },
  boundaries: { type: Object, required: true }
});
</script>

<template>
  <section class="section">
    <SectionHeader
      eyebrow="仓位与风险"
      title="实际 / 建议 / 目标（三个不同轴）"
      subtitle="本区刻意分区显示：同名数字在 decision 与 position 两块中语义不同，⛔ 不得合并。"
    />

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
            {{ position.currentPositionText.text }}
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

      <!-- ② 本次建议与目标（decision 块） -->
      <div class="pos-card">
        <div class="pos-card-head">
          <span class="pos-card-kind">{{ boundaries.positionKinds.suggested }}</span>
          <span class="pos-card-src">decision 块</span>
        </div>
        <div class="pos-card-note">{{ boundaries.positionKindNotes.suggested }}</div>
        <div class="pos-card-main">
          <div class="pos-num" :class="{ 'is-missing': decision.finalTargetText.missing }">
            {{ decision.finalTargetText.text }}
          </div>
          <div class="pos-num-label">最终目标</div>
        </div>
        <div class="kv-grid">
          <div class="kv"><span class="kv-k">建议核心</span><span class="kv-v">{{ decision.suggestedCoreText.text }}</span></div>
          <div class="kv"><span class="kv-k">建议交易</span><span class="kv-v">{{ decision.suggestedTradeText.text }}</span></div>
          <div class="kv"><span class="kv-k">建议仓位</span><span class="kv-v"><FieldValue :d="decision.suggestedPositionText" /></span></div>
          <div class="kv"><span class="kv-k">决策目标带</span><span class="kv-v">{{ decision.targetBand.rangeText }}</span></div>
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
          <div class="kv"><span class="kv-k">仓位上限</span><span class="kv-v"><FieldValue :d="position.maxPositionText" /></span></div>
          <div class="kv"><span class="kv-k">战略上限</span><span class="kv-v"><FieldValue :d="position.maxStrategicText" /></span></div>
          <div class="kv"><span class="kv-k">标的配置目标</span><span class="kv-v"><FieldValue :d="identity.configTargetText" /></span></div>
        </div>
      </div>
    </div>

    <p class="state-sub mt-2">{{ boundaries.noRecomputeNote }}</p>

    <hr class="divider" />

    <div class="section-head" style="margin-bottom:8px">
      <div>
        <div class="section-title">风险</div>
        <div class="section-sub">风险旗标为英/中混用枚举，已统一归一（⛔ 不假设语言）。</div>
      </div>
      <ToneBadge :text="risk.flagText" :tone="risk.tone" dot />
    </div>

    <div class="kv-grid">
      <div class="kv">
        <span class="kv-k">风险等级</span>
        <span class="kv-v"><ToneBadge :text="risk.flagText" :tone="risk.tone" small /></span>
      </div>
      <div class="kv"><span class="kv-k">人工覆盖</span><span class="kv-v">{{ risk.overrideText }}</span></div>
      <div class="kv"><span class="kv-k">溢价状态</span><span class="kv-v"><ToneBadge :text="risk.premiumText" :tone="risk.premiumTone" small /></span></div>
      <div class="kv"><span class="kv-k">溢价率</span><span class="kv-v"><FieldValue :d="risk.premiumRateText" /></span></div>
    </div>

    <div v-if="!risk.hasEvents" class="state-sub mt-2">
      风险事件：<b>无</b>
      <template v-if="risk.eventsState !== 'PROVIDED'">（该字段{{ risk.eventsState === 'MISSING' ? '缺失' : '未提供' }}，已按无事件处理并标注）</template>
    </div>
    <ul v-else class="block-list mt-2">
      <li v-for="e in risk.events" :key="(e.id && e.id.value) || e.triggerTime.value">
        <b>{{ e.reason.value || '（无原因）' }}</b>
        <span class="text-11" style="color:var(--c-text-3)"> · {{ e.riskFlag.value }} · {{ e.triggerTime.value }}</span>
      </li>
    </ul>
  </section>
</template>
