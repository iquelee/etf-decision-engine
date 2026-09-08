<script setup>
import { ref, computed, onMounted, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api } from '../api/request.js';
import {
  SECTORS, W_STATE_LABELS, D_STATE_LABELS, H_STATE_LABELS, V_STATE_LABELS,
  ACTION_COLORS, actionLabel
} from '../utils/constants.js';
import { formatPercent } from '../utils/format.js';
import DataBadge from '../components/common/DataBadge.vue';
import KlineChart from '../components/charts/KlineChart.vue';
import RadarChart from '../components/charts/RadarChart.vue';

const route = useRoute();
const router = useRouter();
const currentCode = computed(() => route.params.code);

const loading = ref(true);
const error = ref('');
const detail = ref(null);
const kline = ref([]);
const etfs = ref([]);

const snapshot = computed(() => (detail.value ? detail.value.snapshot : null));
const decision = computed(() => (detail.value ? detail.value.decision : null));
const gen1 = computed(() => (detail.value ? detail.value.gen1 : null));

const addRadar = computed(() => {
  const s = snapshot.value;
  if (!s) return [];
  const volDrop = s.volume_ratio != null ? Math.max(0, (1 - s.volume_ratio) * 100) : 0;
  const trendScore = decision.value && decision.value.scores ? decision.value.scores.trend : 0;
  return [
    { name: '横盘天数', value: s.sideway_days || 0, max: 20 },
    { name: '量降%', value: Math.round(volDrop), max: 50 },
    { name: '价格位置', value: Math.round((s.price_position || 0) * 100), max: 100 },
    { name: '趋势', value: trendScore, max: 25 }
  ];
});

const defenseRadar = computed(() => {
  const s = snapshot.value;
  if (!s) return [];
  const trendScore = decision.value && decision.value.scores ? decision.value.scores.trend : 0;
  const volScore = decision.value && decision.value.scores ? decision.value.scores.volume : 0;
  return [
    { name: '放量滞涨', value: s.high_volume_stagnation ? 100 : 0, max: 100 },
    { name: '放量下跌', value: s.high_volume_decline ? 100 : 0, max: 100 },
    { name: '量价分', value: volScore, max: 25 },
    { name: '周线趋势', value: trendScore, max: 25 }
  ];
});

const change5dClass = computed(() => {
  const s = snapshot.value;
  const v = s ? s.change_5d : null;
  if (v == null || Number.isNaN(Number(v))) return 'text-flat';
  if (v > 0) return 'text-up';
  if (v < 0) return 'text-down';
  return 'text-flat';
});

async function loadEtfs() {
  try {
    const res = await api.etfList();
    etfs.value = res.list || [];
  } catch (e) { /* 忽略 */ }
}

async function load() {
  loading.value = true;
  error.value = '';
  const c = currentCode.value;
  try {
    detail.value = await api.etfDetail(c);
    kline.value = await api.kline(c, 'daily').catch(() => []);
  } catch (e) {
    error.value = e.message || String(e);
  } finally {
    loading.value = false;
  }
}

function switchEtf(c) {
  if (c !== currentCode.value) router.push(`/structure/${c}`);
}
function sectorLabel(s) { return SECTORS[s] || s; }
function stateLabel(kind, key) {
  const map = { W: W_STATE_LABELS, D: D_STATE_LABELS, H: H_STATE_LABELS, V: V_STATE_LABELS };
  return (map[kind] && map[kind][key]) || key || '—';
}
function trendContextLabel(ctx) {
  const map = {
    UP_CONSOLIDATION: '上涨后横盘',
    DOWN_CONSOLIDATION: '下跌后横盘',
    RANGE_CONSOLIDATION: '震荡中横盘'
  };
  return map[ctx] || '—';
}

onMounted(() => { loadEtfs(); load(); });
watch(currentCode, () => {
  window.scrollTo(0, 0);
  load();
});
</script>

