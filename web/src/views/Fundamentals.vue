<script setup>
import { ref, computed, onMounted, onBeforeUnmount } from 'vue';
import { api, adminApi } from '../api/request.js';
import { F_STATE_LABELS } from '../utils/constants.js';
import { formatDate } from '../utils/format.js';

const POLL_INTERVAL = 5 * 60 * 1000;

const loading = ref(true);
const error = ref('');
const list = ref([]);
const items = ref([]);
const total = ref(0);
const selected = ref('');
const typeFilter = ref('');
const isRefreshing = ref(false);
const refreshMsg = ref('');
let pollTimer = null;

const LAYER_LABELS = {
  hard_data: '硬数据',
  earnings: '景气与财报',
  events: '事件'
};
const LAYER_ORDER = ['hard_data', 'earnings', 'events'];

const TYPE_OPTIONS = [
  { key: '', label: '全部' },
  { key: 'financial', label: '财报' },
  { key: 'news', label: '公告' },
  { key: 'fastnews', label: '快讯' }
];
const TYPE_LABEL = {
  financial: '财报', fastnews: '快讯', news: '公告', signal: 'AI判断', macro: '宏观'
};
const TYPE_COLOR = {
  financial: '#2563eb', fastnews: '#d97706', news: '#4f46e5', signal: '#059669', macro: '#7c3aed'
};

const current = computed(() => list.value.find((e) => e.code === selected.value) || list.value[0] || null);

const groupedIndicators = computed(() => {
  const card = current.value;
  if (!card) return [];
  const groups = {};
  LAYER_ORDER.forEach((k) => { groups[k] = []; });
  (card.indicators || []).forEach((ind) => {
    const layer = groups[ind.layer] ? ind.layer : 'hard_data';
    groups[layer].push(ind);
  });
  return LAYER_ORDER
    .filter((k) => groups[k] && groups[k].length)
    .map((k) => ({ layer: k, label: LAYER_LABELS[k] || k, items: groups[k] }));
});

const aiList = computed(() => {
  const card = current.value;
  if (!card) return [];
  if (card.ai_judgments && card.ai_judgments.length) return card.ai_judgments;
  return (card.indicators || [])
    .filter((ind) => ind.metric_type === 'qualitative' && (ind.note || ind.value != null))
    .map((ind) => ({
      indicator: ind.indicator,
      title: ind.name,
      stock_name: '',
      stock_code: '',
      grade: ind.value,
      confidence: null,
      source: ind.source,
      source_label: ind.source_label || 'AI周评',
      reason: ind.note || '',
      week_date: ind.data_date || '',
      created_at: ind.data_date || ''
    }));
});

// P3.9：财报/公告按 ETF 属性严格区分——related 为空（市场杂音）不在 ETF 详情下显示
// P3.9：财报与公告列表去掉 AI 判断（signal）类型，AI 判断仍在上方"AI 关键判断"卡片展示
const filteredItems = computed(() => {
  const code = current.value ? current.value.code : '';
  return items.value.filter((i) => {
    if (i.type === 'macro' || i.type === 'signal') return false;
    if (typeFilter.value && i.type !== typeFilter.value) return false;
    if (!code) return true;
    const related = i.related || [];
    if (!related.length) return false; // 无 ETF 关联的杂音不在任何 ETF 详情下显示
    return related.indexOf(code) >= 0;
  });
});

