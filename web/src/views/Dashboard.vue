<script setup>
import { ref, onMounted } from 'vue';
import { api } from '../api/request.js';
import { SECTORS, ACTION_COLORS, actionLabel, RISK_FLAG_LABELS, marketRegimeLabel } from '../utils/constants.js';
import { formatAmount, formatPercent } from '../utils/format.js';
import DataBadge from '../components/common/DataBadge.vue';
import RiskAlertBar from '../components/common/RiskAlertBar.vue';
import { useRouter } from 'vue-router';

const router = useRouter();
const loading = ref(true);
const error = ref('');
const data = ref(null);

// 浮盈默认隐藏（隐私），点击小眼睛切换显示。
const reveal = ref({ pnl: false });
function toggleReveal(key) { reveal.value[key] = !reveal.value[key]; }
function maskAmount(v) { return v != null ? '****' : '—'; }

async function load() {
  loading.value = true;
  error.value = '';
  try {
    data.value = await api.dashboard();
  } catch (e) {
    error.value = e.message || String(e);
  } finally {
    loading.value = false;
  }
}

function sectorLabel(s) { return SECTORS[s] || s; }
function goDetail(code) { router.push(`/etf/${code}`); }

// 仓位文案：减仓/加仓时明确"减到/加到多少"
function positionText(c) {
  const hasCurrent = c.current_position != null;
  if (!hasCurrent) {
    const target = c.final_target != null ? c.final_target : c.target_std;
    return target != null ? `策略目标 ${target}%` : '策略目标 —';
  }
  const cur = c.current_position;
  const sug = c.suggest_position;
  const a = c.action;
  if (sug == null) return `当前 ${cur}%`;
  if (a === 'STRATEGIC_REDUCE' && Math.abs(Number(sug) - Number(cur)) < 0.15) {
    return `当前 ${cur}% · 已无可减空间`;
  }
  if (a === 'TACTICAL_REDUCE' || a === 'STRATEGIC_REDUCE' || a === 'EXIT') return `当前 ${cur}% → 减到 ${sug}%`;
  if (a === 'ADD' || a === 'BUILD') return `当前 ${cur}% → 加到 ${sug}%`;
  return `当前 ${cur}%`;
}

// 前台主口径来自 API 的 gen1 view-model；旧卡片字段仅作为兼容兜底。
function primaryAction(c) {
  return (c.gen1 && c.gen1.advisory && c.gen1.advisory.action_label)
    || actionLabel(c.action, c.action_label);
}
function primaryTarget(c) {
  const g = c.gen1 && c.gen1.advisory;
  if (g && g.target_label) return g.target_label;
  return c.final_target != null ? `策略目标 ${c.final_target}%` : '暂无目标仓位';
}
function primaryPosition(c) {
  const g = c.gen1 && c.gen1.advisory;
  const current = g && g.current_pct != null ? g.current_pct : c.current_position;
  const delta = g && g.delta_pct;
  if (current == null) return '当前仓位 —';
  if (delta != null && Math.abs(Number(delta)) >= 0.1) return `当前 ${current}% · 本次 ${delta > 0 ? '+' : ''}${delta}pct`;
  return `当前 ${current}% · 本次不调整`;
}
function gen1Status(c) { return c.gen1 && c.gen1.status ? c.gen1.status.label : '状态待更新'; }
function fastPath(c) { return c.gen1 && c.gen1.signal ? c.gen1.signal.fast_path : '—'; }
function applicabilityLabel(c) { return c && c.gen1 && c.gen1.applicability ? c.gen1.applicability.label : '待核验'; }
function regimeTone(regime) {
  const value = String(regime || '').toLowerCase();
  if (['aggressive', 'structural'].includes(value)) return 'good';
  if (['defensive', 'crisis'].includes(value)) return 'bad';
  return 'neutral';
}

// 涨跌色（行情语义，涨红跌绿；与风险/安全色隔离）
function pnlClass(n) {
  if (n == null || Number.isNaN(Number(n))) return 'text-flat';
  if (n > 0) return 'text-up';
  if (n < 0) return 'text-down';
  return 'text-flat';
}


function fmtPct(v) {
  if (v == null || Number.isNaN(Number(v))) return '—';
  return `${Number(v).toFixed(Number.isInteger(Number(v)) ? 0 : 1)}%`;
}
onMounted(load);
</script>

