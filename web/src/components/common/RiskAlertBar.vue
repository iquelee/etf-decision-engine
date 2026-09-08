<script setup>
import { computed } from 'vue';

// RISK_OVERRIDE 红条（风险熔断常驻提示）
const props = defineProps({
  riskFlag: { type: String, default: 'NORMAL' },
  riskOverride: { type: Boolean, default: false },
  reason: { type: String, default: '' }
});

const show = computed(() => props.riskOverride || props.riskFlag === 'RED');
const label = computed(() => (props.riskOverride ? '强制减仓熔断' : '风险熔断'));
</script>

<template>
  <div v-if="show" class="override-bar">
    <strong>⚠ {{ label }}</strong>
    <span v-if="reason">：{{ reason }}</span>
    <span v-else>：风险事件触发，禁新增仓位、进入防守模式</span>
  </div>
</template>

<style scoped>
.override-bar {
  background: #fef2f2; border: 1px solid #fecaca; border-left: 4px solid #dc2626;
  color: #991b1b; border-radius: 6px; padding: 10px 14px; margin-bottom: 12px; font-size: 13px;
}
</style>
