<script setup>
/**
 * Gen-1 时机建议区（web/src/rewrite/components/dashboard/Gen1Section.vue）
 * 规范依据：SPEC §3.1 / §4.2 / §6
 *
 * ★ 身份必须显式：`GEN-1 · TIMING / ADVISORY`
 *   ⛔ 不得呈现为「最终交易决定」「当前最终仓位 authority」「正式组合目标」。
 *
 * ★ 数据来源三级（由 adapter 判定，本组件只渲染结论）：
 *   canonical `system_runtime.gen1` > `runtime_status.gen1_*`（标注为运行时状态）> 未提供
 *   ⛔ 无数据时显示「数据未提供」，⛔ 不得显示「正常 / 无信号 / 关闭」等猜测值。
 */
import SectionHeader from '../SectionHeader.vue';
import ToneBadge from '../domain/ToneBadge.vue';
import FieldValue from '../domain/FieldValue.vue';
import ProvenanceLine from '../domain/ProvenanceLine.vue';

defineProps({
  /** adapter 的 gen1 对象 */
  gen1: { type: Object, required: true },
  /** 边界说明文案（来自 adapter 的 boundaries，⛔ 组件不硬编码） */
  boundaryNote: { type: String, default: '' }
});
</script>

<template>
  <section class="section">
    <SectionHeader
      :eyebrow="gen1.identity"
      title="Gen-1 时机建议"
      :subtitle="boundaryNote"
    >
      <template #actions>
        <ToneBadge :text="gen1.sourceChannelText" tone="outline" small />
      </template>
    </SectionHeader>

    <!-- 通道警示：非契约通道必须显著标注（⛔ 不静默） -->
    <p v-if="gen1.channelCaveat" class="state-sub mb-3">{{ gen1.channelCaveat }}</p>

    <!-- 无任何来源：显式未提供 -->
    <div v-if="gen1.sourceChannel === 'NONE'" class="banner mb-3">
      <div class="banner-text">
        Gen-1 状态：<b>数据未提供</b>。后端既未下发 canonical 契约，也未提供运行时状态。
        ⛔ 本页不会据此推断 Gen-1 档位、健康或是否生效。
      </div>
    </div>

    <div class="kv-grid">
      <div class="kv">
        <span class="kv-k">权限档位</span>
        <span class="kv-v">
          <FieldValue :d="gen1.authorityLabel" />
          <span v-if="gen1.authorityLabelIsBackend" class="badge outline sm ml-1" style="margin-left:6px">后端标签</span>
        </span>
      </div>
      <div class="kv">
        <span class="kv-k">健康状态</span>
        <span class="kv-v"><ToneBadge :text="gen1.healthLabel.text" :tone="gen1.healthTone" dot /></span>
      </div>
      <div class="kv">
        <span class="kv-k">健康门控</span>
        <span class="kv-v"><FieldValue :d="gen1.healthGateLabel" /></span>
      </div>
      <div class="kv">
        <span class="kv-k">安全来源</span>
        <span class="kv-v"><FieldValue :d="gen1.safetySource" /></span>
      </div>
    </div>

    <hr class="divider" />

    <div class="section-head" style="margin-bottom:8px">
      <div>
        <div class="section-title">反事实（影子）</div>
        <div class="section-sub">{{ gen1.counterfactual.note }}</div>
      </div>
      <ToneBadge :text="gen1.counterfactual.available ? '已下发' : '数据未提供'" tone="outline" small />
    </div>
    <div class="kv-grid">
      <div class="kv">
        <span class="kv-k">是否授权</span>
        <span class="kv-v"><FieldValue :d="gen1.counterfactual.authorized" /></span>
      </div>
      <div class="kv">
        <span class="kv-k">健康是否放行</span>
        <span class="kv-v"><FieldValue :d="gen1.counterfactual.healthAllowed" /></span>
      </div>
      <div class="kv">
        <span class="kv-k">当前是否生效</span>
        <span class="kv-v"><FieldValue :d="gen1.counterfactual.active" /></span>
      </div>
      <div class="kv">
        <span class="kv-k">未生效原因</span>
        <span class="kv-v"><FieldValue :d="gen1.counterfactual.inactiveReason" /></span>
      </div>
    </div>

    <hr class="divider" />

    <div class="section-title mb-2">安全边界（三态，⛔ 不压扁 false/null）</div>
    <div class="kv-grid">
      <div class="kv">
        <span class="kv-k">Gen-1 写生产</span>
        <span class="kv-v"><FieldValue :d="gen1.safety.productionWrite" /></span>
      </div>
      <div class="kv">
        <span class="kv-k">生产快速通道</span>
        <span class="kv-v"><FieldValue :d="gen1.safety.productionFastPathEnabled" /></span>
      </div>
      <div class="kv">
        <span class="kv-k">自动执行</span>
        <span class="kv-v"><FieldValue :d="gen1.safety.autoExecution" /></span>
      </div>
      <div class="kv">
        <span class="kv-k">安全不变式</span>
        <span class="kv-v"><FieldValue :d="gen1.safety.safetyInvariantOk" /></span>
      </div>
    </div>

    <p class="state-sub mt-3">
      标的级 Gen-1 契约：已下发 {{ gen1.perCard.available }} / {{ gen1.perCard.total }} 只。
      <template v-if="gen1.perCard.unavailable > 0">
        ⇒ 其余标的在「标的」表中显示<b>数据未提供</b>（⛔ 不用历史兼容字段冒充）。
      </template>
    </p>

    <ProvenanceLine
      :channel-text="gen1.sourceChannelText"
      :channel-note="gen1.sourceChannelNote"
      :source="gen1.sourceChannel === 'CANONICAL' ? 'contract:system_runtime.gen1' : (gen1.sourceChannel === 'RUNTIME_STATUS' ? 'api:/api/constants#runtime_status' : '')"
    />
  </section>
</template>
