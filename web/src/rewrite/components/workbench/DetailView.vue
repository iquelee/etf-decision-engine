<script setup>
/**
 * ETF 工作台视图（web/src/rewrite/components/workbench/DetailView.vue）
 * 规范依据：owner 裁定的 M4-P1 IA（2026-09-30）
 *
 * ★ IA（自上而下，视觉权重递减）
 *   ① Header        标的身份 · 价格 · 快照日 · 决策日 · 新鲜度
 *   ② K 线滞后提示   （仅严重滞后时出现；⛔ 与决策新鲜度无关）
 *   ③ PrimaryDecision ★ 全页最高权威（V3 Safety Core）
 *   ④ Position / Risk 实际 / 建议 / 目标 三轴严格分区
 *   ⑤ Gen-1 Advisory  ★ 明确降权（TIMING / ADVISORY + Legacy Channel）
 *   ⑥ K 线           图表保留 + 时点标注
 *   ⑦ Structure      结构识别
 *   ⑧ Fundamentals   仅摘要（⛔ 不搬 fundamental_config / fundamental_series）
 *   ⑨ Data Quality   新鲜度 / 来源 / 缺什么
 *
 * ★ 本组件 ⛔ 不含任何业务规则、⛔ 不触 api / adapters（layering test 守卫）。
 *   一切数值与文案均来自 `vm`。
 */
import WorkbenchHeader from './WorkbenchHeader.vue';
import StaleBanner from './StaleBanner.vue';
import PrimaryDecision from './PrimaryDecision.vue';
import PositionRiskSection from './PositionRiskSection.vue';
import Gen1AdvisorySection from './Gen1AdvisorySection.vue';
import KlineSection from './KlineSection.vue';
import StructureSection from './StructureSection.vue';
import WorkbenchDataQuality from './WorkbenchDataQuality.vue';
import SectionHeader from '../SectionHeader.vue';
import FieldValue from '../domain/FieldValue.vue';

defineProps({
  /** `adaptEtfDetail()` 的完整输出 */
  vm: { type: Object, required: true }
});
</script>

<template>
  <div class="page wb">
    <WorkbenchHeader
      :identity="vm.identity"
      :price="vm.price"
      :decision="vm.decision"
      :freshness="vm.freshness"
      :kline="vm.kline"
    />

    <StaleBanner
      :banner="vm.kline.banner"
      :status-label="vm.kline.statusLabel"
      :keep-note="vm.kline.keepNote"
      :decision-freshness-text="vm.kline.decisionFreshnessText"
    />

    <PrimaryDecision :decision="vm.decision" :risk="vm.risk" :boundaries="vm.boundaries" />

    <PositionRiskSection
      :decision="vm.decision"
      :position="vm.position"
      :risk="vm.risk"
      :identity="vm.identity"
      :boundaries="vm.boundaries"
    />

    <!-- ★ 降权：Gen-1 在正式决策之后，且自带身份与通道角标 -->
    <Gen1AdvisorySection :gen1="vm.gen1Detail" />

    <KlineSection :kline="vm.kline" :code="vm.identity.codeText" />

    <StructureSection :structure="vm.structure" :price="vm.price" />

    <!-- 基本面：**仅摘要** -->
    <section class="section">
      <SectionHeader
        eyebrow="基本面"
        title="摘要"
        :subtitle="vm.fundamentalsSummary.deepDetailNote"
      />
      <div class="kv-grid">
        <div class="kv"><span class="kv-k">基本面状态</span><span class="kv-v">{{ vm.fundamentalsSummary.fStateText }}</span></div>
        <div class="kv"><span class="kv-k">基本面评分</span><span class="kv-v"><FieldValue :d="vm.fundamentalsSummary.fScoreText" /></span></div>
        <div class="kv"><span class="kv-k">更新时间</span><span class="kv-v"><FieldValue :d="vm.fundamentalsSummary.updatedAtText" /></span></div>
      </div>
    </section>

    <WorkbenchDataQuality :vm="vm" />
  </div>
</template>
