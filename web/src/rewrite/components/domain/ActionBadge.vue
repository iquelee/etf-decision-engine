<script setup>
/**
 * 动作徽标（web/src/rewrite/components/domain/ActionBadge.vue）
 * 规范依据：SPEC §12.1
 *
 * ★ 硬规则：动作**必须带文字标签**（⛔ 不得仅靠颜色区分动作）。
 *   故 `text` 为必填；tone 由 adapter 依 `toneForAction()` 给出。
 *
 * 语义分域：动作使用 `--tone-*`，⛔ 不与风控（--risk-*）或行情（--mkt-*）混用。
 */
import ToneBadge from './ToneBadge.vue';
defineProps({
  text: { type: String, required: true },
  tone: { type: String, default: 'muted' },
  small: { type: Boolean, default: false },
  /** ★ M5-P8：hero 用大号形态（⛔ 此前调用方传 `large` 但未声明 ⇒ 静默失效 + 属性泄漏） */
  large: { type: Boolean, default: false }
});
</script>

<template>
  <span data-domain="action" aria-label="动作">
    <ToneBadge :text="text" :tone="tone" :small="small" :large="large" />
  </span>
</template>
