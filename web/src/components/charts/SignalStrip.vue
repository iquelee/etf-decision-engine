<script setup>
import { computed } from 'vue';
import { ACTION_COLORS, actionLabel } from '../../utils/constants.js';

// 近30日信号色块带（历史信号时序）
const props = defineProps({
  decisions: { type: Array, default: () => [] }
});

const items = computed(() => (props.decisions || []).slice(-30));

function label(d) {
  return actionLabel(d.final_action, d.action_label);
}

function title(d) {
  return `${d.decision_date} · ${label(d)} · 机会分 ${d.opportunity_score != null ? d.opportunity_score : '—'}`;
}
</script>

<template>
  <div class="signal-strip">
    <div v-if="items.length === 0" class="empty">暂无历史信号</div>
    <div v-else class="strip">
      <div
        v-for="d in items"
        :key="d.decision_date"
        class="strip-block"
        :style="{ background: ACTION_COLORS[d.final_action] || '#9ca3af' }"
        :title="title(d)"
      ></div>
    </div>
    <div class="strip-legend">
      <span v-for="(color, action) in ACTION_COLORS" :key="action" class="legend-item">
        <i :style="{ background: color }"></i>{{ actionLabel(action) }}
      </span>
    </div>
  </div>
</template>

<style scoped>
.signal-strip { padding: 4px 0; }
.strip { display: flex; gap: 3px; flex-wrap: wrap; }
.strip-block { width: 12px; height: 22px; border-radius: 3px; cursor: default; }
.strip-legend { display: flex; gap: 12px; margin-top: 8px; flex-wrap: wrap; }
.legend-item { font-size: 11px; color: #6b7280; display: inline-flex; align-items: center; gap: 4px; }
.legend-item i { width: 8px; height: 8px; border-radius: 2px; display: inline-block; }
.empty { color: #9ca3af; font-size: 12px; }
</style>
