<script setup>
import { ref, computed, onMounted, watch } from 'vue';
import { api, adminApi } from '../../api/request.js';
import { formatDirection, dash } from '../../utils/format.js';

const loading = ref(true);
const error = ref('');
const etfs = ref([]);
const selectedCode = ref('');
const configs = ref([]);
const seriesMap = ref({}); // indicator -> 最新一条
const holdings = ref([]);
const holdingsDate = ref('');
const vetoInputs = ref({});
const inputs = ref({}); // indicator -> { value, source, data_date, confidence, note }
const weightInputs = ref({}); // indicator -> weight 数值
const saving = ref('');
const savingWeight = ref('');

async function loadEtfs() {
  try {
    const res = await api.etfList();
    etfs.value = res.list || [];
    if (etfs.value.length && !selectedCode.value) selectedCode.value = etfs.value[0].code;
  } catch (e) {
    error.value = e.message || String(e);
  }
}

async function loadConfigs() {
  if (!selectedCode.value) return;
  loading.value = true;
  error.value = '';
  try {
    const res = await adminApi.fundamentalConfig(selectedCode.value);
    configs.value = (res.configs || []).filter((c) => (Number(c.weight) || 0) > 0);
    seriesMap.value = {};
    inputs.value = {};
    weightInputs.value = {};
    vetoInputs.value = {};
    const hold = await adminApi.etfHoldings(selectedCode.value).catch(() => ({ holdings: [] }));
    holdings.value = hold.holdings || [];
    holdingsDate.value = hold.report_date || '';
    for (const cfg of configs.value) {
      const s = await adminApi.fundamentalSeries(selectedCode.value, cfg.indicator).catch(() => ({ series: [] }));
      seriesMap.value[cfg.indicator] = s.series && s.series.length ? s.series[0] : null;
      inputs.value[cfg.indicator] = { value: '', source: cfg.source === 'manual' ? 'manual' : 'manual', data_date: '', confidence: '', note: '' };
      weightInputs.value[cfg.indicator] = cfg.weight || 0;
      vetoInputs.value[cfg.indicator] = { grade: '', note: '' };
    }
  } catch (e) {
    error.value = e.message || String(e);
  } finally {
    loading.value = false;
  }
}

async function save(indicator) {
  const inp = inputs.value[indicator];
  if (!inp || inp.value === '') { window.alert('请填写本次值'); return; }
  if (inp.confidence === '' || inp.confidence == null) { window.alert('置信度 confidence 必填'); return; }

  saving.value = indicator;
  try {
    await adminApi.addFundamentalData({
      code: selectedCode.value,
      indicator,
      value: Number(inp.value),
      source: inp.source || 'manual',
      confidence: Number(inp.confidence),
      data_date: inp.data_date || undefined,
      note: inp.note || ''
    });
    inp.value = '';
    inp.data_date = '';
    inp.note = '';
    await loadConfigs();
  } catch (e) {
    error.value = e.message || String(e);
  } finally {
    saving.value = '';
  }
}

// 保存单个指标的权重
async function saveWeight(indicator) {
  const w = Number(weightInputs.value[indicator]);
  if (w == null || Number.isNaN(w) || w < 0 || w > 100) { window.alert('权重需为 0~100 的数字'); return; }
  savingWeight.value = indicator;
  try {
    const cfg = configs.value.find((c) => c.indicator === indicator);
    await adminApi.saveFundamentalConfig({
      code: selectedCode.value,
      configs: [{
        indicator,
        name: cfg ? cfg.name : '',
        weight: w,
        freq: cfg ? cfg.freq : 'monthly',
        source: cfg ? cfg.source : 'manual',
        unit: cfg ? cfg.unit : '',
        metric_type: cfg ? cfg.metric_type : 'quantitative'
      }]
    });
    await loadConfigs();
  } catch (e) {
    error.value = e.message || String(e);
  } finally {
    savingWeight.value = '';
  }
}

// 定性指标（metric_type=qualitative）由 AI 自动提取，不提供人工录入
function isQualitative(cfg) {
  return cfg && cfg.metric_type === 'qualitative';
}
function gradeLabel(grade) {
  const map = { 1: '很差', 2: '较差', 3: '中性', 4: '较好', 5: '很好' };
  return map[grade] != null ? map[grade] : '未判断';
}
function gradeClass(grade) {
  if (grade >= 4) return 'good';
  if (grade <= 2) return 'bad';
  return 'muted';
}

async function veto(indicator) {
  const v = vetoInputs.value[indicator];
  if (!v || v.grade === '' || v.grade == null) { window.alert('请选择否决等级 1~5'); return; }
  if (!v.note) { window.alert('否决必须填写理由'); return; }
  saving.value = indicator;
  try {
    await adminApi.addFundamentalData({
      code: selectedCode.value,
      indicator,
      value: Number(v.grade),
      source: 'manual_veto',
      confidence: 0.95,
      note: v.note
    });
    v.grade = '';
    v.note = '';
    await loadConfigs();
  } catch (e) {
    error.value = e.message || String(e);
  } finally {
    saving.value = '';
  }
}

watch(selectedCode, loadConfigs);
onMounted(loadEtfs);
</script>

