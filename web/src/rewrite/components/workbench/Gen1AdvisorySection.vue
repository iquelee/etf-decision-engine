<script setup>
/**
 * Gen-1 建议区（web/src/rewrite/components/workbench/Gen1AdvisorySection.vue）
 * 规范依据：owner 裁定 M4-D1（2026-09-30）＋ SPEC §3.1 / §6
 *
 * ★★ 裁定原文要点（⛔ 逐字遵守）
 *   · 允许展示 `decision.gen1_*` + `ml_shadow`，但**必须降级为 Legacy Advisory**，
 *     ⛔ 不得伪装成 canonical Gen-1；
 *   · 统一进入 `GEN-1 · TIMING / ADVISORY` + `Legacy Channel`；
 *   · 视觉层级：**V3 Safety Core > Gen-1 Legacy Advisory**；
 *   · 某字段无可靠来源 ⇒ 「数据未提供」，⛔ 不得用其它字段偷偷补齐；
 *   · ⛔ 硬禁止：`ml_shadow` 冒充 canonical gen1。
 *
 * ★ 视觉上必须**弱于**正式决策区：
 *   本区使用常规字号与中性底色，⛔ 不出现 hero 级别大数字，
 *   ⛔ 不得让 probability / signal / stage 看起来比正式 action / target 更权威。
 */
import SectionHeader from '../SectionHeader.vue';
import FieldValue from '../domain/FieldValue.vue';
import ToneBadge from '../domain/ToneBadge.vue';
import ProvenanceLine from '../domain/ProvenanceLine.vue';

defineProps({
  /** adapter 的 `vm.gen1Detail`（三通道：CANONICAL / DECISION_LEGACY / NONE） */
  gen1: { type: Object, required: true }
});
</script>

