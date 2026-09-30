<script setup>
/**
 * 通用语义徽标（web/src/rewrite/components/domain/ToneBadge.vue）
 * 规范依据：SPEC §12.1（三套语义色域）
 *
 * tone 取值由 **adapter/domain** 决定（⛔ 不在组件里判断业务语义）：
 *   good / risk / accent / neutral / muted        —— 动作域（--tone-*）
 *   risk-normal / risk-yellow / risk-red / warn   —— 风控域（--risk-*）
 *   outline / mono / sm                           —— 形态修饰
 *
 * ⛔ 色值一律来自 tokens.css；⛔ 组件内不得出现十六进制色。
 */
defineProps({
  text: { type: String, required: true },
  tone: { type: String, default: 'muted' },
  dot: { type: Boolean, default: false },
  small: { type: Boolean, default: false }
});
</script>

<template>
  <span class="badge" :class="[tone, { sm: small }]">
    <span v-if="dot" class="status-dot"></span>{{ text }}
  </span>
</template>
