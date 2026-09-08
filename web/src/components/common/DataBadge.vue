<script setup>
import { computed } from 'vue';

// 数据来源/时间/置信度徽标（共享知识 B3-11）
const props = defineProps({
  source: { type: String, default: '' },
  time: { type: String, default: '' },
  confidence: { type: [Number, String], default: null },
  missing: { type: Boolean, default: false }
});

const cls = computed(() => (props.missing ? 'data-badge miss' : 'data-badge ok'));
</script>

<template>
  <span :class="cls" class="data-badge">
    <span class="dot"></span>
    <span v-if="source">来源:{{ source }}</span>
    <span v-if="time">｜{{ time }}</span>
    <span v-if="confidence != null && confidence !== ''">｜置信 {{ confidence }}</span>
    <span v-if="missing" class="missing-badge">数据缺失</span>
  </span>
</template>

<style scoped>
.data-badge { font-size: 11px; color: #6b7280; display: inline-flex; align-items: center; gap: 4px; white-space: nowrap; }
.dot { width: 6px; height: 6px; border-radius: 50%; background: #9ca3af; display: inline-block; }
.data-badge.ok .dot { background: #059669; }
.data-badge.miss .dot { background: #dc2626; }
.missing-badge { background: #f3f4f6; color: #6b7280; border: 1px dashed #d1d5db; border-radius: 4px; font-size: 11px; padding: 1px 6px; }
</style>
