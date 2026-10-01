<script setup>
/**
 * 情报 / 基本面摘要（web/src/rewrite/components/workbench/IntelligenceSection.vue）
 * 规范依据：owner M4-P1b §六 / §九.4 ＋ owner 裁定 M5-P1（2026-10-01）
 *
 * ★ 只展示**有助于理解当前决策**的证据：
 *   `fundamental`（状态 / 评分 / 分层明细）+ `risk_events` 摘要。
 *   ⛔ **不展开** `fundamental_config` / `fundamental_series`（属「基本面」页 M6）。
 *
 * ★★ 空数组纪律（用户 §六）：`risk_events = []` ⇒ 「当前没有返回风险事件数据」，
 *   ⛔ **不得**显示「没有风险」。
 *
 * ★ 量纲：分层 `signal` / `weight` 的量纲**未经 schema 证实** ⇒ 只展示后端原始值，
 *   并显式标注，⛔ 不加 %、⛔ 不换算、⛔ 不解释。
 *
 * ★ M5-P1（Single-Source）本区是两组事实的**唯一主位**：
 *   · `fundamental_summary`（基本面状态 / 评分 / 更新时间）——⛔ 页尾不得再有第二处摘要段；
 *   · `risk_events`（完整清单 + 空数组文案）——「防守雷达」只作条数引用。
 */
import SectionHeader from '../SectionHeader.vue';
import FieldValue from '../domain/FieldValue.vue';
import ToneBadge from '../domain/ToneBadge.vue';
import Fact from '../domain/Fact.vue';
import { FACT } from '../../domain/ownership.js';

defineProps({
  /** adapter 的 `vm.intelligence` */
  intelligence: { type: Object, required: true }
});
</script>

<template>
  <section class="section prio-evidence">
    <SectionHeader
      eyebrow="情报 / 基本面"
      title="基本面摘要与证据"
      :subtitle="intelligence.sectionNote"
    >
      <template #actions>
        <ToneBadge
          :text="intelligence.fundamental.fStateText"
          :tone="intelligence.available ? 'accent' : 'muted'"
          small
        />
      </template>
    </SectionHeader>

    <!-- 基本面不可用 -->
    <div v-if="!intelligence.available" class="banner mb-3">
      <div class="banner-text">基本面<b>数据未提供</b>。本页不会用其它来源替代。</div>
    </div>

    <template v-else>
      <!-- ★ 基本面摘要 = **唯一主位**（M5-P1：页尾重复段已删除） -->
      <Fact :fact="FACT.FUNDAMENTAL_SUMMARY">
        <div class="kv-grid">
          <div class="kv">
            <span class="kv-k">基本面状态</span>
            <span class="kv-v"><b>{{ intelligence.fundamental.fStateText }}</b></span>
          </div>
          <div class="kv">
            <span class="kv-k">基本面评分</span>
            <span class="kv-v">{{ intelligence.fundamental.fScoreText.text }}<span class="text-11" style="color:var(--c-text-3)">（分）</span></span>
          </div>
          <div class="kv">
            <span class="kv-k">更新时间</span>
            <span class="kv-v"><FieldValue :d="intelligence.fundamental.updatedAtText" /></span>
          </div>
          <div class="kv">
            <span class="kv-k">综合信号（后端原始值）</span>
            <span class="kv-v">
              <template v-if="intelligence.detail.finalSignalText !== null">
                {{ intelligence.detail.finalSignalText }}
                <span class="text-11" style="color:var(--c-text-3)"> · {{ intelligence.detail.signalNote }}</span>
              </template>
              <span v-else class="fv missing">数据未提供</span>
            </span>
          </div>
        </div>
      </Fact>

      <hr class="divider" />

      <!-- ★ 分层证据（后端分层明细；⛔ 模板注释不得出现后端字段名 —— 会随 dev 编译进入 HTML） -->
      <div class="section-head" style="margin-bottom:8px">
        <div>
          <div class="section-title">分层证据</div>
          <div class="section-sub">
            权重为后端原始权重（⛔ 不是百分比）；信号值为后端原始值（⛔ 本页不解释量纲）
          </div>
        </div>
        <ToneBadge
          :text="intelligence.layers.available ? (intelligence.layers.items.length + ' 层') : '数据未提供'"
          tone="outline"
          small
        />
      </div>

      <div v-if="!intelligence.layers.available" class="banner">
        <div class="banner-text">{{ intelligence.layers.note }}</div>
      </div>
      <div v-else class="kv-grid">
        <div v-for="l in intelligence.layers.items" :key="l.key" class="kv">
          <span class="kv-k">{{ l.label }}</span>
          <span class="kv-v">
            {{ l.count === null ? '—' : l.count }} 项 ·
            信号 {{ l.signalText === null ? '—' : l.signalText }} ·
            权重 {{ l.weightText === null ? '—' : l.weightText }}
          </span>
        </div>
        <div class="kv">
          <span class="kv-k">层级权重合计</span>
          <span class="kv-v">{{ intelligence.layers.totalLayerWeight === null ? '—' : intelligence.layers.totalLayerWeight }}</span>
        </div>
      </div>

      <hr class="divider" />

      <!-- ★ M5-P1：风险事件 = **本区为唯一主位**（完整清单只在此渲染） -->
      <Fact :fact="FACT.RISK_EVENTS">
        <div class="section-head" style="margin-bottom:8px">
          <div>
            <div class="section-title">风险事件</div>
            <div class="section-sub">
              <template v-if="intelligence.riskEvents.isEmpty">{{ intelligence.riskEvents.emptyNote }}</template>
              <template v-else>来自后端事件记录</template>
            </div>
          </div>
        </div>
        <div v-if="intelligence.riskEvents.isEmpty" class="banner">
          <div class="banner-text">{{ intelligence.riskEvents.emptyText }}</div>
        </div>
        <ul v-else-if="intelligence.riskEvents.available" class="block-list">
          <li v-for="(e, i) in intelligence.riskEvents.items" :key="i">
            <b>{{ e.reasonText }}</b>
            <span class="text-11" style="color:var(--c-text-3)"> · {{ e.statusText }} · {{ e.triggerTimeText }}</span>
          </li>
        </ul>
        <div v-else class="banner">
          <div class="banner-text">风险事件字段未提供。</div>
        </div>
      </Fact>

      <p class="state-sub mt-3">
        本区<b>不消费</b>的载荷块：{{ intelligence.notConsumed.join('、') }}
        —— 属「基本面」页（M6）范围，⛔ 不搬进工作台。
      </p>
    </template>
  </section>
</template>
