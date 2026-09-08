<script setup>
import { computed } from 'vue';
import { SCORE_DIMENSIONS, OPPORTUNITY_GRADE_LABELS, OPPORTUNITY_GRADE_TONES } from '../../utils/constants.js';

const props = defineProps({
  scores: { type: Object, default: () => ({}) },
  opportunityScore: { type: Number, default: null },
  opportunityGrade: { type: String, default: null } // 后端下发的 A~F，优先展示
});

// 五维条（禁显 total/100 分，仅分维条 + 等级）
const dimensions = computed(() => {
  const s = props.scores || {};
  return SCORE_DIMENSIONS.map((d) => ({
    ...d,
    value: s[d.key] != null ? s[d.key] : null
  }));
});

// 机会等级：优先用后端下发的 grade，缺失时按分数兜底（阈值与后端一致）
const opportunityLevel = computed(() => {
  const g = props.opportunityGrade;
  if (g && OPPORTUNITY_GRADE_LABELS[g]) {
    return { label: OPPORTUNITY_GRADE_LABELS[g], tone: OPPORTUNITY_GRADE_TONES[g] || 'muted' };
  }
  const v = props.opportunityScore;
  if (v == null || Number.isNaN(v)) return { label: '—', tone: 'muted' };
  if (v >= 80) return { label: '强进攻', tone: 'good' };
  if (v >= 65) return { label: '积极', tone: 'good' };
  if (v >= 50) return { label: '持有', tone: 'warn' };
  if (v >= 35) return { label: '警戒', tone: 'warn' };
  if (v >= 20) return { label: '防守', tone: 'bad' };
  return { label: '清仓', tone: 'bad' };
});

function barColor(ratio) {
  if (ratio >= 0.8) return '#059669';
  if (ratio >= 0.6) return '#2563eb';
  if (ratio >= 0.4) return '#d97706';
  return '#dc2626';
}
</script>

<template>
  <div class="score-bar">
    <div class="score-bar-head">
      <span class="score-bar-title">五维评分</span>
      <span v-if="opportunityScore != null" class="score-opp" :class="opportunityLevel.tone">
        机会分 {{ opportunityScore }} · {{ opportunityLevel.label }}
      </span>
    </div>
    <div v-for="d in dimensions" :key="d.key" class="score-row">
      <span class="score-label">{{ d.label }}</span>
      <div class="score-track">
        <div
          v-if="d.value != null"
          class="score-fill"
          :style="{ width: (d.value / d.max * 100) + '%', background: barColor(d.value / d.max) }"
        ></div>
      </div>
      <span class="score-value">
        {{ d.value != null ? d.value : '—' }}<span class="score-max">/{{ d.max }}</span>
      </span>
    </div>
  </div>
</template>

<style scoped>
.score-bar { padding: 4px 0; }
.score-bar-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; }
.score-bar-title { font-size: 13px; font-weight: 600; color: #374151; }
.score-opp { font-size: 13px; font-weight: 600; }
.score-opp.good { color: #059669; }
.score-opp.warn { color: #d97706; }
.score-opp.bad { color: #dc2626; }
.score-opp.muted { color: #9ca3af; }
.score-row { display: flex; align-items: center; gap: 10px; margin-bottom: 8px; }
.score-label { width: 52px; font-size: 12px; color: #6b7280; flex-shrink: 0; }
.score-track { flex: 1; height: 8px; background: #f3f4f6; border-radius: 4px; overflow: hidden; }
.score-fill { height: 100%; border-radius: 4px; transition: width .3s; }
.score-value { width: 52px; font-size: 12px; color: #111827; text-align: right; flex-shrink: 0; }
.score-max { color: #9ca3af; font-size: 11px; }
</style>
