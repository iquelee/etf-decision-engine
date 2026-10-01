<script setup>
/**
 * 底部：数据质量 / 来源 / 生命周期（web/src/rewrite/components/dashboard/DataQualitySection.vue）
 * 规范依据：SPEC §1.2 / §1.3 / §7 / §9
 *
 * ★★ 生命周期硬约束：**有真实数据才展示，否则一律「数据未提供」+ 原因**。
 *   ⛔ 本组件 ⛔ 不得出现任何状态字面量（如 COMPLETE / NOT_STARTED）；
 *   ⛔ 不得因为「我们知道台账状态」就把台账值写进页面 —— 那属于 production governance evidence，
 *      不是本页 API 的业务数据（SPEC §1.3）。
 *
 * 三维度轴永久分离（代码上线 ≠ 生产运行 ≠ 资格演进），⛔ 不合并成单一状态。
 */
import SectionHeader from '../SectionHeader.vue';
import FieldValue from '../domain/FieldValue.vue';
import FreshnessBadge from '../domain/FreshnessBadge.vue';
import LifecycleStrip from '../domain/LifecycleStrip.vue';
import ProvenanceLine from '../domain/ProvenanceLine.vue';
import ToneBadge from '../domain/ToneBadge.vue';

defineProps({
  asOf: { type: Object, required: true },
  freshness: { type: Object, required: true },
  provenance: { type: Object, required: true },
  lifecycle: { type: Object, required: true },
  boundaryFields: { type: Array, required: true },
  systemStatus: { type: Object, required: true },
  boundaries: { type: Object, default: () => ({}) }
});
</script>

<template>
  <section class="section">
    <SectionHeader
      eyebrow="数据质量"
      title="时点 · 新鲜度 · 来源"
      subtitle="本页所有数字均可追溯到具体来源；缺失与过期都会被显式标注。"
    />

    <div class="kv-grid">
      <div class="kv">
        <span class="kv-k">组合快照日期</span>
        <span class="kv-v"><FieldValue :d="asOf.snapshotDate" /></span>
      </div>
      <div class="kv">
        <span class="kv-k">决策日期</span>
        <span class="kv-v"><FieldValue :d="asOf.decisionDate" /></span>
      </div>
      <div class="kv">
        <span class="kv-k">标的卡数据时点</span>
        <span class="kv-v">{{ asOf.cardDataTimeText }}</span>
      </div>
      <div class="kv">
        <span class="kv-k">本次取数时刻</span>
        <span class="kv-v">{{ asOf.retrievedAtText }}</span>
      </div>
    </div>

    <div class="row-wrap gap-4 mt-3">
      <span class="kv-k">总体</span><FreshnessBadge :freshness="freshness.overall" />
      <span class="kv-k">组合快照</span><FreshnessBadge :freshness="freshness.snapshot" />
      <span class="kv-k">决策</span><FreshnessBadge :freshness="freshness.decision" />
    </div>

    <div class="mt-3">
      <ProvenanceLine
        :source="provenance.source"
        :channel-text="provenance.hasCanonicalContract ? '正式契约' : '运行时状态'"
        :channel-note="provenance.hasCanonicalContract ? '' : 'canonical 契约未在线上部署，gen1 通道为 ' + provenance.gen1ChannelText"
        :retrieved-at="asOf.retrievedAtText"
      />
      <ProvenanceLine
        :source="provenance.sourceAlt"
        :channel-text="provenance.gen1ChannelText"
        :channel-note="provenance.gen1ChannelNote"
      />
    </div>

    <hr class="divider" />

    <!-- ============ 生产生命周期 ============ -->
    <div class="section-head">
      <div>
        <div class="eyebrow">生产生命周期</div>
        <div class="section-title">生产生命周期状态</div>
        <div class="section-sub">
          三个轴永久分开：<b>代码上线</b> ≠ <b>首次受控运行</b> ≠ <b>一般生产资格</b>。
          无 API 数据的维度一律显示「数据未提供」，⛔ 前端不写死当前状态。
          <br />
          本页 <b>不声明部署版本身份</b>（不写具体版本号）—— 该口径属生产治理台账，不由本页 API 提供。
        </div>
      </div>
      <ToneBadge
        :text="lifecycle.unavailableCount + ' / ' + lifecycle.totalCount + ' 项无数据'"
        :tone="lifecycle.unavailableCount === 0 ? 'good' : 'muted'"
        small
      />
    </div>

    <p v-if="lifecycle.unavailableCount > 0" class="state-sub mb-3">
      数据来源：<b>后端未提供对应接口</b>（{{ lifecycle.runtimeStatusAvailable ? 'runtime_status 可读，但缺该维度字段' : 'runtime_status 不可读' }}）。
      ⛔ 本页不会用台账或静态清单填补这些格子。
    </p>

    <LifecycleStrip :lifecycle="lifecycle" />

    <hr class="divider" />

    <!-- ============ 边界字段组（⛔ 整体展示 + 反例） ============ -->
    <div class="section-head">
      <div>
        <div class="section-title">运行时边界字段组</div>
        <div class="section-sub">相关但语义独立 —— ⛔ 不可互相推断，必须整体阅读。</div>
      </div>
    </div>
    <div class="kv-grid">
      <div v-for="b in boundaryFields" :key="b.key" class="kv">
        <span class="kv-k">{{ b.label }}</span>
        <span class="kv-v"><FieldValue :d="b.value" /></span>
        <span class="kv-k mt-1">{{ b.counter }}</span>
      </div>
    </div>

    <hr class="divider" />

    <!-- ============ 系统运行状态（折叠） ============ -->
    <details class="fold">
      <summary>系统运行状态（历史兼容字段 · 默认折叠）</summary>
      <div v-if="!systemStatus.available" class="banner mt-2">
        <div class="banner-text">历史兼容字段：<b>数据未提供</b>（后端未下发该块）。</div>
      </div>
      <div v-else class="kv-grid mt-2">
        <div v-for="it in systemStatus.items" :key="it.key" class="kv">
          <span class="kv-k">{{ it.label }}</span>
          <span class="kv-v"><FieldValue :d="it.d" /></span>
        </div>
      </div>
      <p class="state-sub mt-2">
        ⛔ 本块为历史兼容字段，<b>不参与权限或阶段判定</b>；真实运行权限只看契约 / runtime_status 的 Gen-1 与安全字段。
      </p>
    </details>

    <p v-if="boundaries.gen2Note" class="state-sub mt-3">{{ boundaries.gen2Identity }} —— {{ boundaries.gen2Note }}</p>
  </section>
</template>
