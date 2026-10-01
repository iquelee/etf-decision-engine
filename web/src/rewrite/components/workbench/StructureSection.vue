<script setup>
/**
 * 结构识别区（web/src/rewrite/components/workbench/StructureSection.vue）
 * 规范依据：SPEC §4.2（界面 ⛔ 不得出现裸字母）＋ M4-P0 §A.1
 *
 * ★ 只用**真实结构字段**（`snapshot.*`）。
 * ★ 维度名必须显式（周线/日线/横盘/量能），⛔ 不得只显示 `W4` 这类裸码。
 * ★ 比例字段（`volume_ratio` / `price_position`）按 **0~1 比例**显示（⛔ 不当百分比）。
 * ★ ⛔ 前端**不重算**防守等级（后端已有 `etf/list[].defense` 与 `decision.defense_state` 两个权威来源）。
 */
import SectionHeader from '../SectionHeader.vue';
import FieldValue from '../domain/FieldValue.vue';
import ToneBadge from '../domain/ToneBadge.vue';

defineProps({
  structure: { type: Object, required: true },
  price: { type: Object, required: true }
});
</script>

<template>
  <section class="section prio-evidence">
    <SectionHeader
      eyebrow="结构"
      title="阶段识别与横盘 / 量价"
      subtitle="维度名一律显示全称（周线 / 日线 / 横盘 / 量能），⛔ 不出现裸字母。"
    >
      <template #actions>
        <ToneBadge
          :text="structure.dataComplete && structure.dataComplete.value ? '数据完整' : '数据可能不完整'"
          :tone="structure.dataComplete && structure.dataComplete.value ? 'good' : 'warn'"
          small
        />
      </template>
    </SectionHeader>

    <div class="struct-states">
      <div v-for="r in structure.stateRows" :key="r.dim" class="struct-state">
        <div class="struct-state-dim">{{ r.dim }}</div>
        <div class="struct-state-code">{{ r.raw && r.raw.value ? r.raw.value : '—' }}</div>
        <div class="struct-state-text">{{ r.codeText }}</div>
      </div>
    </div>

    <hr class="divider" />

    <div class="grid-2">
      <div>
        <div class="section-title mb-2">横盘 / 趋势</div>
        <div class="kv-grid">
          <div class="kv"><span class="kv-k">趋势背景</span><span class="kv-v"><FieldValue :d="structure.consolidation.trendContextText" /></span></div>
          <div class="kv"><span class="kv-k">横盘天数</span><span class="kv-v">{{ structure.consolidation.sidewayDaysText.text }}</span></div>
          <div class="kv"><span class="kv-k">横盘振幅</span><span class="kv-v">{{ structure.consolidation.sidewayRangeText.text }}</span></div>
          <div class="kv"><span class="kv-k">MA20 斜率</span><span class="kv-v">{{ structure.consolidation.ma20SlopeText.text }}</span></div>
          <div class="kv"><span class="kv-k">整理评分</span><span class="kv-v">{{ structure.consolidation.scoreText.text }}<span class="text-11" style="color:var(--c-text-3)">（点数）</span></span></div>
        </div>
      </div>
      <div>
        <div class="section-title mb-2">量价 / 价格位置</div>
        <div class="kv-grid">
          <div class="kv">
            <span class="kv-k">量比</span>
            <span class="kv-v">{{ structure.volume.ratioText.text }}<span class="text-11" style="color:var(--c-text-3)">（0~1 比例）</span></span>
          </div>
          <div class="kv"><span class="kv-k">放量滞涨</span><span class="kv-v"><FieldValue :d="structure.volume.highVolumeStagnation" /></span></div>
          <div class="kv"><span class="kv-k">放量下跌</span><span class="kv-v"><FieldValue :d="structure.volume.highVolumeDecline" /></span></div>
          <div class="kv">
            <span class="kv-k">价格位置</span>
            <span class="kv-v">{{ price.pricePositionText.text }}<span class="text-11" style="color:var(--c-text-3)">（0~1 比例）</span></span>
          </div>
          <div class="kv"><span class="kv-k">5 日涨跌</span><span class="kv-v">{{ price.change5dText.text }}</span></div>
          <div class="kv"><span class="kv-k">20 日乖离</span><span class="kv-v">{{ price.bias20dText.text }}</span></div>
        </div>
      </div>
    </div>

    <hr class="divider" />

    <div class="section-title mb-2">均线（价格，元）</div>
    <div class="kv-grid">
      <div class="kv"><span class="kv-k">MA5</span><span class="kv-v"><FieldValue :d="structure.ma.ma5" /></span></div>
      <div class="kv"><span class="kv-k">MA10</span><span class="kv-v"><FieldValue :d="structure.ma.ma10" /></span></div>
      <div class="kv"><span class="kv-k">MA20</span><span class="kv-v"><FieldValue :d="structure.ma.ma20" /></span></div>
      <div class="kv"><span class="kv-k">MA60</span><span class="kv-v"><FieldValue :d="structure.ma.ma60" /></span></div>
      <div class="kv"><span class="kv-k">MA120</span><span class="kv-v"><FieldValue :d="structure.ma.ma120" /></span></div>
      <div class="kv"><span class="kv-k">波动 / 量能</span><span class="kv-v">ATR20 {{ price.atr20Text.text }} · 20 日均量 {{ price.vol20Text.text }}</span></div>
    </div>

    <p class="state-sub mt-2">{{ structure.defenseLevelNote }}</p>
  </section>
</template>
