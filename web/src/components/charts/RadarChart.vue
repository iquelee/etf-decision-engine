<script setup>
import { ref, onMounted, onBeforeUnmount, watch } from 'vue';
import * as echarts from 'echarts';

// 雷达图（加仓雷达/防守雷达/基本面雷达）
// indicators: [{ name, value, max }]
const props = defineProps({
  indicators: { type: Array, default: () => [] },
  title: { type: String, default: '' }
});

const el = ref(null);
let chart = null;

function render() {
  if (!chart) return;
  const inds = props.indicators || [];
  if (inds.length === 0) {
    chart.clear();
    chart.setOption({ title: { text: '暂无雷达数据', left: 'center', top: 'middle', textStyle: { color: '#9ca3af', fontSize: 13 } } });
    return;
  }
  const names = inds.map((i) => i.name);
  const maxVal = Math.max(...inds.map((i) => i.max || 100));
  const values = inds.map((i) => (i.value != null ? i.value : 0));

  chart.setOption({
    title: props.title ? { text: props.title, left: 'center', top: 0, textStyle: { fontSize: 13, color: '#374151' } } : undefined,
    tooltip: {},
    radar: {
      indicator: inds.map((i) => ({ name: i.name, max: i.max || maxVal })),
      radius: '65%',
      center: ['50%', '58%'],
      axisName: { color: '#6b7280', fontSize: 11 }
    },
    series: [{
      type: 'radar',
      data: [{
        value: values,
        name: props.title || '评分',
        areaStyle: { color: 'rgba(37, 99, 235, 0.18)' },
        lineStyle: { color: '#2563eb', width: 2 },
        itemStyle: { color: '#2563eb' }
      }]
    }]
  });
}

function onResize() { chart && chart.resize(); }

onMounted(() => {
  chart = echarts.init(el.value);
  render();
  window.addEventListener('resize', onResize);
});

onBeforeUnmount(() => {
  window.removeEventListener('resize', onResize);
  if (chart) { chart.dispose(); chart = null; }
});

watch(() => props.indicators, render, { deep: true });
</script>

<template>
  <div ref="el" class="radar-chart"></div>
</template>

<style scoped>
.radar-chart { width: 100%; height: 280px; }
</style>
