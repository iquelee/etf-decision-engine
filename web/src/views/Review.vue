<script setup>
import { ref, computed, onMounted } from 'vue';
import { api } from '../api/request.js';
import { ACTION_COLORS, ACTION_LIST, actionLabel } from '../utils/constants.js';
import { formatPercent } from '../utils/format.js';
import { etfName, etfLabel } from '../utils/etf.js';

const loading = ref(true);
const error = ref('');
const data = ref(null);
const etfs = ref([]);
const filters = ref({ code: '', from: '', to: '', action: '' });

const etfCodes = computed(() => {
  const codes = new Set((etfs.value || []).map((e) => e.code));
  (data.value ? data.value.decisions : []).forEach((d) => { if (d.code) codes.add(d.code); });
  return [...codes];
});

const filteredDecisions = computed(() => {
  const rows = data.value ? data.value.decisions : [];
  const f = filters.value;
  return rows.filter((r) => {
    if (f.code && r.code !== f.code) return false;
    if (f.from && r.decision_date < f.from) return false;
    if (f.to && r.decision_date > f.to) return false;
    if (f.action && r.final_action !== f.action) return false;
    return true;
  });
});

const filteredDeviations = computed(() => {
  const rows = data.value ? data.value.deviations : [];
  const f = filters.value;
  return rows.filter((r) => {
    if (f.code && r.code !== f.code) return false;
    if (f.from && r.date < f.from) return false;
    if (f.to && r.date > f.to) return false;
    if (f.action && r.system_action !== f.action) return false;
    return true;
  });
});

const filterNote = computed(() => (filters.value.code || filters.value.action)
  ? '复盘统计与明细均已应用当前筛选条件'
  : '');

function adviceSource(row) {
  return row && row.gen1 && row.gen1.status && row.gen1.status.code === 'FAST_PATH_ACTIVE'
    ? '来源：Gen-1 Fast Path'
    : '来源：V3.6.1 / Safety Core';
}

function positionSource(row) {
  if (!row || row.current_position == null) return '无可用仓位记录';
  const source = row.position_source === 'TRADE_LOG' ? '成交记录' : '组合快照';
  const precision = row.position_is_exact ? '当日' : '参考';
  return `${row.position_as_of_date || '日期未知'} · ${source} · ${precision}`;
}

function tradeActionLabel(action) {
  return action === 'buy' ? '买入' : (action === 'sell' ? '卖出' : '—');
}

function comparisonClass(result) {
  if (result === '已执行') return 'good';
  if (result === '反向操作') return 'bad';
  return 'muted';
}

function matchLabel(type) {
  if (type === 'decision_id') return '精确关联';
  if (type === 'same_direction_actionable') return '同向可执行建议';
  if (type === 'nearest_daily_decision') return '最近日级建议';
  return '—';
}

async function load() {
  loading.value = true;
  error.value = '';
  try {
    const [review, listRes] = await Promise.all([
      api.review(
        filters.value.from || undefined,
        filters.value.to || undefined,
        filters.value.code || undefined,
        filters.value.action || undefined
      ),
      etfs.value.length ? Promise.resolve(null) : api.etfList().catch(() => ({ list: [] }))
    ]);
    data.value = review;
    if (listRes && listRes.list) etfs.value = listRes.list;
  } catch (e) {
    error.value = e.message || String(e);
  } finally {
    loading.value = false;
  }
}

function applyFilter() { load(); }

onMounted(load);
</script>

