<script setup>
/**
 * Dashboard 参考实现根组件（web/src/rewrite/components/dashboard/DashboardView.vue）
 * 规范依据：SPEC §2 / §4.1 / §4.2 / §9
 *
 * ★ 分层（SPEC §2.2）：
 *   api → adapter → **本组件只接收 ViewModel（`state.vm`）** → 子组件渲染
 *   ⛔ 本组件不 import api / adapters；⛔ 不解释后端字段；⛔ 不格式化数字。
 *
 * ★ 页面状态：loading / error / empty / ready 四态显式建模（SPEC §9）。
 *   ⛔ 加载中不得渲染任何业务数字（避免「0%」被误读）。
 *
 * 生命周期：M3（本文件为 M3 参考实现；M4+ 的其它页面照此结构落地）
 */
import PageStateBlock from '../common/PageStateBlock.vue';
import MarketDecisionSection from './MarketDecisionSection.vue';
import Gen1Section from './Gen1Section.vue';
import CardsSection from './CardsSection.vue';
import DataQualitySection from './DataQualitySection.vue';
import FreshnessBadge from '../domain/FreshnessBadge.vue';
import ToneBadge from '../domain/ToneBadge.vue';

const props = defineProps({
  /**
   * 页面状态对象（由 compose/useDashboard 提供）：
   * {
   *   phase: 'loading' | 'error' | 'empty' | 'ready',
   *   error: string,
   *   vm: DashboardViewModel | null,
   *   refresh: () => void,
   *   refreshing: boolean
   * }
   */
  state: { type: Object, required: true }
});
</script>

<template>
  <div class="page">

    <!-- ============ 顶部：标题 + 数据时点 + 新鲜度 ============ -->
    <header class="dash-head">
      <div>
        <div class="eyebrow">V3 仓位决策</div>
        <h2 class="dash-title">全局</h2>
      </div>

      <div class="dash-meta grow">
        <template v-if="state.vm">
          <span>数据快照 <b>{{ state.vm.asOf.snapshotDateText }}</b></span>
          <span>决策日 <b>{{ state.vm.asOf.decisionDateText }}</b></span>
          <FreshnessBadge :freshness="state.vm.freshness.overall" />
        </template>
        <ToneBadge v-else text="数据未就绪" tone="muted" small />
      </div>

      <button
        type="button"
        class="badge outline touch"
        :disabled="state.refreshing"
        @click="state.refresh"
      >{{ state.refreshing ? '刷新中…' : '刷新' }}</button>
    </header>

    <!-- ============ 页面级状态（loading / error / empty） ============ -->
    <PageStateBlock
      v-if="state.phase !== 'ready' && state.phase !== 'ready-degraded'"
      :phase="state.phase"
      :error="state.error"
      :empty-text="state.emptyText"
      @retry="state.refresh"
    />

    <!-- ============ 正常内容 ============ -->
    <template v-else>
      <!-- 降级提示：契约未部署 / legacy 回退时必须显式告知 -->
      <div v-if="state.phase === 'ready-degraded'" class="banner">
        <div class="banner-text">
          当前为<b>降级展示</b>：{{ state.vm.provenance.gen1Channel === 'RUNTIME_STATUS'
            ? '正式 Gen-1 契约未在线上部署，系统级 Gen-1 状态改读运行时状态。'
            : '正式契约与运行时状态均不可读，Gen-1 相关位置显示「数据未提供」。' }}
          <template v-if="state.vm.provenance.legacyFallbackUsed">
            部分内容来自历史兼容字段（⛔ 不得用于权限或阶段判定）。
          </template>
        </div>
      </div>

      <!-- 第一主区：市场环境 + 正式决策（视觉权重最高） -->
      <MarketDecisionSection
        :market="state.vm.market"
        :decision="state.vm.decision"
        :portfolio="state.vm.portfolio"
        :boundaries="state.vm.boundaries"
      />

      <!-- 第二主区：Gen-1（时机/建议，权重低于正式决策） -->
      <Gen1Section :gen1="state.vm.gen1" :boundary-note="state.vm.boundaries.gen1Note" />

      <!-- 第三主区：标的 -->
      <CardsSection
        :cards="state.vm.cards"
        title="全部标的"
        subtitle="动作与目标仓位均为 V3 Safety Core 口径；Gen-1 仅给出时机建议。"
      />

      <!-- 底部：数据质量 / 来源 / 生命周期 -->
      <DataQualitySection
        :as-of="state.vm.asOf"
        :freshness="state.vm.freshness"
        :provenance="state.vm.provenance"
        :lifecycle="state.vm.lifecycle"
        :boundary-fields="state.vm.boundaryFields"
        :system-status="state.vm.systemStatus"
        :boundaries="state.vm.boundaries"
      />
    </template>
  </div>
</template>