function fLabel(s) { return F_STATE_LABELS[s] || s || '—'; }
function fTone(s) {
  if (s === 'F1' || s === 'F2') return 'good';
  if (s === 'F4') return 'warn';
  if (s === 'F5') return 'bad';
  return 'muted';
}
function layerTone(sig) {
  if (sig == null || Number.isNaN(Number(sig))) return '缺';
  if (sig >= 0.6) return '偏强';
  if (sig >= 0.2) return '偏稳';
  if (sig > -0.2) return '中性';
  if (sig > -0.6) return '偏弱';
  return '恶化';
}
function judgmentLine(card) {
  if (!card || !card.detail) return '尚无合成判断';
  const bd = card.detail.layer_breakdown || {};
  const parts = LAYER_ORDER.map((k) => {
    const row = bd[k];
    const count = row && row.count != null ? row.count : 0;
    if (!row || count === 0) return `${LAYER_LABELS[k]}缺`;
    return `${LAYER_LABELS[k]}${layerTone(row.signal)}`;
  });
  return parts.join(' · ');
}
function coverageText(card) {
  const w = card && card.detail ? Number(card.detail.total_layer_weight) : NaN;
  if (Number.isNaN(w)) return '—';
  return `${Math.round(w)}%`;
}
function signalText(card) {
  const v = card && card.detail ? card.detail.final_signal : null;
  if (v == null || Number.isNaN(Number(v))) return '—';
  return Number(v).toFixed(2);
}
function isQualitative(ind) { return ind && ind.metric_type === 'qualitative'; }
function gradeLabel(grade) {
  const map = { 1: '很差', 2: '较差', 3: '中性', 4: '较好', 5: '很好' };
  const n = Number(grade);
  return map[n] != null ? map[n] : '—';
}
function gradeClass(grade) {
  if (grade >= 4) return 'good';
  if (grade <= 2) return 'bad';
  return 'muted';
}
function dirClass(direction) {
  if (direction === 'up') return 'text-up';
  if (direction === 'down') return 'text-down';
  return 'text-flat';
}
function dirLabel(direction) {
  const map = { up: '↑ 升', down: '↓ 降', flat: '→ 平', na: '—' };
  return map[direction] || '—';
}
function formatTime(t) {
  if (!t) return '—';
  const s = String(t);
  return s.length > 10 ? s.slice(0, 16) : s;
}
function citationText(ind) {
  const cites = (ind && ind.citations) || [];
  if (!cites.length) return '';
  return cites.map((c) => c.stock_name || c.stock_code || c.title).filter(Boolean).slice(0, 6).join('、');
}
function selectEtf(code) {
  if (code === selected.value) return;
  selected.value = code;
  window.scrollTo(0, 0);
}

async function loadFundamentals(silent = false) {
  try {
    const fund = await api.fundamentals();
    list.value = fund.list || [];
    if (!selected.value && list.value[0]) selected.value = list.value[0].code;
    if (!silent) error.value = '';
  } catch (e) {
    if (!silent) error.value = e.message || String(e);
    throw e;
  }
}

async function loadIntel(silent = false) {
  try {
    const intel = await api.intel(80);
    items.value = intel.items || [];
    total.value = intel.total || 0;
  } catch (e) {
    // 情报失败不挡基本面主卡；静默时吞掉，首次仍提示
    if (!silent && !list.value.length) error.value = e.message || String(e);
  }
}

/** 基本面主数据与情报流拆开：情报慢/挂起时主卡仍能出来（修移动端「打不开」） */
async function load(silent = false) {
  if (!silent) loading.value = true;
  try {
    await loadFundamentals(silent);
  } catch (_) {
    /* error 已写 */
  } finally {
    if (!silent) loading.value = false;
  }
  await loadIntel(silent);
}

async function refresh() {
  if (isRefreshing.value) return;
  isRefreshing.value = true;
  refreshMsg.value = '正在抓取财报与公告…';
  const prevFirst = items.value[0] ? `${items.value[0].time}|${items.value[0].title}` : '';
  const prevTotal = total.value;
  try {
    let trig = { triggered: false, cooled: false };
    try {
      trig = await adminApi.intelRefresh() || trig;
    } catch (e) {
      refreshMsg.value = e.message || '触发抓取失败，先重载列表';
    }
    if (trig.cooled) {
      refreshMsg.value = `刚抓过，${trig.wait_sec || 0} 秒后再抓新源；先重载`;
    } else if (trig.triggered) {
      refreshMsg.value = '已触发抓取，等待写入…';
      await new Promise((r) => setTimeout(r, 10000));
    }
    await load(true);
    const nowFirst = items.value[0] ? `${items.value[0].time}|${items.value[0].title}` : '';
    if (nowFirst === prevFirst && total.value === prevTotal) {
      refreshMsg.value = trig.triggered
        ? `已抓取并重载 · 仍是 ${total.value} 条（源站可能还没新公告）`
        : `已重载 · ${total.value} 条`;
    } else {
      refreshMsg.value = `已更新 · 现在 ${total.value} 条`;
    }
  } finally {
    isRefreshing.value = false;
  }
}

function startPolling() {
  stopPolling();
  pollTimer = setInterval(() => load(true), POLL_INTERVAL);
}
function stopPolling() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}
function onVisibilityChange() {
  if (document.hidden) {
    stopPolling();
  } else {
    load(true);
    startPolling();
  }
}

onMounted(() => {
  load();
  startPolling();
  document.addEventListener('visibilitychange', onVisibilityChange);
});
onBeforeUnmount(() => {
  stopPolling();
  document.removeEventListener('visibilitychange', onVisibilityChange);
});
</script>

