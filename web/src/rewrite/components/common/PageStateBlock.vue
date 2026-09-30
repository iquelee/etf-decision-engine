<script setup>
/**
 * 页面状态块（web/src/rewrite/components/common/PageStateBlock.vue）
 * 规范依据：SPEC §9（缺失 / 异常状态机）
 *
 * 覆盖四种页面级状态：loading / error / empty / ready（ready 不渲染）。
 * ⛔ 不在加载中就渲染「0%」之类的假数据 —— 宁可显示骨架。
 *
 * ⚠️ 本组件原位于 `components/dashboard/`（M3），M4 起上移到 `components/common/`
 *    供工作台复用（⛔ 不复制第二份）；行为与文案默认值**逐字未变**（M3 测试即回归证据）。
 */
defineProps({
  /** 'loading' | 'error' | 'empty' */
  phase: { type: String, required: true },
  /** 错误文案（由 compose 层给出，⛔ 不回显原始堆栈） */
  error: { type: String, default: '' },
  /** 空态说明 */
  emptyText: { type: String, default: '后端未返回可展示的数据。' },
  /** 加载态副文案（各页可覆盖；默认保持 M3 文案） */
  loadingText: { type: String, default: '正在读取 /api/dashboard 与 /api/constants' },
  retryable: { type: Boolean, default: true }
});

defineEmits(['retry']);
</script>

<template>
  <div v-if="phase === 'loading'" class="state-block" role="status" aria-busy="true">
    <div class="state-title">读取中…</div>
    <div class="skeleton w60"></div>
    <div class="skeleton w30"></div>
    <p class="state-sub">{{ loadingText }}</p>
  </div>

  <div v-else-if="phase === 'error'" class="state-block error" role="alert">
    <div class="state-title">数据读取失败</div>
    <p class="state-sub">{{ error || '请求失败' }}</p>
    <button v-if="retryable" type="button" class="badge outline touch" @click="$emit('retry')">重试</button>
  </div>

  <div v-else-if="phase === 'empty'" class="state-block">
    <div class="state-title">暂无数据</div>
    <p class="state-sub">{{ emptyText }}</p>
    <button v-if="retryable" type="button" class="badge outline touch" @click="$emit('retry')">重新读取</button>
  </div>
</template>
