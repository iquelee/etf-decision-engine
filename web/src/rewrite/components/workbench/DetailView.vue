<script setup>
/**
 * ETF 工作台视图（web/src/rewrite/components/workbench/DetailView.vue）
 * 规范依据：owner 裁定的 M4-P1 IA（第一阶段 §二 ＋ 第二阶段 §二）
 *
 * ★ IA（自上而下；视觉权重用**语义优先级**表达，⛔ 不用数字档位命名 —— owner D-M5-4）
 *   ┌ ① Header              标的身份 · **组合环境** · 价格 · 快照日 · 决策日 · K 线新鲜度
 *   ├ ② K 线滞后提示        （仅严重滞后时出现；⛔ 与决策新鲜度无关）
 *   ├ ③ PrimaryDecision    ★ Formal Decision（V3 Safety Core · 唯一权威主位）
 *   ├ ④ PositionRiskSection  Risk & Position（四轴 + `position_gap` 主位）
 *   ├ ⑤ OpportunityRadar     Advisory & Opportunity（辅助信号，⛔ 不是加仓建议）
 *   ├ ⑥ DefenseRadar         Risk & Defense（后端已算，⛔ 不重算）
 *   ├ ⑦ Gen1AdvisorySection  Advisory（★ 明确降权）
 *   ├ ⑧ KlineSection         Evidence
 *   ├ ⑨ StructureSection     Evidence
 *   ├ ⑩ IntelligenceSection  Evidence（基本面 / 风险事件的**主位**）
 *   ├ ⑪ DecisionHistorySection History（★ 最弱；只给最近变化，⛔ 不伪造）
 *   └ ⑫ WorkbenchDataQuality Provenance
 *
 * ★ M5-P1（Single-Source Display Governance）：
 *   · ⛔ 页尾不再有第二处「基本面摘要」段（主位在 ⑩）；
 *   · 每个后端事实**只有一个主位**，引用位由 `components/domain/Fact.vue` 标记
 *     （`data-fact` / `data-role` / `data-ref-to`），归属表见 `domain/ownership.js`；
 *   · 顺序**保持真实认知顺序**（⛔ 不为档位编号调整 DOM）。
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
      :market-regime="vm.marketRegime"
    />

    <StaleBanner
      :banner="vm.kline.banner"
      :status-label="vm.kline.statusLabel"
      :keep-note="vm.kline.keepNote"
      :decision-freshness-text="vm.kline.decisionFreshnessText"
    />

    <!-- ③ 最高权威：正式决策（V3 Safety Core · 唯一权威主位） -->
    <PrimaryDecision :decision="vm.decision" :risk="vm.risk" :boundaries="vm.boundaries" />

    <!-- ④ Risk & Position：仓位四轴（实际 / 建议 / 目标 / 配置） -->
    <PositionRiskSection
      :decision="vm.decision"
      :position="vm.position"
      :risk="vm.risk"
      :identity="vm.identity"
      :boundaries="vm.boundaries"
    />

    <!-- ⑤ Advisory & Opportunity：机会 / 辅助信号（⛔ 不是加仓建议） -->
    <OpportunityRadar :opportunity="vm.opportunity" />

    <!-- ⑥ Risk & Defense：防守雷达（★ 只用后端已算结果） -->
    <DefenseRadar :defense="vm.defense" />

    <!-- ⑦ Advisory（★ 降权）：Gen-1 · Legacy Advisory -->
    <Gen1AdvisorySection :gen1="vm.gen1Detail" />

    <!-- ⑧⑨ Evidence：K 线 / 结构 -->
    <KlineSection :kline="vm.kline" :code="vm.identity.codeText" />
    <StructureSection :structure="vm.structure" :price="vm.price" />

    <!-- ⑩ Evidence（情报主位）：情报 / 基本面摘要 -->
    <IntelligenceSection :intelligence="vm.intelligence" />

    <!-- ⑪ History（★ 最弱；⛔ 不伪造） -->
    <DecisionHistorySection :history="vm.decisionHistory" />

    <!-- ⑫ 来源与数据质量 -->
    <WorkbenchDataQuality :vm="vm" />
  </div>
</template>
