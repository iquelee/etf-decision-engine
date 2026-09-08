<script setup>
/**
 * Gen-2 Selection Shadow 只读观察页（工作包 5）
 * 展示：现任 CORE / 挑战者 / Alpha 排名 / 数据状态 / 约束结果。
 * 边界：Gen-2 仅有 selection_share / candidate_weight 观察权限；
 *       final_target_pct 由 V3.6.1 Safety Core 产出，本页不读取、不展示。
 */
import { ref, computed, onMounted } from 'vue';
import { adminApi } from '../../api/request.js';
import { formatDate, formatDateTime } from '../../utils/format.js';

const loading = ref(true);
const error = ref('');
const data = ref(null);

const roleOrder = { CORE: 0, CHALLENGER: 1, SATELLITE: 2, RESERVE: 3, HEDGE: 4 };

const roleLabel = {
  CORE: '核心', CHALLENGER: '挑战者', SATELLITE: '卫星', RESERVE: '储备', HEDGE: '对冲'
};
const roleTone = {
  CORE: 'good', CHALLENGER: 'warn', SATELLITE: 'muted', RESERVE: 'muted', HEDGE: 'primary'
};

const confTone = { FULL: 'good', DEGRADED: 'warn', LIMITED: 'bad' };

const ranked = computed(() => {
  const rows = (data.value && data.value.rankings) || [];
  return rows.slice().sort((a, b) => {
    if (roleOrder[a.role] !== roleOrder[b.role]) return roleOrder[a.role] - roleOrder[b.role];
    return (a.rank ?? 999) - (b.rank ?? 999);
  });
});

const cores = computed(() => ranked.value.filter((r) => r.role === 'CORE'));
const challengers = computed(() => ranked.value.filter((r) => r.role === 'CHALLENGER'));

function pct(v) {
  if (v == null || Number.isNaN(Number(v))) return '—';
  return (Number(v) * 100).toFixed(1) + '%';
}

function score(v) {
  if (v == null || Number.isNaN(Number(v))) return '—';
  return Number(v).toFixed(1);
}

async function load() {
  loading.value = true;
  error.value = '';
  try {
    data.value = await adminApi.gen2Shadow();
  } catch (e) {
    error.value = e.message || String(e);
  } finally {
    loading.value = false;
  }
}

onMounted(load);
</script>

