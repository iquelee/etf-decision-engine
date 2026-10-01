<script setup>
/**
 * 风险徽标（web/src/rewrite/components/domain/RiskBadge.vue）
 * 规范依据：SPEC §12.1
 *
 * 语义分域：风控状态使用 `--risk-*`
 *   NORMAL → risk-normal · YELLOW → risk-yellow · RED → risk-red
 *   ⛔ 不得复用 `--mkt-*`（涨跌）或 `--tone-*`（动作）的色值。
 */
import { computed } from 'vue';
import ToneBadge from './ToneBadge.vue';

const props = defineProps({
  text: { type: String, required: true },
  tone: { type: String, default: 'muted' },
  dot: { type: Boolean, default: true }
});

/** 把 domain 的 tone（good/warn/risk）映射到风控色域类名 */
const riskTone = computed(() => {
  if (props.tone === 'good') return 'risk-normal';
  if (props.tone === 'warn') return 'risk-yellow';
  if (props.tone === 'risk') return 'risk-red';
  return 'muted';
});
</script>

<template>
  <span data-domain="risk" aria-label="风险状态">
    <ToneBadge :text="text" :tone="riskTone" :dot="dot" />
  </span>
</template>
