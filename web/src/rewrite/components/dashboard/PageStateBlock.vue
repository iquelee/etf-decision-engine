<script setup>
/**
 * 页面状态块（web/src/rewrite/components/dashboard/PageStateBlock.vue）
 * 规范依据：SPEC §9（缺失/异常状态机）
 *
 * 覆盖四种页面级状态：loading / error / empty / ready(不渲染)。
 * ⛔ 不在加载中就渲染「0%」之类的假数据 —— 宁可显示骨架。
 */
defineProps({
  /** 'loading' | 'error' | 'empty' */
  phase: { type: String, required: true },
  /** 错误文案（由 compose 层给出，⛔ 不回显原始堆栈） */
  error: { type: String, default: '' },
  /** 空态说明 */
  emptyText: { type: String, default: '后端未返回可展示的数据。' },
  retryable: { type: Boolean, default: true }
});

defineEmits(['retry']);
</script>

<template>
  <div v-if="phase === 'loading'" class="state-block" role="status" aria-busy="true">
    <div class="state-title">读取中…</div>
    <div class="skeleton w60"></div>
    <div class="skeleton w30"></div>
    <p class="state-sub">正在读取 /api/dashboard 与 /api/constants</p>
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
