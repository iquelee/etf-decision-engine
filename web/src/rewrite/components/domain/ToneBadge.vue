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
  small: { type: Boolean, default: false },
  /**
   * ★ M5-P8（2026-10-01）新增：大号形态 —— 供「正式决策」hero 使用。
   *   此前调用方传了 `large` 但本组件**未声明**该 prop ⇒ 落到 `$attrs` 变成 DOM 属性，
   *   同时尺寸强调**静默失效**（正式决策与普通行同样大小）。现补齐声明。
   */
  large: { type: Boolean, default: false }
});
</script>

<template>
  <span class="badge" :class="[tone, { sm: small, lg: large }]">
    <span v-if="dot" class="status-dot"></span>{{ text }}
  </span>
</template>