<template>
  <section class="section gen1-advisory">
    <SectionHeader
      :eyebrow="gen1.title"
      title="时机与适用性建议"
      :subtitle="gen1.channelCaveat"
    >
      <template #actions>
        <ToneBadge :text="gen1.channelLabel" :tone="gen1.channelTone" small />
      </template>
    </SectionHeader>

    <!-- ★ 权威降级声明：必须可见 -->
    <p class="gen1-disclaimer">{{ gen1.advisoryDisclaimer }}</p>

    <!-- 无任何来源 ⇒ 全字段「数据未提供」（⛔ 不显示「正常 / 无信号 / 关闭」） -->
    <div v-if="!gen1.available" class="banner mb-3">
      <div class="banner-text">
        Gen-1 <b>数据未提供</b>：既无 canonical 契约（`system_runtime.gen1`），
        也无 legacy 通道字段（`decision.gen1_*` / `ml_shadow`）。
        ⛔ 本页不会据此推断档位、健康或是否生效。
      </div>
    </div>

    <template v-else>
      <div class="kv-grid">
        <div class="kv">
          <span class="kv-k">权限档位</span>
          <span class="kv-v">
            <!-- canonical 有后端中文标签 ⇒ 用它；legacy 无标签 ⇒ 直接显示档位值（⛔ 不并排显示「数据未提供」） -->
            <FieldValue v-if="!gen1.authorityLabel.missing" :d="gen1.authorityLabel" />
            <FieldValue v-else :d="gen1.authority" />
            <span v-if="gen1.fieldTag" class="gen1-tag">{{ gen1.fieldTag }}</span>
          </span>
        </div>
        <div class="kv">
          <span class="kv-k">健康状态</span>
          <span class="kv-v">
            <FieldValue :d="gen1.healthStatus" />
            <span v-if="gen1.fieldTag" class="gen1-tag">{{ gen1.fieldTag }}</span>
          </span>
        </div>
        <div class="kv">
          <span class="kv-k">健康门控</span>
          <span class="kv-v">
            <FieldValue :d="gen1.healthGateStatus" />
            <span v-if="gen1.fieldTag" class="gen1-tag">{{ gen1.fieldTag }}</span>
          </span>
        </div>
      </div>

      <hr class="divider" />

      <div class="section-title mb-2">信号</div>
      <div class="kv-grid">
        <div class="kv">
          <span class="kv-k">信号阶段（signal）</span>
          <span class="kv-v"><FieldValue :d="gen1.signal.stage" /></span>
        </div>
        <div class="kv">
          <span class="kv-k">模型概率</span>
          <span class="kv-v"><FieldValue :d="gen1.signal.probability" /><span class="gen1-unit">0~1 概率</span></span>
        </div>
        <div class="kv">
          <span class="kv-k">模型阈值</span>
          <span class="kv-v"><FieldValue :d="gen1.signal.threshold" /><span class="gen1-unit">0~1 比例，⛔ 不是百分比</span></span>
        </div>
        <div class="kv">
          <span class="kv-k">模型候选</span>
          <span class="kv-v"><FieldValue :d="gen1.signal.modelCandidate" /></span>
        </div>
        <div class="kv">
          <span class="kv-k">信号状态</span>
          <span class="kv-v"><FieldValue :d="gen1.signal.signalStatus" /></span>
        </div>
      </div>

      <hr class="divider" />

      <!-- ★ 三段 stage 必须分开（⛔ 不得串位） -->
      <div class="section-title mb-2">三段阶段（signal / baseline / effective，⛔ 不得串位）</div>
      <div class="kv-grid">
        <div class="kv"><span class="kv-k">signal</span><span class="kv-v"><FieldValue :d="gen1.stages.signal" /></span></div>
        <div class="kv"><span class="kv-k">baseline</span><span class="kv-v"><FieldValue :d="gen1.stages.baseline" /></span></div>
        <div class="kv"><span class="kv-k">effective</span><span class="kv-v"><FieldValue :d="gen1.stages.effective" /></span></div>
      </div>

      <hr class="divider" />

      <div class="section-title mb-2">Safety Core 闸门</div>
      <div class="kv-grid">
        <div class="kv"><span class="kv-k">放行许可</span><span class="kv-v"><FieldValue :d="gen1.safetyGate.permission" /></span></div>
        <div class="kv"><span class="kv-k">原因码</span><span class="kv-v"><FieldValue :d="gen1.safetyGate.reasonCode" /></span></div>
        <div class="kv"><span class="kv-k">原因</span><span class="kv-v"><FieldValue :d="gen1.safetyGate.reason" /></span></div>
        <div class="kv"><span class="kv-k">判定来源</span><span class="kv-v"><FieldValue :d="gen1.safetyGate.source" /></span></div>
      </div>

      <hr class="divider" />

      <!-- ★ 反事实：⛔ 不得覆盖正式目标 -->
      <div class="section-head" style="margin-bottom:8px">
        <div>
          <div class="section-title">反事实（影子推演）</div>
          <div class="section-sub">{{ gen1.counterfactualNote }}</div>
        </div>
      </div>
      <div class="kv-grid">
        <div class="kv"><span class="kv-k">反事实目标</span><span class="kv-v"><FieldValue :d="gen1.counterfactual.targetPct" /></span></div>
        <div class="kv"><span class="kv-k">反事实建议</span><span class="kv-v"><FieldValue :d="gen1.counterfactual.suggestedPct" /></span></div>
        <div class="kv"><span class="kv-k">差值</span><span class="kv-v"><FieldValue :d="gen1.counterfactual.deltaPct" /></span></div>
        <div class="kv"><span class="kv-k">阶段是否改变</span><span class="kv-v"><FieldValue :d="gen1.counterfactual.stageChanged" /></span></div>
        <div class="kv"><span class="kv-k">是否被夹取</span><span class="kv-v"><FieldValue :d="gen1.counterfactual.clamped" /></span></div>
        <div class="kv"><span class="kv-k">基线底线是否击穿</span><span class="kv-v"><FieldValue :d="gen1.counterfactual.baselineFloorBreached" /></span></div>
      </div>

      <hr class="divider" />

      <div class="section-title mb-2">数据健康与运行标识</div>
      <div class="kv-grid">
        <div class="kv"><span class="kv-k">信号数据健康</span><span class="kv-v"><FieldValue :d="gen1.dataHealth.status" /></span></div>
        <div class="kv"><span class="kv-k">信号交易日</span><span class="kv-v"><FieldValue :d="gen1.dataHealth.sourceTradeDate" /></span></div>
        <div class="kv"><span class="kv-k">运行 ID</span><span class="kv-v"><FieldValue :d="gen1.meta.runId" /></span></div>
        <div class="kv"><span class="kv-k">模型 ID</span><span class="kv-v"><FieldValue :d="gen1.meta.modelId" /></span></div>
        <div class="kv"><span class="kv-k">引擎版本</span><span class="kv-v"><FieldValue :d="gen1.meta.engineVersion" /></span></div>
        <div class="kv"><span class="kv-k">生成时间</span><span class="kv-v"><FieldValue :d="gen1.meta.generatedAt" /></span></div>
      </div>
      <p v-if="gen1.meta.note && !gen1.meta.note.missing" class="state-sub mt-2">{{ gen1.meta.note.text }}</p>

      <!-- 诚实登记：本区**有意不消费**的 legacy 键（⛔ 不是"漏了"） -->
      <p v-if="gen1.notConsumed && gen1.notConsumed.length" class="state-sub mt-3">
        本区有意不消费的 legacy 键（{{ gen1.notConsumed.length }} 个）：{{ gen1.notConsumed.join('、') }}。
        扩面需单独授权。
      </p>
    </template>

    <ProvenanceLine
      :channel-text="gen1.channelLabel"
      :channel-note="gen1.channelNote"
      :source="gen1.sourceLabel"
    />
  </section>
</template>
