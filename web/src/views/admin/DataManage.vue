<script setup>
import { ref, onMounted } from 'vue';
import { adminApi } from '../../api/request.js';
import { formatDateTime } from '../../utils/format.js';

const loading = ref(true);
const error = ref('');
const logs = ref([]);
const triggering = ref('');
const triggerMsg = ref('');

// 数据源状态卡（key 与 fetch_log 的 source 字段一一对应）
const sources = [
  { name: '日线行情', key: 'daily', desc: '5 ETF 日线 OHLCV + 折溢价（腾讯优先，东财/新浪备份）' },
  { name: '实时行情', key: 'realtime', desc: '盘中 5 分钟实时快照（腾讯）' },
  { name: '美元指数', key: 'dollar_index', desc: '黄金ETF（518880）宏观（腾讯）' },
  { name: '存储价格', key: 'storage_price', desc: '中韩半导体ETF（513310）DRAM/NAND 现货价（CFM 闪存市场）' },
  { name: '黄金ETF持仓', key: 'gold_etf_holding', desc: '黄金ETF（518880）对应 GLD 持仓吨数（金小秘）' },
  { name: '美国实际利率', key: 'fred', desc: '黄金ETF（518880）宏观（FRED，需配 API Key）' },
  { name: '海外标的', key: 'global', desc: '美光/EWY/纳指/XBI 实时快照（腾讯，每日累积）' },
  { name: 'SEC财报', key: 'sec_financial', desc: '美光 10-Q/10-K 财报（SEC EDGAR 官方 API）' },
  { name: '新闻搜集', key: 'fundamental_news', aliases: ['eastmoney_fastnews', 'news', 'cninfo_holding', 'hkex_holding', 'dart_holding', 'hk_income', 'dart_financial', 'eastmoney_search', 'clinicaltrials', 'openfda', 'biotech_intel', 'etf_holdings'], desc: '赛道公告 / 港交所 / OpenDART / 东财搜索 / 临床与 FDA。点一次即可，约 5～8 分钟；超时未完成可再点。不要连点' },
  { name: 'LLM 提取', key: 'llm_extract', aliases: ['llm_global', 'llm_financial'], desc: '重仓股周评 + SEC 硬数字' }
];

async function load() {
  loading.value = true;
  error.value = '';
  try {
    const res = await adminApi.fetchLog();
    logs.value = res.list || [];
  } catch (e) {
    error.value = e.message || String(e);
  } finally {
    loading.value = false;
  }
}

async function trigger(task) {
  triggering.value = task;
  triggerMsg.value = '';
  try {
    const res = await adminApi.triggerFetch(task);
    triggerMsg.value = `已触发 ${task}：${JSON.stringify(res)}`;
    setTimeout(load, 1500);
  } catch (e) {
    triggerMsg.value = `触发失败：${e.message || e}`;
  } finally {
    triggering.value = '';
  }
}

// 最近日志源状态
function sourceStatus(s) {
  const keys = [s.key].concat(s.aliases || []);
  const recent = logs.value.filter((l) => {
    const src = String(l.source || '');
    const task = String(l.task_name || '');
    return keys.some((k) => src.indexOf(k) >= 0 || task.indexOf(k) >= 0);
  });
  if (recent.length === 0) return { label: '未知', tone: 'muted' };
  const last = recent[0];
  const liveRun = recent.find((l) => {
    if (l.status !== 'running') return false;
    const age = Date.now() - new Date(l.fetch_time).getTime();
    return Number.isFinite(age) && age <= 8 * 60 * 1000;
  });
  if (liveRun) return { label: '执行中', tone: 'warn' };
  if (last.status === 'running') return { label: '超时未完成', tone: 'bad' };
  if (last.status === 'success') return { label: '正常', tone: 'good' };
  if (last.status === 'partial') return { label: '降级', tone: 'warn' };
  return { label: '失败', tone: 'bad' };
}

function logTone(status) {
  if (status === 'success') return 'good';
  if (status === 'partial' || status === 'running') return 'warn';
  return 'bad';
}

/** 抓取日志表状态：与卡片侧 sourceStatus 语义对齐的中文 */
function logStatusLabel(status) {
  if (status === 'success') return '成功';
  if (status === 'running') return '运行中';
  if (status === 'partial') return '部分成功';
  if (status === 'fail' || status === 'failed' || status === 'error') return '失败';
  return status || '—';
}

onMounted(load);
</script>

<template>
  <div>
    <div v-if="error" class="warning-bar">{{ error }}</div>

    <!-- 数据源状态 -->
    <div class="card">
      <div class="card-title">数据源状态</div>
      <div class="grid-2">
        <div v-for="s in sources" :key="s.key" class="source-card">
          <div class="flex-between">
            <span class="source-name">{{ s.name }}</span>
            <span class="badge" :class="sourceStatus(s).tone">{{ sourceStatus(s).label }}</span>
          </div>
          <div class="text-2 text-small mt-8">{{ s.desc }}</div>
        </div>
      </div>
    </div>

    <!-- 抓取任务 + 手动触发 -->
    <div class="card">
      <div class="card-title">抓取任务 <span class="sub">手动触发</span></div>
      <div class="action-bar flex gap-8">
        <button class="btn" :disabled="triggering === 'fetchDailyData'" @click="trigger('fetchDailyData')">
          {{ triggering === 'fetchDailyData' ? '触发中…' : '触发日线抓取' }}
        </button>
        <button class="btn" :disabled="triggering === 'realtime'" @click="trigger('realtime')">
          {{ triggering === 'realtime' ? '触发中…' : '触发实时行情' }}
        </button>
        <button class="btn" :disabled="triggering === 'news'" @click="trigger('news')">
          {{ triggering === 'news' ? '触发中…' : '触发新闻/财报抓取' }}
        </button>
        <button class="btn" :disabled="triggering === 'extract'" @click="trigger('extract')">
          {{ triggering === 'extract' ? '触发中…' : '触发 LLM 提取' }}
        </button>
        <span v-if="triggerMsg" class="text-small text-2">{{ triggerMsg }}</span>
      </div>
    </div>

    <!-- fetch_log -->
    <div class="card">
      <div class="card-title">抓取日志</div>
      <div v-if="loading" class="empty">加载中…</div>
      <table v-else-if="logs.length" class="table">
        <thead>
          <tr><th>时间</th><th>来源</th><th>状态</th><th>条数</th><th>任务</th><th>耗时(ms)</th><th>错误</th></tr>
        </thead>
        <tbody>
          <tr v-for="(l, i) in logs" :key="i" :class="{ 'row-over': l.status === 'fail' }">
            <td>{{ formatDateTime(l.fetch_time) }}</td>
            <td>{{ l.source }}</td>
            <td><span class="badge" :class="logTone(l.status)">{{ logStatusLabel(l.status) }}</span></td>
            <td>{{ l.item_count }}</td>
            <td>{{ l.task_name || '—' }}</td>
            <td>{{ l.duration_ms || '—' }}</td>
            <td class="text-small text-2">{{ l.error || '—' }}</td>
          </tr>
        </tbody>
      </table>
      <div v-else class="empty">暂无抓取日志</div>
    </div>
  </div>
</template>

<style scoped>
.source-card { border: 1px solid #e5e7eb; border-radius: 8px; padding: 12px; }
.source-name { font-weight: 600; color: #111827; }

@media (max-width: 768px) {
  .action-bar .btn { flex: 1 1 calc(50% - 8px); min-height: 40px; justify-content: center; }
}
</style>
