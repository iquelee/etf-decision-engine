<script setup>
import { ref, onMounted } from 'vue';
import { adminApi } from '../../api/request.js';

const loading = ref(true);
const error = ref('');
const data = ref(null);

async function load() {
  loading.value = true;
  error.value = '';
  try { data.value = await adminApi.gen1Health(); }
  catch (e) { error.value = e.message || String(e); }
  finally { loading.value = false; }
}

function pct(v) {
  if (v == null || Number.isNaN(Number(v))) return '—';
  const n = Number(v);
  return `${(n <= 1.5 ? n * 100 : n).toFixed(1)}%`;
}
</script>

<template>
  <div>
    <div v-if="error" class="warning-bar">{{ error }}</div>
    <div class="card">
      <div class="card-title">Gen-1 运行健康 <button class="btn" @click="load">刷新</button></div>
      <div v-if="loading" class="empty">加载中…</div>
      <template v-else-if="data">
        <div class="health-grid">
          <div><span>模型</span><strong>{{ data.model_id }}</strong></div>
          <div><span>冻结工件</span><strong>{{ data.frozen ? '已冻结' : '未冻结' }}</strong></div>
          <div><span>主建议</span><strong>{{ data.advisory_enabled ? '已启用' : '已暂停' }}</strong></div>
          <div><span>快速通道</span><strong>{{ data.fast_path_enabled ? '已启用' : '已关闭' }}</strong></div>
          <div><span>自动交易</span><strong>{{ data.auto_trading }}</strong></div>
          <div><span>核验日期</span><strong>{{ data.today }}</strong></div>
        </div>
      </template>
    </div>

    <div v-if="data" class="card">
      <div class="card-title">最新 EOD 信号 <span class="sub">仅供模型运行核验，不是人工交易建议</span></div>
      <table class="table">
        <thead><tr><th>ETF</th><th>信号日</th><th>状态</th><th>概率</th><th>规则许可</th><th>Fast Path</th></tr></thead>
        <tbody>
          <tr v-for="row in data.rows" :key="row.code">
            <td>{{ row.name }} <span class="etf-code">{{ row.code }}</span></td>
            <td>{{ row.signal_date || '—' }}</td>
            <td><span class="badge" :class="row.fresh ? 'good' : 'warn'">{{ row.status }}</span></td>
            <td>{{ pct(row.probability) }}</td>
            <td>{{ row.permission || '—' }}</td>
            <td>{{ row.fast_path_candidate ? '候选' : '未触发' }}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<style scoped>
.health-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 14px; }
.health-grid > div { display: flex; flex-direction: column; gap: 4px; background: #f8fafc; padding: 10px; border-radius: 8px; }
.health-grid span { color: #64748b; font-size: 12px; }
.health-grid strong { color: #111827; font-size: 14px; }
@media (max-width: 768px) { .health-grid { grid-template-columns: repeat(2, 1fr); } }
</style>