<template>
  <div>
    <div v-if="error" class="warning-bar">{{ error }}</div>

    <!-- 筛选 -->
    <div class="card">
      <div class="flex gap-8">
        <select v-model="filters.code" class="select" style="width:220px" @change="applyFilter">
          <option value="">全部 ETF</option>
          <option v-for="c in etfCodes" :key="c" :value="c">{{ etfLabel(c, etfs) }}</option>
        </select>
        <input v-model="filters.from" type="date" class="input" style="width:150px" placeholder="起始日期" @change="applyFilter" />
        <input v-model="filters.to" type="date" class="input" style="width:150px" placeholder="结束日期" @change="applyFilter" />
        <select v-model="filters.action" class="select" style="width:120px" @change="applyFilter">
          <option value="">全部动作</option>
          <option v-for="a in ACTION_LIST" :key="a" :value="a">{{ actionLabel(a) }}</option>
        </select>
      </div>
    </div>

    <div v-if="loading" class="empty">加载中…</div>

    <template v-else-if="data">
      <!-- 统计卡 -->
      <div class="card">
        <div class="card-title">复盘统计 <span v-if="filterNote" class="sub">{{ filterNote }}</span></div>
        <div class="overview-grid">
          <div class="ov-item"><span class="ov-label">决策快照数</span><span class="ov-value">{{ data.stats.decision_snapshot_count }}</span></div>
          <div class="ov-item"><span class="ov-label">可执行建议</span><span class="ov-value">{{ data.stats.actionable_count }}</span></div>
          <div class="ov-item"><span class="ov-label">执行率</span><span class="ov-value">{{ data.stats.execution_rate != null ? data.stats.execution_rate + '%' : '—' }}</span></div>
          <div class="ov-item"><span class="ov-label">反向操作</span><span class="ov-value">{{ data.stats.reverse_operation_count }}</span></div>
          <div class="ov-item"><span class="ov-label">未执行</span><span class="ov-value">{{ data.stats.unexecuted_count }}</span></div>
          <div class="ov-item"><span class="ov-label">建仓/加仓执行率</span><span class="ov-value">{{ data.stats.build_execution_rate != null ? data.stats.build_execution_rate + '%' : '—' }}</span></div>
          <div class="ov-item"><span class="ov-label">防守执行率</span><span class="ov-value">{{ data.stats.defense_execution_rate != null ? data.stats.defense_execution_rate + '%' : '—' }}</span></div>
          <div class="ov-item"><span class="ov-label">平均响应天数</span><span class="ov-value">{{ data.stats.avg_response_days != null ? data.stats.avg_response_days : '—' }}</span></div>
        </div>
      </div>

      <!-- 决策快照时间轴 -->
      <div class="card">
        <div class="card-title">决策快照时间轴</div>
        <div v-if="filteredDecisions.length === 0" class="empty">暂无信号</div>
        <div v-else class="timeline">
          <div class="tl-head">
            <span>时间</span>
            <span>标的</span>
            <span>EOD 信号状态</span>
            <span>最终建议</span>
            <span>仓位（数据日）</span>
          </div>
          <div v-for="d in filteredDecisions" :key="d._id || d.code + d.decision_date" class="tl-row">
            <span class="tl-date">{{ d.decision_date }}</span>
            <span class="etf-cell">
              <span class="etf-name">{{ etfName(d.code, etfs) }}</span>
              <span class="etf-code">{{ d.code }}</span>
            </span>
            <span class="tl-score">
              {{ d.gen1 && d.gen1.status ? d.gen1.status.label : '—' }}
              <small v-if="d.gen1 && d.gen1.status && d.gen1.status.message">{{ d.gen1.status.message }}</small>
            </span>
            <span class="tl-action" :style="{ color: ACTION_COLORS[d.gen1 && d.gen1.advisory ? d.gen1.advisory.action_code : d.final_action] || '#6b7280' }">
              {{ d.gen1 && d.gen1.advisory ? d.gen1.advisory.action_label : actionLabel(d.final_action, d.action_label) }}
              <small>{{ adviceSource(d) }}</small>
            </span>
            <span class="tl-pos">
              {{ formatPercent(d.current_position) }}
              <small>{{ positionSource(d) }}</small>
            </span>
          </div>
        </div>
      </div>

      <!-- 偏差表 -->
      <div class="card">
        <div class="card-title">系统建议与实际操作 <span class="sub">5 个日历日内的日级对照；每笔操作仅关联一次</span></div>
        <div v-if="filteredDeviations.length === 0" class="empty">暂无偏差记录</div>
        <table v-else class="table">
          <thead><tr><th>决策日</th><th>操作日</th><th>标的</th><th>系统最终建议</th><th>实际操作</th><th>对照结果</th><th>关联方式</th></tr></thead>
          <tbody>
            <tr v-for="d in filteredDeviations" :key="d.decision_id || d.code + d.date">
              <td>{{ d.date }}</td>
              <td>{{ d.operation_date || '—' }}</td>
              <td><span class="etf-cell"><span class="etf-name">{{ etfName(d.code, etfs) }}</span><span class="etf-code">{{ d.code }}</span></span></td>
              <td>{{ actionLabel(d.system_action) }}</td>
              <td>{{ tradeActionLabel(d.actual_action) }}</td>
              <td>
                <span class="badge" :class="comparisonClass(d.deviation)">{{ d.deviation }}</span>
              </td>
              <td>{{ matchLabel(d.matched_by) }}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- 实际操作记录（去敏：仅方向与仓位，不含股数金额；决策未生成的日期显示「待生成」） -->
      <div class="card">
        <div class="card-title">实际操作记录</div>
        <div v-if="(data.trades || []).length === 0" class="empty">暂无操作记录</div>
        <table v-else class="table">
          <thead><tr><th>日期</th><th>标的</th><th>操作</th><th>操作后仓位</th><th>关联系统建议</th></tr></thead>
          <tbody>
            <tr v-for="(t, i) in data.trades" :key="t.trade_date + t.code + i">
              <td>{{ t.trade_date }}</td>
              <td><span class="etf-cell"><span class="etf-name">{{ etfName(t.code, etfs) }}</span><span class="etf-code">{{ t.code }}</span></span></td>
              <td><span class="badge" :class="t.action === 'buy' ? 'good' : 'bad'">{{ t.action === 'buy' ? '买入' : '卖出' }}</span></td>
              <td>{{ t.position_after != null ? formatPercent(t.position_after) : '—' }}</td>
              <td>
                {{ t.system_action ? actionLabel(t.system_action) : '无信号（待生成）' }}
                <small v-if="t.system_decision_date" class="cell-note">决策日：{{ t.system_decision_date }}{{ t.system_match_type === 'prior_decision' ? '（最近前序）' : '' }}</small>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </template>
  </div>
