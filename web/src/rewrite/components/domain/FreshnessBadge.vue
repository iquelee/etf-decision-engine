<script setup>
/**
 * 数据新鲜度徽标（web/src/rewrite/components/domain/FreshnessBadge.vue）
 * 规范依据：SPEC §9
 *
 * ★ 必须区分四态，⛔ 不得只显示一个「更新时间」：
 *   FRESH（数据新鲜）/ STALE（数据已过期）/ MISSING（无时间戳）
 *   文案由 `domain/freshness.js#describe()` 经 adapter 给出；
 *   ⛔ 本组件不自行拼「几天前」这类相对时间文案。
 */
import { computed } from 'vue';

const props = defineProps({
  /** adapter 的 freshness 对象：{ level, ageHours, slaHours, text } */
  freshness: { type: Object, required: true }
});

const cls = computed(() => {
  const l = String(props.freshness.level || '').toUpperCase();
  if (l === 'FRESH') return 'fresh';
  if (l === 'STALE') return 'stale';
  return 'missing';
});

const title = computed(() => {
  const f = props.freshness;
  if (f.ageHours === null || f.ageHours === undefined) return '数据源未提供时间戳';
  return '数据时点距今 ' + Math.round(f.ageHours) + ' 小时（SLA ' + f.slaHours + ' 小时）';
});
</script>

<template>
  <span class="freshness" :class="cls" :title="title" role="status">
    <span class="dot"></span>{{ freshness.text }}
  </span>
</template>