<template>
  <div>
    <div v-if="error" class="warning-bar">{{ error }}</div>

    <!-- ETF 选择 -->
    <div class="card">
      <div class="card-title">基本面数据录入</div>
      <div class="action-bar flex gap-8">
        <button
          v-for="e in etfs"
          :key="e.code"
          class="btn"
          :class="{ primary: selectedCode === e.code }"
          @click="selectedCode = e.code"
        >{{ e.name }}<span class="etf-code"> {{ e.code }}</span></button>
      </div>
    </div>

    <div v-if="holdings.length" class="card">
      <div class="card-title">前十大重仓 <span class="sub">{{ holdingsDate || '待抓取' }} · AI 按持股公告/快讯判定</span></div>
      <table class="table">
        <thead><tr><th>#</th><th>代码</th><th>名称</th><th>占净值</th><th>市场</th></tr></thead>
        <tbody>
          <tr v-for="h in holdings" :key="h.stock_code">
            <td>{{ h.rank }}</td><td>{{ h.stock_code }}</td><td>{{ h.stock_name }}</td>
            <td>{{ h.weight }}%</td><td>{{ h.market || '—' }}</td>
          </tr>
        </tbody>
      </table>
    </div>

    <div class="card">
      <div class="card-title">雷达模板指标 <span class="sub">硬数据自动；定性周评，可人工否决</span></div>
      <div v-if="loading" class="empty">加载中…</div>
      <table v-else-if="configs.length" class="table">
        <thead>
          <tr>
            <th>指标</th><th>上次值</th><th>方向</th><th>本次值</th><th>来源</th>
            <th>数据日期</th><th>置信度(0~1)</th><th>操作</th>
          </tr>
        </thead>
        <tbody>
          <template v-for="cfg in configs" :key="cfg.indicator">
            <!-- 定性指标：AI 自动提取，只读展示 -->
            <tr v-if="isQualitative(cfg)">
              <td>
                <div>{{ cfg.name || cfg.indicator }}</div>
                <div class="flex gap-4" style="align-items:center;margin-top:4px">
                  <span class="text-small text-2">权重</span>
                  <input v-model="weightInputs[cfg.indicator]" type="number" min="0" max="100" class="input" style="width:64px" />
                  <button class="btn" :disabled="savingWeight === cfg.indicator" @click="saveWeight(cfg.indicator)">
                    {{ savingWeight === cfg.indicator ? '…' : '保存' }}
                  </button>
                </div>
                <div class="text-small text-2">{{ cfg.indicator }} · 定性 · AI 自动提取</div>
              </td>
              <td colspan="3">
                <span v-if="seriesMap[cfg.indicator]" class="badge" :class="gradeClass(seriesMap[cfg.indicator].value)">
                  {{ gradeLabel(seriesMap[cfg.indicator].value) }}
                </span>
                <span v-else class="text-2">未判断（等待 AI 提取）</span>
                <span v-if="seriesMap[cfg.indicator]" class="text-small text-2"> · {{ seriesMap[cfg.indicator].data_date || '' }}</span>
              </td>
              <td colspan="3">
                <div class="text-small text-2">周评自动定级；可否决本周等级</div>
                <div class="flex gap-4" style="align-items:center;margin-top:4px">
                  <select v-model="vetoInputs[cfg.indicator].grade" class="select" style="width:88px">
                    <option value="">改级</option>
                    <option :value="5">5 很好</option>
                    <option :value="4">4 较好</option>
                    <option :value="3">3 中性</option>
                    <option :value="2">2 较差</option>
                    <option :value="1">1 很差</option>
                  </select>
                  <input v-model="vetoInputs[cfg.indicator].note" class="input" placeholder="否决理由" style="width:160px" />
                  <button class="btn" :disabled="saving === cfg.indicator" @click="veto(cfg.indicator)">否决</button>
                </div>
                <div v-if="seriesMap[cfg.indicator] && seriesMap[cfg.indicator].note" class="text-small text-2" style="margin-top:4px">
                  依据：{{ seriesMap[cfg.indicator].note }}
                </div>
              </td>
            </tr>
            <!-- 量化指标：人工录入数值 -->
            <tr v-else>
              <td>
                <div>{{ cfg.name || cfg.indicator }}</div>
                <div class="flex gap-4" style="align-items:center;margin-top:4px">
                  <span class="text-small text-2">权重</span>
                  <input v-model="weightInputs[cfg.indicator]" type="number" min="0" max="100" class="input" style="width:64px" />
                  <button class="btn" :disabled="savingWeight === cfg.indicator" @click="saveWeight(cfg.indicator)">
                    {{ savingWeight === cfg.indicator ? '…' : '保存' }}
                  </button>
                </div>
                <div class="text-small text-2">{{ cfg.indicator }} · {{ cfg.freq }} · {{ cfg.unit }}</div>
              </td>
              <td>{{ seriesMap[cfg.indicator] ? seriesMap[cfg.indicator].value : '—' }}</td>
              <td>{{ seriesMap[cfg.indicator] ? formatDirection(seriesMap[cfg.indicator].direction) : '—' }}</td>
              <td><input v-model="inputs[cfg.indicator].value" type="number" step="any" class="input" style="width:100px" placeholder="数值" /></td>
              <td>
                <select v-model="inputs[cfg.indicator].source" class="select" style="width:100px">
                  <option value="manual">人工</option>
                  <option value="eastmoney">东财</option>
                  <option value="fred">FRED</option>
                </select>
              </td>
              <td><input v-model="inputs[cfg.indicator].data_date" type="date" class="input" style="width:140px" /></td>
              <td><input v-model="inputs[cfg.indicator].confidence" type="number" step="0.1" min="0" max="1" class="input" style="width:80px" placeholder="0.9" /></td>
              <td>
                <button class="btn primary" :disabled="saving === cfg.indicator" @click="save(cfg.indicator)">
                  {{ saving === cfg.indicator ? '保存中…' : '保存' }}
                </button>
              </td>
            </tr>
          </template>
        </tbody>
      </table>
      <div v-else class="empty">该 ETF 暂无雷达模板</div>
    </div>
  </div>
</template>

<style scoped>
@media (max-width: 768px) {
  .action-bar .btn { min-height: 40px; }
  .grid-2 { grid-template-columns: 1fr; }
}
</style>
