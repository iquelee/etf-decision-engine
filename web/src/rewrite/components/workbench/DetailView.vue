<script setup>
/**
 * ETF 工作台视图（web/src/rewrite/components/workbench/DetailView.vue）
 * 规范依据：owner 裁定的 M4-P1 IA（第一阶段 §二 ＋ 第二阶段 §二）
 *
 * ★ IA（自上而下，视觉权重**分档**，⛔ 不得退化成"一长串等重卡片"）
 *   ┌ ① Header              标的身份 · 价格 · 快照日 · 决策日 · 新鲜度
 *   ├ ② K 线滞后提示        （仅严重滞后时出现；⛔ 与决策新鲜度无关）
 *   ├ ③ PrimaryDecision     ★★ 第 1 档 · Formal Decision（V3 Safety Core）
 *   ├ ④ PositionRiskSection    第 3 档 · Position（实际 / 建议 / 目标 / 配置 四轴）
 *   ├ ⑤ OpportunityRadar        第 4 档 · Advisory（辅助信号，⛔ 不是加仓建议）
 *   ├ ⑥ DefenseRadar            ★ 第 2 档 · Risk / Defense（后端已算，⛔ 不重算）
 *   ├ ⑦ Gen1AdvisorySection     第 4 档 · Advisory（★ 明确降权）
 *   ├ ⑧ KlineSection            第 5 档 · Evidence
 *   ├ ⑨ StructureSection        第 5 档 · Evidence
 *   ├ ⑩ IntelligenceSection     第 5 档 · Evidence（基本面摘要 / 事件）
 *   ├ ⑪ DecisionHistorySection  第 6 档 · History（★ 最弱；⛔ 不伪造）
 *   └ ⑫ WorkbenchDataQuality    第 5 档 · Provenance
 *
 * ★ 本组件 ⛔ 不含任何业务规则、⛔ 不触 api / adapters（layering test 守卫）。
 *   一切数值与文案均来自 `vm`。
 */
import WorkbenchHeader from './WorkbenchHeader.vue';
import StaleBanner from './StaleBanner.vue';
import PrimaryDecision from './PrimaryDecision.vue';
import PositionRiskSection from './PositionRiskSection.vue';
import OpportunityRadar from './OpportunityRadar.vue';
import DefenseRadar from './DefenseRadar.vue';
import Gen1AdvisorySection from './Gen1AdvisorySection.vue';
import KlineSection from './KlineSection.vue';
import StructureSection from './StructureSection.vue';
import IntelligenceSection from './IntelligenceSection.vue';
import DecisionHistorySection from './DecisionHistorySection.vue';
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

    <!-- ③ 第 1 档：正式决策 -->
    <PrimaryDecision :decision="vm.decision" :risk="vm.risk" :boundaries="vm.boundaries" />

    <!-- ④ 第 3 档：仓位（实际 / 建议 / 目标 / 配置） -->
    <PositionRiskSection
      :decision="vm.decision"
      :position="vm.position"
      :risk="vm.risk"
      :identity="vm.identity"
      :boundaries="vm.boundaries"
    />

    <!-- ⑤ 第 4 档：机会 / 辅助信号（⛔ 不是加仓建议） -->
    <OpportunityRadar :opportunity="vm.opportunity" />

    <!-- ⑥ 第 2 档：防守雷达（★ 只用后端已算结果） -->
    <DefenseRadar :defense="vm.defense" />

    <!-- ⑦ 第 4 档：Gen-1（★ 降权；Legacy Advisory） -->
    <Gen1AdvisorySection :gen1="vm.gen1Detail" />

    <!-- ⑧⑨ 第 5 档：证据 -->
    <KlineSection :kline="vm.kline" :code="vm.identity.codeText" />
    <StructureSection :structure="vm.structure" :price="vm.price" />

    <!-- ⑩ 第 5 档：情报 / 基本面摘要 -->
    <IntelligenceSection :intelligence="vm.intelligence" />

    <!-- ⑪ 第 6 档：历史（★ 最弱；⛔ 不伪造） -->
    <DecisionHistorySection :history="vm.decisionHistory" />

    <!-- ⑫ 来源与数据质量 -->
    <WorkbenchDataQuality :vm="vm" />

    <!-- 附：基本面摘要（保留第一阶段区块；深层属 M6） -->
    <section class="section rank-evidence">
      <SectionHeader eyebrow="基本面" title="摘要" :subtitle="vm.fundamentalsSummary.deepDetailNote" />
      <div class="kv-grid">
        <div class="kv"><span class="kv-k">基本面状态</span><span class="kv-v">{{ vm.fundamentalsSummary.fStateText }}</span></div>
        <div class="kv"><span class="kv-k">基本面评分</span><span class="kv-v"><FieldValue :d="vm.fundamentalsSummary.fScoreText" /></span></div>
        <div class="kv"><span class="kv-k">更新时间</span><span class="kv-v"><FieldValue :d="vm.fundamentalsSummary.updatedAtText" /></span></div>
      </div>
    </section>
  </div>
</template>