</template>

<style scoped>
.overview-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; }
.ov-item { display: flex; flex-direction: column; gap: 4px; }
.ov-label { font-size: 12px; color: #6b7280; }
.ov-value { font-size: 18px; font-weight: 600; color: #111827; }
.sub { font-size: 12px; font-weight: 400; color: #6b7280; margin-left: 8px; }
.timeline { max-height: 520px; overflow: auto; }
.tl-head, .tl-row {
  display: grid;
  grid-template-columns: 110px minmax(180px, 1.35fr) minmax(150px, 1.1fr) minmax(130px, .9fr) minmax(140px, .9fr);
  gap: 12px;
  align-items: center;
}
.tl-head {
  position: sticky; top: 0; z-index: 1;
  padding: 8px 4px; font-size: 12px; color: #6b7280; font-weight: 500;
  background: #f8fafc; border-bottom: 1px solid #e8ecf1;
}
.tl-row { padding: 10px 4px; border-bottom: 1px solid #f3f4f6; }
.tl-date { font-size: 13px; color: #6b7280; }
.tl-action { font-weight: 700; }
.tl-score, .tl-pos { font-size: 13px; color: #374151; font-variant-numeric: tabular-nums; }
.tl-score small, .tl-action small, .tl-pos small, .cell-note { display: block; margin-top: 3px; font-size: 11px; font-weight: 400; line-height: 1.35; color: #6b7280; }

@media (max-width: 900px) {
  .overview-grid { grid-template-columns: repeat(2, 1fr); gap: 10px; }
}
@media (max-width: 768px) {
  .overview-grid { grid-template-columns: repeat(2, 1fr); }
}
</style>
