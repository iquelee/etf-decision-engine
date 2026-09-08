<script setup>
import { ref, computed, onMounted } from 'vue';
import { api, adminApi } from '../../api/request.js';
import { formatDateTime } from '../../utils/format.js';
import { etfName } from '../../utils/etf.js';
import { RISK_FLAG_LABELS } from '../../utils/constants.js';

const loading = ref(true);
const error = ref('');
const events = ref([]);
const etfs = ref([]);

const form = ref({ code: 'ALL', event_type: 'policy', risk_flag: 'RED', risk_override: false, reason: '' });
const resolving = ref(null);
const resolveReason = ref('');

const activeOverride = computed(() => events.value.some((e) => e.status === 'active' && e.risk_override));

const eventTypes = [
  { key: 'falsify', label: '证伪' },
  { key: 'policy', label: '政策' },
  { key: 'tech', label: '技术路线' },
  { key: 'demand', label: '需求' },
  { key: 'structure', label: '结构' },
  { key: 'other', label: '其他' }
];

function typeLabel(t) {
  const m = eventTypes.find((x) => x.key === t);
  return m ? m.label : t;
}

function riskFlagLabel(flag) {
  return RISK_FLAG_LABELS[flag] || flag || '—';
}

function riskFlagTone(flag) {
  if (flag === 'RED') return 'bad';
  if (flag === 'YELLOW') return 'warn';
  return 'good';
}

async function load() {
  loading.value = true;
  error.value = '';
  try {
    const res = await adminApi.riskList();
    events.value = res.list || [];
  } catch (e) {
    error.value = e.message || String(e);
  } finally {
    loading.value = false;
  }
}

async function loadEtfs() {
  try {
    const res = await api.etfList();
    etfs.value = res.list || [];
  } catch (e) { /* 忽略 */ }
}

async function trigger() {
  if (!form.value.reason) { window.alert('理由必填'); return; }
  try {
    await adminApi.postRisk({
      code: form.value.code,
      event_type: form.value.event_type,
      risk_flag: form.value.risk_flag,
      risk_override: form.value.risk_override,
      reason: form.value.reason
    });
    form.value.reason = '';
    await load();
  } catch (e) {
    error.value = e.message || String(e);
  }
}

function startResolve(ev) {
  resolving.value = ev._id;
  resolveReason.value = '';
}

async function confirmResolve(ev) {
  if (!resolveReason.value) { window.alert('解除必须填写解除理由'); return; }
  try {
    await adminApi.postRisk({ action: 'resolve', event_id: ev._id, resolve_reason: resolveReason.value });
    resolving.value = null;
    resolveReason.value = '';
    await load();
  } catch (e) {
    error.value = e.message || String(e);
  }
}

onMounted(() => { load(); loadEtfs(); });
</script>

<template>
  <div>
    <div v-if="error" class="warning-bar">{{ error }}</div>

    <!-- 激活中的 override 常驻红条 -->
    <div v-if="activeOverride" class="override-bar">
      <strong>⚠ 存在激活中的强制减仓事件</strong>，决策引擎已进入防守/熔断模式。
    </div>

    <!-- 触发表单 -->
    <div class="card">
      <div class="card-title">触发风险事件</div>
      <div class="grid-2">
        <div class="form-row">
          <label class="form-label">ETF 范围</label>
          <select v-model="form.code" class="select" style="width:220px">
            <option value="ALL">全部 ETF</option>
            <option v-for="e in etfs" :key="e.code" :value="e.code">{{ e.name }}（{{ e.code }}）</option>
          </select>
        </div>
        <div class="form-row">
          <label class="form-label">事件类型</label>
          <select v-model="form.event_type" class="select">
            <option v-for="t in eventTypes" :key="t.key" :value="t.key">{{ t.label }}</option>
          </select>
        </div>
        <div class="form-row">
          <label class="form-label">风险等级</label>
          <select v-model="form.risk_flag" class="select">
            <option value="RED">熔断</option>
            <option value="YELLOW">暂停加仓</option>
          </select>
        </div>
        <div class="form-row">
          <label class="form-label">处置方式</label>
          <select v-model="form.risk_override" class="select">
            <option :value="false">暂停加仓（提醒，默认）</option>
            <option :value="true">强制减仓/清仓</option>
          </select>
        </div>
        <div class="text-small text-2" style="margin:-6px 0 2px">默认仅提醒并暂停加仓；仅产业逻辑证伪 / 重大政策熔断等强信号才选「强制减仓」。</div>
      </div>
      <div class="form-row">
        <label class="form-label">理由（必填，留痕可审计）</label>
        <textarea v-model="form.reason" class="textarea" placeholder="说明触发原因，如：核心产业逻辑被证伪 / 重大政策变化…"></textarea>
      </div>
      <button class="btn danger" @click="trigger">触发事件（联动重算）</button>
    </div>

    <!-- 事件列表 -->
    <div class="card">
      <div class="card-title">事件列表</div>
      <div v-if="loading" class="empty">加载中…</div>
      <table v-else-if="events.length" class="table">
        <thead>
          <tr><th>触发时间</th><th>ETF</th><th>类型</th><th>风险等级</th><th>强制减仓</th><th>状态</th><th>理由</th><th>操作</th></tr>
        </thead>
        <tbody>
          <tr v-for="ev in events" :key="ev._id" :class="{ 'row-over': ev.status === 'active' && ev.risk_override }">
            <td>{{ formatDateTime(ev.trigger_time) }}</td>
            <td>
              <span class="etf-cell">
                <span class="etf-name">{{ etfName(ev.code, etfs) }}</span>
                <span v-if="ev.code && ev.code !== 'ALL'" class="etf-code">{{ ev.code }}</span>
              </span>
            </td>
            <td>{{ typeLabel(ev.event_type) }}</td>
            <td><span class="badge" :class="riskFlagTone(ev.risk_flag)">{{ riskFlagLabel(ev.risk_flag) }}</span></td>
            <td>{{ ev.risk_override ? '是' : '否' }}</td>
            <td><span class="badge" :class="ev.status === 'active' ? 'bad' : 'good'">{{ ev.status === 'active' ? '生效' : '已解除' }}</span></td>
            <td class="text-small text-2">{{ ev.reason }}<template v-if="ev.note && ev.status !== 'active'"> → {{ ev.note }}</template></td>
            <td>
              <span v-if="ev.status === 'active'">
                <span v-if="resolving === ev._id" class="flex gap-8">
                  <input v-model="resolveReason" class="input" style="width:160px" placeholder="解除理由（必填）" />
                  <button class="btn primary" @click="confirmResolve(ev)">确认解除</button>
                </span>
                <button v-else class="btn" @click="startResolve(ev)">解除</button>
              </span>
              <span v-else class="text-2 text-small">已解除</span>
            </td>
          </tr>
        </tbody>
      </table>
      <div v-else class="empty">暂无风险事件</div>
    </div>
  </div>
</template>

<style scoped>
@media (max-width: 768px) {
  .grid-2 { grid-template-columns: 1fr; }
  .form-row .select { width: 100% !important; }
}
</style>