<template>
  <div>
    <div v-if="etfs.length" class="etf-tabs">
      <button v-for="e in etfs" :key="e.code" class="etf-tab" :class="{ active: e.code === currentCode }" @click="switchEtf(e.code)">
        <span class="tab-name">{{ e.name }}</span>
        <span class="tab-code">{{ e.code }}</span>
      </button>
    </div>
    <div v-if="error" class="warning-bar">{{ error }}</div>
    <div v-if="loading && !detail" class="empty">加载中…</div>

    <template v-else-if="detail">
      <div class="card">
        <div class="flex-between">
          <div class="flex gap-12">
            <h2 class="detail-name">{{ detail.basic.name }} <span class="detail-code">{{ detail.basic.code }}</span></h2>
            <span class="badge primary">{{ sectorLabel(detail.basic.sector) }}</span>
            <span v-if="gen1" class="badge" :style="{ background: 'transparent', color: ACTION_COLORS[gen1.advisory.action_code] || '#6b7280', fontWeight: 700, fontSize: 14 }">
              {{ gen1.advisory.action_label }}
            </span>
          </div>
          <DataBadge :source="'行情'" :time="snapshot ? snapshot.calc_date : ''" :missing="!snapshot" />
        </div>
        <div class="mt-8 flex gap-12">
          <span class="text-2">近5日涨幅：<span :class="change5dClass">{{ snapshot && snapshot.change_5d != null ? formatPercent(snapshot.change_5d, 2, true) : '—' }}</span></span>
          <span v-if="gen1" class="text-2">Gen-1：{{ gen1.status.label }} · Fast Path {{ gen1.signal.fast_path }}</span>
        </div>
      </div>

      <div class="card">
        <div class="card-title">K线 · 量价</div>
        <KlineChart :data="kline" />
      </div>

      <div class="grid-2">
        <div>
          <div class="card" :class="{ 'module-missing': !snapshot }">
            <div class="card-title">阶段识别 <span class="sub">周线·日线·横盘·量能</span></div>
            <div v-if="snapshot" class="state-grid">
              <div class="state-cell"><span class="st-label">周线</span><span class="st-val">{{ stateLabel('W', snapshot.w_state) }}<span class="etf-code"> {{ snapshot.w_state }}</span></span></div>
              <div class="state-cell"><span class="st-label">日线</span><span class="st-val">{{ stateLabel('D', snapshot.d_state) }}<span class="etf-code"> {{ snapshot.d_state }}</span></span></div>
              <div class="state-cell"><span class="st-label">横盘</span><span class="st-val">{{ stateLabel('H', snapshot.h_state) }}<span class="etf-code"> {{ snapshot.h_state }}</span></span></div>
              <div class="state-cell"><span class="st-label">量能</span><span class="st-val">{{ stateLabel('V', snapshot.v_state) }}<span class="etf-code"> {{ snapshot.v_state }}</span></span></div>
            </div>
          </div>
          <div class="card" :class="{ 'module-missing': !snapshot }">
            <div class="card-title">横盘详情 <span class="sub">四重确认</span></div>
            <div v-if="snapshot" class="state-grid">
              <div class="state-cell"><span class="st-label">趋势背景</span><span class="st-val">{{ trendContextLabel(snapshot.trend_context) }}</span></div>
              <div class="state-cell"><span class="st-label">横盘天数</span><span class="st-val">{{ snapshot.sideway_days }} 天</span></div>
              <div class="state-cell"><span class="st-label">区间振幅</span><span class="st-val">{{ snapshot.sideway_range != null ? snapshot.sideway_range + '%' : '—' }}</span></div>
              <div class="state-cell"><span class="st-label">MA20斜率</span><span class="st-val">{{ snapshot.ma20_slope != null ? snapshot.ma20_slope + '%' : '—' }}</span></div>
              <div class="state-cell"><span class="st-label">横盘评分</span><span class="st-val">{{ snapshot.consolidation_score != null ? snapshot.consolidation_score : '—' }}</span></div>
            </div>
          </div>
        </div>
        <div>
          <div class="card" :class="{ 'module-missing': !snapshot || !snapshot.data_complete }">
            <RadarChart :indicators="addRadar" title="加仓雷达" />
            <DataBadge v-if="snapshot && !snapshot.data_complete" :missing="true" />
          </div>
          <div class="card" :class="{ 'module-missing': !snapshot }">
            <RadarChart :indicators="defenseRadar" title="防守雷达" />
          </div>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.etf-tabs {
  position: sticky;
  top: var(--topnav-height, 58px);
  z-index: 40;
  display: flex;
  gap: 8px;
  margin: -8px 0 14px;
  padding: 8px 0 10px;
  overflow-x: auto;
  scrollbar-width: none;
  background: var(--c-bg, #f5f7fa);
  border-bottom: 1px solid var(--c-border, #e8ecf1);
}
.etf-tabs::-webkit-scrollbar { display: none; }
.etf-tab { display: flex; align-items: center; gap: 6px; padding: 8px 14px; border: 1px solid #e5e7eb; border-radius: 999px; background: #fff; cursor: pointer; font-size: 13px; color: #374151; transition: var(--transition); flex-shrink: 0; }
.etf-tab.active { border-color: var(--c-primary, #2563eb); background: #eff6ff; font-weight: 600; color: #111827; }
.tab-name { white-space: nowrap; }
.tab-code { font-size: 11px; color: #9ca3af; }
.detail-name { margin: 0; font-size: 18px; color: #111827; }
.detail-code { font-size: 13px; color: #9ca3af; font-weight: 400; }
.state-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.state-cell { background: #f9fafb; border-radius: 6px; padding: 10px; }
.st-label { display: block; font-size: 11px; color: #6b7280; margin-bottom: 4px; }
.st-val { font-size: 13px; color: #111827; }

@media (hover: hover) {
  .etf-tab:hover { border-color: var(--c-primary, #2563eb); box-shadow: var(--shadow-sm); }
}

@media (max-width: 900px) {
  .state-grid { grid-template-columns: 1fr; }
}
</style>