<template>
  <div>
    <div v-if="error" class="warning-bar">{{ error }}</div>
    <div v-if="loading && !list.length" class="empty">加载中…</div>
    <div v-else-if="!loading && !list.length" class="empty">暂无基本面数据</div>

    <template v-else-if="list.length">
      <div class="etf-sticky">
        <div class="etf-tabs">
          <button
            v-for="card in list"
            :key="card.code"
            class="etf-tab"
            :class="{ active: current && current.code === card.code }"
            @click="selectEtf(card.code)"
          >
            <span class="tab-name">{{ card.name }}</span>
            <span class="tab-code">{{ card.code }}</span>
            <span class="badge" :class="fTone(card.f_state)">{{ fLabel(card.f_state) }}</span>
          </button>
        </div>
      </div>

      <div v-if="current" class="card">
        <div class="card-title">
          <span>
            {{ current.name }}
            <span class="sub">{{ current.code }} · 最新基本面 {{ fLabel(current.f_state) }}<span v-if="current.f_state" class="etf-code"> {{ current.f_state }}</span>{{ current.updated_at ? ' · ' + current.updated_at : '' }}</span>
          </span>
        </div>
        <div class="summary-block">
          <div class="summary-line">{{ judgmentLine(current) }}</div>
          <div class="summary-meta">信号 {{ signalText(current) }} · 覆盖 {{ coverageText(current) }}</div>
        </div>

        <div v-if="!groupedIndicators.length" class="empty">基本面模板未配置</div>
        <div v-for="group in groupedIndicators" :key="group.layer" class="layer-block">
          <div class="layer-title">{{ group.label }}</div>
          <!-- 桌面：表格；手机：卡片（避免六列被裁切导致「打不开」体感） -->
          <table class="table indicator-table">
            <thead>
              <tr><th>指标</th><th>类型</th><th>最新值 / 等级</th><th>方向</th><th>日期</th><th>来源</th></tr>
            </thead>
            <tbody>
              <template v-for="ind in group.items" :key="ind.indicator">
                <tr>
                  <td>
                    <div>{{ ind.name }}</div>
                    <div class="text-small text-2">权重 {{ ind.weight }}</div>
                  </td>
                  <td class="text-2">{{ isQualitative(ind) ? '定性' : '量化' }}</td>
                  <td v-if="ind.value != null">
                    <span v-if="isQualitative(ind)" class="badge" :class="gradeClass(ind.value)">{{ gradeLabel(ind.value) }}</span>
                    <span v-else>{{ ind.value }}{{ ind.unit }}</span>
                  </td>
                  <td v-else class="text-2">{{ isQualitative(ind) ? '未判断' : '未录入' }}</td>
                  <td>
                    <span v-if="!isQualitative(ind) && ind.direction" :class="dirClass(ind.direction)">{{ dirLabel(ind.direction) }}</span>
                    <span v-else class="text-2">—</span>
                  </td>
                  <td class="text-2">{{ ind.data_date ? formatDate(ind.data_date) : '—' }}</td>
                  <td class="text-2">{{ ind.source_label || '—' }}</td>
                </tr>
                <tr v-if="ind.note">
                  <td colspan="6" class="text-small text-2 evidence-row">
                    依据：{{ ind.note }}
                  </td>
                </tr>
              </template>
            </tbody>
          </table>
          <div class="indicator-cards">
            <div v-for="ind in group.items" :key="'m-' + ind.indicator" class="indicator-card">
              <div class="ic-head">
                <div class="ic-name">{{ ind.name }}</div>
                <span class="ic-type">{{ isQualitative(ind) ? '定性' : '量化' }} · 权重 {{ ind.weight }}</span>
              </div>
              <div class="ic-value">
                <template v-if="ind.value != null">
                  <span v-if="isQualitative(ind)" class="badge" :class="gradeClass(ind.value)">{{ gradeLabel(ind.value) }}</span>
                  <span v-else class="ic-num">{{ ind.value }}{{ ind.unit }}</span>
                </template>
                <span v-else class="text-2">{{ isQualitative(ind) ? '未判断' : '未录入' }}</span>
                <span
                  v-if="!isQualitative(ind) && ind.direction"
                  class="ic-dir"
                  :class="dirClass(ind.direction)"
                >{{ dirLabel(ind.direction) }}</span>
              </div>
              <div class="ic-meta text-2">
                <span>{{ ind.data_date ? formatDate(ind.data_date) : '—' }}</span>
                <span>{{ ind.source_label || '—' }}</span>
              </div>
              <div v-if="ind.note" class="ic-note text-2">依据：{{ ind.note }}</div>
            </div>
          </div>
        </div>
      </div>

      <div v-if="current" class="card">
        <div class="card-title">
          AI 研究证据
          <span class="sub">{{ aiList.length ? `近 ${aiList.length} 条，仅作为基本面证据` : '暂无逐条判定，见上方指标依据' }}</span>
        </div>
        <div v-if="!aiList.length" class="empty">本周还没有 AI 逐条判定</div>
        <div v-else class="ai-list">
          <div v-for="(j, i) in aiList" :key="i" class="ai-item">
            <div class="ai-head">
              <span class="badge" :class="gradeClass(j.grade)">{{ gradeLabel(j.grade) }}</span>
              <span class="ai-title">{{ j.stock_name || j.title || j.indicator }}</span>
              <span class="ai-src">{{ j.source_label || j.source }}</span>
              <span class="ai-time">{{ formatTime(j.week_date || j.created_at) }}</span>
            </div>
            <div v-if="j.reason || j.title" class="ai-reason">{{ j.reason || j.title }}</div>
          </div>
        </div>
      </div>

      <div class="card">
        <div class="card-title">
          <span class="title-left">
            财报与公告
            <span class="sub">{{ current ? current.name : '' }} · 信息流 {{ total }} 条</span>
            <span v-if="refreshMsg" class="refresh-msg">{{ refreshMsg }}</span>
          </span>
          <button
            class="refresh-btn"
            :class="{ spinning: isRefreshing }"
            :disabled="isRefreshing"
            title="立刻抓取财报/公告并重载"
            @click="refresh"
          >
            <svg class="refresh-icon" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M20 12a8 8 0 1 1-2.34-5.66" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
              <path d="M20 3v5h-5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
            <span>刷新</span>
          </button>
        </div>
        <div class="flex gap-8 mb-12">
          <button
            v-for="t in TYPE_OPTIONS"
            :key="t.key"
            class="chip"
            :class="{ active: typeFilter === t.key }"
            @click="typeFilter = t.key"
          >{{ t.label }}</button>
        </div>
        <div v-if="!filteredItems.length" class="empty">该标的暂无对应财报或公告</div>
        <div v-else class="intel-list">
          <div v-for="(item, i) in filteredItems" :key="i" class="intel-item">
            <div class="intel-left">
              <span class="type-badge" :style="{ background: TYPE_COLOR[item.type] || '#6b7280' }">
                {{ TYPE_LABEL[item.type] || item.type_label }}
              </span>
            </div>
            <div class="intel-main">
              <div class="intel-head">
                <span class="intel-title">{{ item.title }}</span>
                <span class="intel-time">{{ formatTime(item.time) }}</span>
              </div>
              <div v-if="item.detail" class="intel-detail">{{ item.detail }}</div>
              <div class="intel-impact" :class="item.tone">
                <span class="impact-tag">{{ item.tone === 'up' ? '利好' : (item.tone === 'down' ? '利空' : '中性') }}</span>
                <span>{{ item.impact }}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.etf-sticky {
  position: sticky;
  top: var(--topnav-height, 58px);
  z-index: 40;
  background: var(--c-bg);
  margin: -8px 0 12px;
  padding: 8px 0 10px;
  border-bottom: 1px solid var(--c-border);
}
.etf-tabs {
  display: flex;
  gap: 8px;
  overflow-x: auto;
  scrollbar-width: none;
}
.etf-tabs::-webkit-scrollbar { display: none; }
.etf-tab {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 6px 10px; border: 1px solid #e5e7eb; border-radius: 999px;
  background: #fff; cursor: pointer; font-size: 13px; color: #374151;
  flex-shrink: 0;
}
.etf-tab.active { border-color: var(--c-primary); background: #eff6ff; font-weight: 600; color: #111827; }
.tab-name { white-space: nowrap; }
.tab-code { font-size: 11px; color: #9ca3af; }
.summary-block {
  background: #f8fafc; border: 1px solid var(--c-border);
  border-radius: 8px; padding: 10px 12px; margin-bottom: 14px;
}
.summary-line { font-size: 13px; color: #374151; line-height: 1.5; }
.summary-meta { margin-top: 4px; font-size: 12px; color: #6b7280; }
.layer-block { margin-bottom: 16px; }
.layer-block:last-child { margin-bottom: 0; }
.layer-title { font-size: 13px; font-weight: 600; color: #374151; margin: 4px 0 8px; }
.evidence-row { background: #f8fafc; }

.ai-list { display: flex; flex-direction: column; gap: 10px; }
.ai-item { background: #f8fafc; border: 1px solid var(--c-border); border-radius: 8px; padding: 10px 12px; }
.ai-head { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.ai-title { font-size: 13px; font-weight: 600; color: #111827; }
.ai-src { font-size: 11px; color: #6b7280; }
.ai-time { margin-left: auto; font-size: 11px; color: #9ca3af; }
.ai-reason { margin-top: 6px; font-size: 13px; color: #4b5563; line-height: 1.55; }

.card-title { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.title-left { display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap; }
.refresh-btn {
  display: inline-flex; align-items: center; gap: 5px; flex-shrink: 0;
  border: 1px solid var(--c-border); background: var(--c-bg); color: var(--c-text-2);
  border-radius: 6px; padding: 4px 12px; font-size: 12px; cursor: pointer;
}
.refresh-btn:disabled { opacity: 0.6; cursor: default; }
.refresh-icon { width: 13px; height: 13px; }
.refresh-btn.spinning .refresh-icon { animation: spin 0.8s linear infinite; }
.refresh-msg { font-size: 12px; font-weight: 400; color: var(--c-text-2); }
@keyframes spin { to { transform: rotate(360deg); } }

.mb-12 { margin-bottom: 12px; }
.chip {
  border: 1px solid var(--c-border); background: #fff; color: var(--c-text-2);
  border-radius: 999px; padding: 5px 14px; font-size: 13px; cursor: pointer;
}
.chip.active { background: var(--c-primary); border-color: var(--c-primary); color: #fff; }

@media (hover: hover) {
  
  .refresh-btn:hover:not(:disabled) { color: var(--c-primary); border-color: var(--c-primary); }
  
}

.intel-list { display: flex; flex-direction: column; }
.intel-item { display: flex; gap: 12px; padding: 14px 0; border-bottom: 1px solid var(--c-border); }
.intel-item:last-child { border-bottom: none; }
.intel-left { flex-shrink: 0; padding-top: 2px; }
.type-badge {
  display: inline-block; color: #fff; font-size: 11px; border-radius: 6px;
  padding: 2px 8px; white-space: nowrap;
}
.intel-main { flex: 1; min-width: 0; }
.intel-head { display: flex; align-items: baseline; gap: 10px; }
.intel-title { font-size: 14px; font-weight: 600; color: var(--c-text); flex: 1; }
.intel-time { font-size: 12px; color: var(--c-text-2); flex-shrink: 0; white-space: nowrap; }
.intel-detail { font-size: 13px; color: var(--c-text-2); margin-top: 4px; line-height: 1.5; }
.intel-impact {
  display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
  margin-top: 6px; font-size: 12px; color: var(--c-text-2);
  background: var(--c-bg); border-radius: 8px; padding: 6px 10px;
}
.impact-tag {
  font-size: 11px; font-weight: 600; border-radius: 4px; padding: 1px 6px;
  background: #e5e7eb; color: #6b7280;
}
.intel-impact.up .impact-tag { background: #fee2e2; color: #dc2626; }
.intel-impact.down .impact-tag { background: #d1fae5; color: #059669; }

@media (max-width: 768px) {
  .intel-title { font-size: 13px; }
  .indicator-table { display: none; }
  .indicator-cards { display: flex; flex-direction: column; gap: 8px; }
  .etf-tab { min-height: 40px; padding: 8px 12px; }
  .chip { min-height: 40px; padding: 8px 14px; }
}

/* 桌面隐藏卡片，手机隐藏表 */
.indicator-cards { display: none; }
.indicator-card {
  background: #f8fafc; border: 1px solid var(--c-border);
  border-radius: 10px; padding: 10px 12px;
}
.ic-head { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; }
.ic-name { font-size: 13px; font-weight: 600; color: #111827; }
.ic-type { font-size: 11px; color: #9ca3af; flex-shrink: 0; }
.ic-value { display: flex; align-items: center; gap: 10px; margin-top: 8px; flex-wrap: wrap; }
.ic-num { font-size: 16px; font-weight: 700; color: #111827; font-variant-numeric: tabular-nums; }
.ic-dir { font-size: 13px; font-weight: 600; }
.ic-meta {
  display: flex; justify-content: space-between; gap: 8px;
  margin-top: 6px; font-size: 12px;
}
.ic-note {
  margin-top: 6px; font-size: 12px; line-height: 1.5;
  padding-top: 6px; border-top: 1px dashed var(--c-border);
}

@media (hover: hover) {
  .etf-tab:hover { border-color: var(--c-primary); }
  .chip:hover { color: var(--c-primary); border-color: var(--c-primary); }
}
</style>