<template>
  <div>
    <div v-if="error" class="warning-bar">昨日数据未到，显示前值：{{ error }}</div>
    <div v-if="data && data.overview && data.overview.leverage_alert" class="warning-bar leverage-bar">
      账面隐杠杆：合计仓位 {{ formatPercent(data.overview.total_book_pct) }}（现金约 {{ formatPercent(data.overview.cash_ratio_raw) }}）。
      超额部分来自多票合计超 100%，与回测 book 口径一致；去杠杆收益见 VERSION / 回测报告。
    </div>

    <div v-if="loading" class="empty">加载中…</div>

    <template v-else-if="data">
      <!-- 首页语义固定为：市场环境 / Gen-1 建议 / 风险状态，禁止混用。 -->
      <div class="hero">
        <div class="headline">
          <span class="headline-status" :class="regimeTone(data.three_questions.market_regime)">
            市场环境：{{ marketRegimeLabel(data.three_questions.market_regime) }}
          </span>
          <span>Gen-1：{{ data.three_questions.gen1_advice || '数据待更新' }}</span>
          <span>风险：{{ data.three_questions.risk_status || data.overview?.overall_risk || '—' }}</span>
        </div>
      </div>


      <!-- 轻量系统状态：不与 ETF 主建议竞争注意力。 -->
      <div v-if="data.ml_shadow" class="shadow-status" :class="{ on: data.ml_shadow.enabled }">
        <div class="shadow-col">
          <div class="shadow-kicker">Gen-1 趋势启动增强</div>
          <div class="shadow-title">{{ data.ml_shadow.enabled ? '运行正常' : '当前暂停' }}</div>
          <div class="shadow-sub">{{ data.ml_shadow.capability?.headline || '趋势排序：状态待更新' }} · {{ data.ml_shadow.capability?.live_headline || '实时经济验证：进行中' }}</div>
          <div class="shadow-sub">人工执行 · 自动交易关闭 · 0.65 阈值仍在独立验证</div>
        </div>
        <div class="shadow-flags">
          <span class="flag" :class="data.ml_shadow.fast_path_enabled ? 'on' : 'off'">快速通道：{{ data.ml_shadow.fast_path_enabled ? '可用' : '关闭' }}</span>
          <span class="flag off">自动交易：关闭</span>
        </div>
      </div>

      <!-- 模块1 公共策略状态；账户资产与持仓仅在后台认证后查看 -->
      <div class="card">
        <div class="card-title">
          策略状态
          <DataBadge :source="data.overview ? '快照' : ''" :time="data.overview ? data.overview.snapshot_date : ''" :missing="!data.overview" />
        </div>
        <div v-if="data.overview" class="stat-grid">
          <div class="stat-card">
            <div class="stat-label">市场环境</div>
            <div class="stat-value">{{ marketRegimeLabel(data.overview.market_regime) }}</div>
            <div class="stat-sub">公开市场状态</div>
          </div>
          <div class="stat-card">
            <div class="stat-label">策略风险</div>
            <div class="stat-value">{{ data.overview.overall_risk || '—' }}</div>
            <div class="stat-sub">公开风险状态</div>
          </div>
          <div class="stat-card">
            <div class="stat-label">信号覆盖</div>
            <div class="stat-value">{{ data.overview.etf_total != null ? data.overview.etf_total : '—' }}</div>
            <div class="stat-sub">公开 ETF 数量</div>
          </div>
        </div>
        <div v-else class="module-missing empty">账户总览数据缺失</div>
      </div>

      <!-- 个人站点：仅展示仓位比例与浮盈，不展示绝对账户资产。 -->
      <div v-if="data.overview" class="card account-overview">
        <div class="card-title">账户总览 <span class="sub">个人站点只读</span></div>
        <div class="stat-grid account-grid">
          <div class="stat-card"><div class="stat-label">现金比例</div><div class="stat-value">{{ formatPercent(data.overview.cash_ratio) }}</div></div>
          <div class="stat-card"><div class="stat-label">科技仓位</div><div class="stat-value">{{ formatPercent(data.overview.tech_position) }}</div></div>
          <div class="stat-card"><div class="stat-label">黄金仓位</div><div class="stat-value">{{ formatPercent(data.overview.gold_position) }}</div></div>
          <div class="stat-card"><div class="stat-label">创新药仓位</div><div class="stat-value">{{ formatPercent(data.overview.innovation_position) }}</div></div>
          <div class="stat-card"><div class="stat-label">浮盈</div><div class="stat-value">{{ reveal.pnl ? formatAmount(data.overview.total_pnl) : maskAmount(data.overview.total_pnl) }} <button class="eye-btn" @click="toggleReveal('pnl')">{{ reveal.pnl ? '隐藏' : '显示' }}</button></div></div>
        </div>
      </div>

      <!-- 模块2 五 ETF 状态卡 -->
      <div class="grid-5">
        <div
          v-for="c in data.cards"
          :key="c.code"
          class="card state-card"
          :class="{ 'module-missing': !c.action }"
          :style="c.action ? { borderLeftColor: ACTION_COLORS[c.action] || 'var(--c-border)' } : undefined"
          @click="goDetail(c.code)"
        >
          <div class="state-card-head">
            <span class="state-name">{{ c.name }}</span>
            <span class="state-code">{{ c.code }}</span>
          </div>
          <RiskAlertBar v-if="c.risk_override || c.risk_flag === 'RED'" :risk-flag="c.risk_flag" :risk-override="c.risk_override" />
          <!-- 用户第一眼只看主建议、仓位、Gen-1 状态、风险。 -->
          <div class="stage-block">
            <span class="state-label">Gen-1 状态</span>
            <span class="stage-text">{{ gen1Status(c) }}</span>
            <span v-if="c.gen1 && c.gen1.status && c.gen1.status.message" class="wait-reason">{{ c.gen1.status.message }}</span>
          </div>
          <div class="state-row">
            <span class="state-label">建议</span>
            <span class="state-action" :style="{ color: ACTION_COLORS[c.gen1 && c.gen1.advisory ? c.gen1.advisory.action_code : c.action] || '#6b7280' }">
              {{ primaryAction(c) }}
            </span>
          </div>
          <div class="state-row">
            <span class="state-label">仓位</span>
            <span class="state-val">{{ primaryPosition(c) }}</span>
          </div>
          <div class="state-row">
            <span class="state-label">建议目标</span>
            <span class="state-val">{{ primaryTarget(c) }}</span>
          </div>
          <div class="state-row state-meta">
            <span>Fast Path：{{ fastPath(c) }}</span>
            <span>风险：{{ RISK_FLAG_LABELS[c.risk_flag] || '正常' }}</span>
          </div>
          <div class="state-row state-meta">
            <span>模型适用性：{{ applicabilityLabel(c) }}</span>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.hero {
  background: linear-gradient(135deg, #1e40af 0%, #2563eb 55%, #3b82f6 100%);
  border-radius: var(--radius-lg);
  padding: 18px 22px;
  margin-bottom: 16px;
  color: #fff;
  box-shadow: 0 8px 24px rgba(37, 99, 235, .22);
}
.headline {
  display: flex; gap: 14px; align-items: center; flex-wrap: wrap;
  font-size: 14px; color: #fff;
}
.headline-status { font-weight: 700; padding: 4px 13px; border-radius: 999px; }
.hero .headline-status.good,
.hero .headline-status.bad,
.hero .headline-status.neutral {
  background: rgba(255, 255, 255, .2);
  color: #fff;
}
.hero-muted { color: rgba(255, 255, 255, .85); }

.state-card {
  cursor: pointer;
  transition: var(--transition);
  border-left: 4px solid var(--c-border);
}
.state-card:active { transform: scale(.99); }
.state-card-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; }
.state-name { font-size: 14px; font-weight: 600; color: #111827; }
.state-code { font-size: 11px; color: #9ca3af; background: #f3f4f6; padding: 2px 7px; border-radius: 999px; }
.state-row { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; font-size: 12.5px; }
.state-label { color: #6b7280; }
.state-val { color: #111827; font-weight: 500; }
.state-action { font-weight: 700; font-size: 16px; }
.state-meta { color: #6b7280; font-size: 11px; border-top: 1px solid #f3f4f6; padding-top: 8px; margin-top: 2px; }
.stage-block { margin-bottom: 8px; }
.stage-text { display: block; margin-top: 3px; font-size: 12.5px; font-weight: 500; color: #111827; line-height: 1.5; }
.wait-reason { display: inline-block; margin-top: 4px; font-size: 11px; color: #b45309; background: #fffbeb; border: 1px solid #fde68a; border-radius: 6px; padding: 2px 8px; }
.auto-tag { margin-left: 6px; font-size: 10px; font-weight: 500; color: #059669; background: #ecfdf5; border: 1px solid #a7f3d0; border-radius: 4px; padding: 0 5px; vertical-align: 1px; }
.eye-btn { margin-left: 6px; padding: 0; border: none; background: none; cursor: pointer; color: #9ca3af; vertical-align: 1px; line-height: 0; transition: color .15s; }
.leverage-bar { background: #fff7ed; border-color: #fdba74; color: #9a3412; }

@media (hover: hover) {
  /* 不改 border-color，避免冲掉左侧决策彩条 */
  .state-card:hover { box-shadow: var(--shadow-lg); transform: translateY(-2px); }
  .eye-btn:hover { color: #374151; }
}
@media (max-width: 768px) {
  .hero { padding: 14px 16px; }
  .eye-btn { min-width: 40px; min-height: 40px; display: inline-flex; align-items: center; justify-content: center; }
}

.shadow-status {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 16px;
  align-items: center;
  margin-bottom: 16px;
  padding: 14px 18px;
  border: 1px dashed #94a3b8;
  border-radius: var(--radius-lg, 12px);
  background: linear-gradient(180deg, #f8fafc 0%, #f1f5f9 100%);
}
.shadow-status.on { border-color: #64748b; }
.shadow-kicker { font-size: 11px; color: #64748b; letter-spacing: .02em; }
.shadow-title { font-size: 14px; font-weight: 700; color: #0f172a; margin-top: 2px; }
.shadow-sub { font-size: 12px; color: #475569; margin-top: 2px; }
.shadow-flags { display: flex; flex-direction: column; gap: 4px; }
.flag {
  font-size: 11px; font-weight: 600; padding: 2px 8px; border-radius: 4px;
  background: #e2e8f0; color: #334155; white-space: nowrap;
}
.flag.off { background: #fee2e2; color: #991b1b; }
.flag.on { background: #dbeafe; color: #1e40af; }
@media (max-width: 768px) {
  .shadow-status { grid-template-columns: 1fr; }
}
</style>
