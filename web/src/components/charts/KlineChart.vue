<script setup>
import { ref, onMounted, onBeforeUnmount, watch } from 'vue';
import * as echarts from 'echarts';

// K线 + 量价图（ECharts candlestick + bar）
const props = defineProps({
  data: { type: Array, default: () => [] }
});

const el = ref(null);
let chart = null;

function isMobile() {
  return !!(chart && chart.getWidth() < 768);
}

function render() {
  if (!chart) return;
  const rows = props.data || [];
  if (rows.length === 0) {
    chart.clear();
    chart.setOption({ title: { text: '暂无 K 线数据', left: 'center', top: 'middle', textStyle: { color: '#9ca3af', fontSize: 13 } } });
    return;
  }
  const dates = rows.map((d) => d.date);
  const candles = rows.map((d) => [d.open, d.close, d.low, d.high]);
  const volumes = rows.map((d) => d.volume || 0);
  const ma20 = calcMA(rows.map((d) => d.close), 20);
  const ma60 = calcMA(rows.map((d) => d.close), 60);
  const mobile = isMobile();
  const left = mobile ? 38 : 50;
  const right = mobile ? 12 : 20;

  chart.setOption({
    animation: false,
    tooltip: {
      trigger: 'axis',
      // 触屏用 line，避免 cross 十字线难操作
      axisPointer: { type: mobile ? 'line' : 'cross' }
    },
    legend: { data: ['K线', 'MA20', 'MA60'], top: 0, textStyle: { fontSize: mobile ? 11 : 12 } },
    grid: [
      { left, right, top: 28, height: '60%' },
      { left, right, top: '76%', height: '14%' }
    ],
    xAxis: [
      { type: 'category', data: dates, boundaryGap: true, axisLabel: { show: false } },
      { type: 'category', data: dates, gridIndex: 1, axisLabel: { show: false } }
    ],
    yAxis: [
      { scale: true, gridIndex: 0, splitLine: { lineStyle: { color: '#f3f4f6' } }, axisLabel: { fontSize: mobile ? 10 : 12 } },
      { gridIndex: 1, axisLabel: { show: false }, splitLine: { show: false } }
    ],
    dataZoom: [
      {
        type: 'inside',
        xAxisIndex: [0, 1],
        start: 60,
        end: 100,
        zoomOnMouseWheel: true,
        moveOnMouseMove: true
      },
      {
        type: 'slider',
        xAxisIndex: [0, 1],
        bottom: 0,
        // 手机端加高滑块，手指可拖
        height: mobile ? 24 : 16,
        start: 60,
        end: 100,
        handleSize: mobile ? '120%' : '100%'
      }
    ],
    series: [
      {
        name: 'K线', type: 'candlestick', data: candles,
        itemStyle: { color: '#ef4444', color0: '#10b981', borderColor: '#ef4444', borderColor0: '#10b981' }
      },
      { name: 'MA20', type: 'line', data: ma20, smooth: true, showSymbol: false, lineStyle: { width: 1, color: '#f59e0b' } },
      { name: 'MA60', type: 'line', data: ma60, smooth: true, showSymbol: false, lineStyle: { width: 1, color: '#3b82f6' } },
      {
        name: '成交量', type: 'bar', xAxisIndex: 1, yAxisIndex: 1, data: volumes,
        itemStyle: { color: '#cbd5e1' }
      }
    ]
  }, true);
}

function calcMA(values, n) {
  const result = new Array(values.length).fill(null);
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= n) sum -= values[i - n];
    if (i >= n - 1) result[i] = +(sum / n).toFixed(3);
  }
  return result;
}

function onResize() {
  if (!chart) return;
  chart.resize();
  render();
}

onMounted(() => {
  chart = echarts.init(el.value);
  render();
  window.addEventListener('resize', onResize);
});

onBeforeUnmount(() => {
  window.removeEventListener('resize', onResize);
  if (chart) { chart.dispose(); chart = null; }
});

watch(() => props.data, render, { deep: true });
</script>

<template>
  <div ref="el" class="kline-chart"></div>
</template>

<style scoped>
.kline-chart { width: 100%; height: 360px; }
@media (max-width: 768px) {
  .kline-chart { height: 400px; }
}
</style>