<template>
  <div>
    <div v-if="error" class="warning-bar">{{ error }}</div>

    <div v-if="loading" class="empty">加载中…</div>

    <template v-else-if="data && data.selection">
      <!-- 运行概览 -->
      <div class="card">
        <div class="card-title">运行概览 <span class="sub">只读观察 · 不影响正式仓位</span></div>
        <div class="overview-grid">
          <div class="ov-item">
            <div class="ov-label">运行日期</div>
            <div class="ov-value">{{ formatDate(data.selection.run_date) }}</div>
          </div>
          <div class="ov-item">
            <div class="ov-label">应到交易日</div>
            <div class="ov-value">{{ formatDate(data.selection.as_of_trade_date) }}</div>
          </div>
          <div class="ov-item">
            <div class="ov-label">模式</div>
            <div class="ov-value">{{ data.selection.mode || '—' }}</div>
          </div>
          <div class="ov-item">
            <div class="ov-label">选池置信度</div>
            <div class="ov-value">
              <span class="badge" :class="confTone[data.selection.selection_confidence] || 'muted'">
                {{ data.selection.selection_confidence || '—' }}
              </span>
            </div>
          </div>
          <div class="ov-item">
            <div class="ov-label">合格/排名</div>
            <div class="ov-value">{{ data.selection.eligible_count ?? '—' }} / {{ data.selection.ranked_count ?? '—' }}</div>
          </div>
          <div class="ov-item">
            <div class="ov-label">池覆盖</div>
            <div class="ov-value">{{ data.selection.universe_coverage || '—' }}</div>
          </div>
          <div class="ov-item">
            <div class="ov-label">角色分类</div>
            <div class="ov-value">{{ data.selection.role_classification || '—' }}</div>
          </div>
          <div class="ov-item">
            <div class="ov-label">状态</div>
            <div class="ov-value"><span class="badge good">{{ data.selection.status }}</span></div>
          </div>
        </div>
        <div v-if="data.selection.confidence_reason" class="text-small text-2 mt-8">
          置信度说明：{{ data.selection.confidence_reason }}
        </div>
      </div>

      <!-- 现任 CORE -->
      <div class="card">
        <div class="card-title">现任核心（CORE）</div>
        <table v-if="cores.length" class="table">
          <thead>
            <tr>
              <th>排名</th><th>代码</th><th>名称</th><th>分组</th><th>Alpha</th>
              <th>趋势门</th><th>regime</th><th>持久天数</th><th>候选权重</th><th>防守</th><th>原因</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="r in cores" :key="r.code">
              <td>{{ r.rank }}</td>
              <td>{{ r.code }}</td>
              <td>{{ r.name || '—' }}</td>
              <td>{{ r.correlation_cluster || '—' }}</td>
              <td>{{ score(r.alpha_score_v2) }}</td>
              <td><span class="badge" :class="r.trend_gate ? 'good' : 'bad'">{{ r.trend_gate ? '过' : '破' }}</span></td>
              <td>{{ r.regime || '—' }}</td>
              <td>{{ r.persistence_days ?? '—' }}</td>
              <td>{{ pct(r.candidate_weight) }}</td>
              <td>{{ r.defense_state || '—' }}</td>
              <td class="text-small text-2">{{ r.reason_codes || '—' }}</td>
            </tr>
          </tbody>
        </table>
        <div v-else class="empty">暂无 CORE</div>
      </div>

      <!-- 挑战者 -->
      <div class="card">
        <div class="card-title">挑战者（CHALLENGER）</div>
        <table v-if="challengers.length" class="table">
          <thead>
            <tr>
              <th>排名</th><th>代码</th><th>名称</th><th>分组</th><th>Alpha</th>
              <th>趋势门</th><th>持久天数</th><th>原因</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="r in challengers" :key="r.code">
              <td>{{ r.rank }}</td>
              <td>{{ r.code }}</td>
              <td>{{ r.name || '—' }}</td>
              <td>{{ r.correlation_cluster || '—' }}</td>
              <td>{{ score(r.alpha_score_v2) }}</td>
              <td><span class="badge" :class="r.trend_gate ? 'good' : 'bad'">{{ r.trend_gate ? '过' : '破' }}</span></td>
              <td>{{ r.persistence_days ?? '—' }}</td>
              <td class="text-small text-2">{{ r.reason_codes || '—' }}</td>
            </tr>
          </tbody>
        </table>
        <div v-else class="empty">暂无挑战者</div>
      </div>

      <!-- 全池排名 -->
      <div class="card">
        <div class="card-title">全池横截面 <span class="sub">按 Alpha 排名</span></div>
        <table v-if="ranked.length" class="table">
          <thead>
            <tr>
              <th>排名</th><th>代码</th><th>名称</th><th>分组</th><th>Alpha</th>
              <th>角色</th><th>候选权重</th><th>原因</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="r in ranked" :key="r.code">
              <td>{{ r.rank }}</td>
              <td>{{ r.code }}</td>
              <td>{{ r.name || '—' }}</td>
              <td>{{ r.correlation_cluster || '—' }}</td>
              <td>{{ score(r.alpha_score_v2) }}</td>
              <td><span class="badge" :class="roleTone[r.role] || 'muted'">{{ roleLabel[r.role] || r.role }}</span></td>
              <td>{{ pct(r.candidate_weight) }}</td>
              <td class="text-small text-2">{{ r.reason_codes || '—' }}</td>
            </tr>
          </tbody>
        </table>
        <div v-else class="empty">暂无排名数据</div>
      </div>
    </template>

    <div v-else-if="!loading && !error" class="empty">尚无 Gen-2 已完成的运行快照</div>
  </div>
</template>

<style scoped>
.overview-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 14px; }
.ov-item { border: 1px solid var(--c-border, #e5e7eb); border-radius: 8px; padding: 12px; }
.ov-label { font-size: 12px; color: var(--c-text-2, #6b7280); }
.ov-value { font-size: 15px; font-weight: 600; color: var(--c-text, #111827); margin-top: 4px; }
@media (max-width: 900px) { .overview-grid { grid-template-columns: repeat(2, 1fr); } }
</style>
