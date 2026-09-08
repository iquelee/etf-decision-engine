<script setup>
import { ref, computed, onMounted, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api } from '../api/request.js';
import {
  SECTORS, W_STATE_LABELS, D_STATE_LABELS, H_STATE_LABELS, V_STATE_LABELS,
  F_STATE_LABELS, C_STATE_LABELS, ACTION_COLORS, actionLabel, RISK_FLAG_LABELS,
  overAllocLabel, ML_SIGNAL_STATUSES, ML_SIGNAL_STATUS_LABELS
} from '../utils/constants.js';
import { formatPercent } from '../utils/format.js';
import ScoreBar from '../components/common/ScoreBar.vue';
import DecisionChain from '../components/common/DecisionChain.vue';
import DataBadge from '../components/common/DataBadge.vue';
import RiskAlertBar from '../components/common/RiskAlertBar.vue';

const route = useRoute();
const router = useRouter();
const currentCode = computed(() => route.params.code);

const loading = ref(true);
const error = ref('');
const detail = ref(null);
const etfs = ref([]);

const snapshot = computed(() => (detail.value ? detail.value.snapshot : null));
const gen1 = computed(() => (detail.value && detail.value.gen1) || null);
const mlShadow = computed(() => (detail.value && detail.value.ml_shadow) || null);
const decision = computed(() => (detail.value ? detail.value.decision : null));
const position = computed(() => (detail.value ? detail.value.position : null));
const riskEvents = computed(() => (detail.value ? detail.value.risk_events : []));

const stageLabel = computed(() => {
  const s = snapshot.value;
  if (!s) return '—';
  return [stateLabel('W', s.w_state), stateLabel('D', s.d_state), stateLabel('H', s.h_state), stateLabel('V', s.v_state)].join(' · ');
});
const effectiveStageLabel = computed(() => {
  if (decision.value && decision.value.effective_stage) return decision.value.effective_stage;
  return stageLabel.value;
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
  try {
    detail.value = await api.etfDetail(currentCode.value);
  } catch (e) {
    error.value = e.message || String(e);
  } finally {
    loading.value = false;
  }
}

function switchEtf(c) {
  if (c !== currentCode.value) router.push(`/etf/${c}`);
}
function sectorLabel(s) { return SECTORS[s] || s; }
function stateLabel(kind, key) {
  const map = { W: W_STATE_LABELS, D: D_STATE_LABELS, H: H_STATE_LABELS, V: V_STATE_LABELS, F: F_STATE_LABELS, C: C_STATE_LABELS };
  return (map[kind] && map[kind][key]) || key || '—';
}

const GRADE_LABELS = { A: '强进攻', B: '积极', C: '持有', D: '警戒', E: '防守', F: '清仓' };
function gradeTone(g) {
  const map = { A: 'primary', B: 'primary', C: 'muted', D: 'warn', E: 'bad', F: 'bad' };
  return map[g] || 'muted';
}
const ELIGIBILITY_ITEMS = [
  { key: 'trend', label: '趋势' },
  { key: 'structure', label: '横盘结构' },
  { key: 'volume', label: '成交量' },
  { key: 'fund', label: '基本面' },
  { key: 'chase', label: '追涨' },
  { key: 'limit', label: '仓位上限' },
  { key: 'sector', label: '赛道' },
  { key: 'risk', label: '风险熔断' }
];
function eligIcon(v) {
  if (v === 'ok') return '🟢';
  if (v === 'pause') return '🟡';
  if (v == null || v === '') return '—';
  return '🔴';
}
const hasEligDetails = computed(() => {
  const ae = decision.value && decision.value.add_eligibility;
  return !!(ae && ELIGIBILITY_ITEMS.some((it) => ae[it.key] != null));
});


function fmtProb(v) {
  if (v == null || Number.isNaN(Number(v))) return '—';
  const n = Number(v);
  return n <= 1.5 ? `${(n * 100).toFixed(1)}%` : `${n.toFixed(1)}%`;
}
function fmtPct2(v) {
  if (v == null || Number.isNaN(Number(v))) return '—';
  return `${Number(v).toFixed(1)}%`;
}
function shadowStatusLabel(ml) {
  if (!ml) return '—';
  return ML_SIGNAL_STATUS_LABELS[ml.signal_status] || ML_SIGNAL_STATUS_LABELS[ML_SIGNAL_STATUSES.NO_OPPORTUNITY];
}
function permissionLabel(p) {
  if (!p) return '暂无信号';
  const u = String(p).toUpperCase();
  if (u === 'PERMIT' || u === 'ALLOW') return '允许';
  if (u === 'BLOCK' || u === 'BLOCKED') return '禁止';
  return p;
}
function shadowSignalVal(ml, formatted) {
  if (!ml || !ml.has_signal_row) return '暂无信号';
  return formatted == null || formatted === '' ? '—' : formatted;
}
function shadowProbabilityVal(ml, formatted) {
  if (!ml) return '—';
  if (ml.signal_status === ML_SIGNAL_STATUSES.DEGRADED) return ml.has_signal_row ? '已过期' : '暂无信号';
  if ([ML_SIGNAL_STATUSES.OBSERVED, ML_SIGNAL_STATUSES.CANDIDATE].indexOf(ml.signal_status) < 0) return '—';
  return shadowSignalVal(ml, formatted);
}
function privateValue(v) { return v == null ? '后台查看' : formatPercent(v); }
function shadowFastPathLabel(ml) {
  if (!ml) return '—';
  const on = ml.fast_path_enabled === true;
  if (on) return ml.would_trigger_fast_path ? '本可触发' : '开 · 未触发';
  if (ml.would_trigger_fast_path) return '本可触发（通道关）';
  return '关';
}
function shadowDeltaLabel(ml) {
  if (!ml || !ml.has_signal_row || ml.delta_target_pct == null) return '暂无信号';
  const sign = ml.delta_target_pct > 0 ? '+' : '';
  return sign + fmtPct2(ml.delta_target_pct);
}
function eligibilityOverallLabel(v) {
  if (!v) return '—';
  const u = String(v).toLowerCase();
  if (u === 'allow') return '通过';
  if (u === 'forbid') return '禁止';
  if (u === 'pause') return '暂停';
  return v;
}
function gen1Pct(v) { return v == null || Number.isNaN(Number(v)) ? '—' : `${Number(v).toFixed(1)}%`; }
function gen1Delta(v) {
  if (v == null || Number.isNaN(Number(v))) return '—';
  return `${Number(v) > 0 ? '+' : ''}${Number(v).toFixed(1)}pct`;
}
function domainTone(domainStatus) {
  if (domainStatus === 'IN_DOMAIN') return 'applicability-good';
  if (domainStatus === 'PARTIAL_COVERAGE') return 'applicability-warn';
  return 'applicability-bad';
}
function coverageLabel(applicability) {
  if (!applicability || applicability.observed_folds == null || applicability.total_folds == null) return '—';
  return `${applicability.observed_folds}/${applicability.total_folds} 个校准子模型`;
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
        <span v-if="e.action" class="tab-action" :style="{ color: ACTION_COLORS[e.action] || '#6b7280' }">{{ actionLabel(e.action, e.action_label) }}</span>
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
          <DataBadge :source="'决策'" :time="decision ? decision.decision_date : ''" :missing="!decision" />
        </div>
        <div class="mt-8 flex gap-12">
          <span class="text-2">近5日涨幅：<span :class="change5dClass">{{ snapshot && snapshot.change_5d != null ? formatPercent(snapshot.change_5d, 2, true) : '—' }}</span></span>
          <span class="text-2">当前仓位：{{ privateValue(position && position.current_position) }}</span>
        </div>
        <div v-if="decision" class="mt-8 text-2">
          风险：{{ RISK_FLAG_LABELS[decision.risk_flag] || decision.risk_flag }}
          ｜ 溢价：{{ decision.premium_flag || '正常' }}
          ｜ 拥挤度：{{ stateLabel('C', decision.c_state) }}<span class="etf-code"> {{ decision.c_state }}</span>
          ｜ 基本面：{{ stateLabel('F', decision.f_state) }}<span class="etf-code"> {{ decision.f_state }}</span>
        </div>
      </div>

      <!-- 第一屏唯一主口径：Gen-1 给结论，Safety Core 只在下方负责约束与审计。 -->
      <div v-if="gen1" class="card primary-advisory" :class="'tone-' + (gen1.status && gen1.status.tone ? gen1.status.tone : 'muted')">
        <div class="advisory-head">
          <div>
            <div class="advisory-kicker">Gen-1 趋势启动增强</div>
            <div class="advisory-action">{{ gen1.advisory.action_label }}</div>
            <div class="advisory-message">{{ gen1.advisory.message }}</div>
          </div>
          <span class="badge primary">{{ gen1.status.label }}</span>
        </div>
        <div class="advisory-grid">
          <div><span>当前仓位</span><strong>{{ gen1Pct(gen1.advisory.current_pct) }}</strong></div>
          <div><span>建议目标</span><strong>{{ gen1.advisory.target_label }}</strong></div>
          <div><span>本次调整</span><strong>{{ gen1Delta(gen1.advisory.delta_pct) }}</strong></div>
          <div><span>Fast Path</span><strong>{{ gen1.signal.fast_path }}</strong></div>
          <div v-if="gen1.signal.show_probability"><span>HVT-A 概率</span><strong>{{ fmtProb(gen1.signal.probability) }}</strong></div>
          <div><span>风险状态</span><strong>{{ RISK_FLAG_LABELS[gen1.risk.risk_flag] || '正常' }}</strong></div>
        </div>
        <div class="advisory-reasons">
          <span>规则许可：{{ gen1.risk.permission_label }}</span>
          <span v-if="gen1.risk.binding_constraint">主要限制：{{ gen1.risk.binding_label }}</span>
          <span v-if="gen1.risk.permission === 'BLOCK' && gen1.risk.permission_reason">阻止原因：{{ gen1.risk.permission_reason }}</span>
          <span v-if="gen1.applicability" :class="domainTone(gen1.applicability.domain_status)">模型适用性：{{ gen1.applicability.label }}</span>
          <span v-if="gen1.applicability">{{ gen1.applicability.message }}</span>
        </div>
      </div>

      <details class="card technical-details">
        <summary class="card-title">
          技术详情 / Safety Core 对照
          <span v-if="decision && decision.opportunity_grade" class="sub">
            <span class="badge" :class="gradeTone(decision.opportunity_grade)">
              {{ GRADE_LABELS[decision.opportunity_grade] || '—' }}<span class="etf-code"> {{ decision.opportunity_grade }}</span>
            </span>
          </span>
        </summary>
        <div class="technical-body">
        <div class="pos-dash">
          <div class="pos-item">
            <span class="pos-label">当前仓位</span>
            <span class="pos-value">{{ privateValue(position.current_position) }}</span>
          </div>
          <div class="pos-item">
            <span class="pos-label">目标区间</span>
            <span class="pos-value">[{{ decision && decision.target_min != null ? decision.target_min : '—' }} ~ {{ decision && decision.target_max != null ? decision.target_max : '—' }}]%</span>
          </div>
          <div class="pos-item">
            <span class="pos-label">建议目标</span>
            <span class="pos-value">{{ decision && decision.final_target != null ? decision.final_target + '%' : '—' }}</span>
          </div>
          <div class="pos-item">
            <span class="pos-label" title="建议执行仓 − 当前仓">建议缺口</span>
            <span class="pos-value">{{ decision && decision.position_gap != null ? (decision.position_gap > 0 ? '+' : '') + decision.position_gap + '%' : '后台查看' }}</span>
          </div>
          <div class="pos-item">
            <span class="pos-label">建议核心 / 交易</span>
            <span class="pos-value">{{ decision && decision.core_position != null ? decision.core_position : '后台查看' }}<template v-if="decision && decision.core_position != null">% / {{ decision && decision.trade_position != null ? decision.trade_position : '后台查看' }}%</template></span>
          </div>
          <div class="pos-item">
            <span class="pos-label">超配状态</span>
            <span class="pos-value">{{ decision && decision.over_alloc_status ? overAllocLabel(decision.over_alloc_status) : '后台查看' }}</span>
          </div>
        </div>

        <div v-if="decision && decision.cooldown_days > 0" class="warning-bar">
          加仓冷静期：还需 {{ decision.cooldown_days }} 个交易日方可再次加仓
        </div>

        <div v-if="hasEligDetails" class="elig-list mt-8">
          <span v-for="it in ELIGIBILITY_ITEMS" :key="it.key" class="elig-item">
            {{ eligIcon(decision.add_eligibility[it.key]) }} {{ it.label }}
          </span>
        </div>
        <div v-else-if="decision && decision.add_eligibility" class="text-2 mt-8">
          加仓资格：{{ eligibilityOverallLabel(decision.add_eligibility.overall) }}{{ decision.add_eligibility.reason ? ' · ' + decision.add_eligibility.reason : '' }}
        </div>
        </div>
      </details>


      <!-- 模型与基线追溯默认折叠，避免反事实/Schema 被误读为主建议。 -->
      <details v-if="mlShadow && mlShadow.enabled" class="card shadow-card technical-details">
        <summary class="card-title">
          模型审计 / 基线对照
          <span class="shadow-badge">{{ mlShadow.effective ? '主建议' : '观察' }}</span>
        </summary>
        <div class="technical-body">
        <div class="shadow-model">{{ mlShadow.model_id || '—' }}</div>
        <div class="shadow-flags">
          <span class="flag" :class="mlShadow.enabled ? 'on' : 'off'">观察：{{ mlShadow.enabled ? '开' : '关' }}</span>
          <span class="flag" :class="mlShadow.fast_path_enabled ? 'on' : 'off'">快速通道：{{ mlShadow.fast_path_enabled ? 'ACTIVE' : '关' }}</span>
          <span class="flag" :class="mlShadow.effective ? 'on' : 'off'">主建议：{{ mlShadow.effective ? '是' : '否' }}</span>
          <span class="flag off">自动执行：否</span>
          <span class="flag muted">信号：{{ shadowStatusLabel(mlShadow) }}</span>
        </div>
        <div v-if="!mlShadow.has_signal_row" class="shadow-empty">暂无 Gen-1 信号行（集合未写入或当日无样本）· V3.6.1 基线与人工建议闸门仍如下</div>
        <div class="shadow-grid">
          <div class="sg"><span class="sk">Gen-1 有效阶段</span><span class="sv">{{ mlShadow.effective_stage || mlShadow.stage || '—' }}</span></div>
          <div class="sg"><span class="sk">V3.6.1 基线阶段</span><span class="sv">{{ mlShadow.baseline_stage || '—' }}</span></div>
          <div class="sg"><span class="sk">P(S2→S4)</span><span class="sv">{{ shadowProbabilityVal(mlShadow, fmtProb(mlShadow.probability)) }}</span></div>
          <div class="sg"><span class="sk">校准概率</span><span class="sv">{{ shadowProbabilityVal(mlShadow, fmtProb(mlShadow.calibrated_probability)) }}</span></div>
          <div class="sg"><span class="sk">快速通道</span><span class="sv">{{ shadowFastPathLabel(mlShadow) }}</span></div>
          <div class="sg"><span class="sk">规则许可</span><span class="sv">{{ mlShadow.has_signal_row ? permissionLabel(mlShadow.permission) : '暂无信号' }}</span></div>
          <div v-if="mlShadow.permission === 'BLOCK'" class="sg"><span class="sk">阻止原因</span><span class="sv small-value">{{ mlShadow.rule_permission_reason || '等待 Safety Core 复核' }}</span></div>
          <div v-if="mlShadow.rule_permission_source" class="sg"><span class="sk">许可来源</span><span class="sv small-value">{{ mlShadow.rule_permission_source === 'SAFETY_CORE' ? 'Safety Core 复核' : 'EOD 阶段预检' }}</span></div>
          <div class="sg"><span class="sk">信号状态</span><span class="sv">{{ shadowStatusLabel(mlShadow) }}</span></div>
          <div class="sg"><span class="sk">训练类别</span><span class="sv">{{ mlShadow.category || '—' }}</span></div>
          <div class="sg"><span class="sk">模型适用性</span><span class="sv" :class="domainTone(mlShadow.domain_status)">{{ mlShadow.domain_status_label || '待核验' }}</span></div>
          <div class="sg"><span class="sk">校准类别覆盖</span><span class="sv">{{ coverageLabel(mlShadow.category_coverage) }}</span></div>
          <div class="sg"><span class="sk">适用性说明</span><span class="sv small-value">{{ mlShadow.domain_status_message || '—' }}</span></div>
          <div class="sg"><span class="sk">趋势排序能力</span><span class="sv">{{ mlShadow.model_capability?.ranking === 'PASS' ? '已验证' : '待验证' }}</span></div>
          <div class="sg"><span class="sk">0.65 阈值</span><span class="sv">{{ mlShadow.model_capability?.threshold === 'UNPROVEN' ? '尚待验证' : '—' }}</span></div>
          <div class="sg"><span class="sk">实时经济验证</span><span class="sv">{{ mlShadow.model_capability?.economic_live === 'PENDING' ? '进行中' : '—' }}</span></div>
          <div class="sg"><span class="sk">信号时市场环境</span><span class="sv">{{ mlShadow.market_regime || '待记录' }}</span></div>
          <div class="sg"><span class="sk">Gen-1 主建议目标</span><span class="sv">{{ mlShadow.advisory_effective ? fmtPct2(mlShadow.advisory_target_pct) : (mlShadow.signal_status === 'DEGRADED' ? '无候选' : '—') }}</span></div>
          <div class="sg"><span class="sk">V3.6.1 基线目标</span><span class="sv">{{ fmtPct2(mlShadow.baseline_target_pct != null ? mlShadow.baseline_target_pct : mlShadow.production_target_pct) }}</span></div>
          <div class="sg"><span class="sk">ML 反事实目标</span><span class="sv cf">{{ shadowSignalVal(mlShadow, fmtPct2(mlShadow.counterfactual_target_pct)) }}</span></div>
          <div class="sg"><span class="sk">差额</span><span class="sv">{{ shadowDeltaLabel(mlShadow) }}</span></div>
          <div class="sg"><span class="sk">信号日</span><span class="sv">{{ mlShadow.signal_date || '—' }}</span></div>
          <div class="sg"><span class="sk">行情交易日</span><span class="sv">{{ mlShadow.source_trade_date || '—' }}</span></div>
          <div class="sg"><span class="sk">特征 Schema</span><span class="sv mono">{{ mlShadow.feature_schema_hash ? mlShadow.feature_schema_hash.slice(0, 12) : '—' }}</span></div>
          <div class="sg"><span class="sk">引擎版本</span><span class="sv">{{ mlShadow.engine_version || 'v3.6.1' }}</span></div>
          <div class="sg"><span class="sk">配置包</span><span class="sv">{{ mlShadow.bundle_id || '—' }}</span></div>
        </div>
        <div class="shadow-note">自动交易关闭 · V3.6.1 风险/组合约束仍生效 · 最终由人工判断</div>
        </div>
      </details>

      <RiskAlertBar
        v-if="decision"
        :risk-flag="decision.risk_flag"
        :risk-override="decision.risk_override"
        :reason="riskEvents.length ? riskEvents[0].reason : ''"
      />

      <div class="grid-2">
        <div class="card" :class="{ 'module-missing': !decision }">
          <div class="card-title">评分卡 <span class="sub">五维（不显示总分）</span></div>
          <ScoreBar v-if="decision" :scores="decision.scores" :opportunity-score="decision.opportunity_score" :opportunity-grade="decision.opportunity_grade" />
          <div v-else class="empty">评分数据缺失</div>
        </div>
        <div>
          <div class="card" :class="{ 'module-missing': !decision }">
            <div class="card-title">决策链「为什么」</div>
            <DecisionChain v-if="decision" :chain="decision.explain_chain" :action="gen1 ? gen1.advisory.action_label : actionLabel(decision.final_action, decision.action_label)" :gen1="gen1" />
            <div v-else class="empty">决策链数据缺失</div>
          </div>
          <div v-if="decision && decision.next_add_condition" class="card">
            <div class="card-title">下一加仓条件</div>
            <div class="text-2">{{ decision.next_add_condition }}</div>
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
.tab-code { font-size: 11px; color: #9ca3af; font-weight: 400; }
.tab-action { font-weight: 700; font-size: 12px; }
.detail-name { margin: 0; font-size: 18px; color: #111827; }
.detail-code { font-size: 13px; color: #9ca3af; font-weight: 400; }
.primary-advisory { border-left: 4px solid #2563eb; background: linear-gradient(135deg, #f8fbff, #fff); }
.primary-advisory.tone-good { border-left-color: #059669; }
.primary-advisory.tone-warn { border-left-color: #d97706; }
.primary-advisory.tone-bad { border-left-color: #dc2626; }
.advisory-head { display: flex; justify-content: space-between; gap: 16px; align-items: flex-start; }
.advisory-kicker { font-size: 12px; font-weight: 600; color: #2563eb; }
.advisory-action { margin-top: 4px; font-size: 22px; font-weight: 750; color: #111827; }
.advisory-message { margin-top: 5px; font-size: 13px; color: #475569; }
.advisory-grid { display: grid; grid-template-columns: repeat(6, 1fr); gap: 12px; margin-top: 18px; }
.advisory-grid > div { display: flex; flex-direction: column; gap: 4px; }
.advisory-grid span { font-size: 11px; color: #64748b; }
.advisory-grid strong { font-size: 15px; color: #111827; }
.advisory-reasons { display: flex; flex-wrap: wrap; gap: 8px 16px; margin-top: 14px; padding-top: 10px; border-top: 1px solid #dbeafe; font-size: 12px; color: #475569; }
.applicability-good { color: #047857; font-weight: 650; }
.applicability-warn { color: #b45309; font-weight: 650; }
.applicability-bad { color: #b91c1c; font-weight: 700; }
.technical-details > summary { cursor: pointer; list-style: none; }
.technical-details > summary::-webkit-details-marker { display: none; }
.technical-details > summary::after { content: '展开'; margin-left: auto; font-size: 12px; font-weight: 400; color: #64748b; }
.technical-details[open] > summary::after { content: '收起'; }
.technical-body { margin-top: 14px; }
.pos-dash { display: grid; grid-template-columns: repeat(6, 1fr); gap: 12px; }
.pos-item { display: flex; flex-direction: column; gap: 4px; }
.pos-label { font-size: 12px; color: #6b7280; }
.pos-value { font-size: 16px; font-weight: 700; color: #111827; }
.elig-list { display: flex; flex-wrap: wrap; gap: 8px; }
.elig-item { font-size: 12px; color: #374151; background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 6px; padding: 3px 8px; }
@media (max-width: 900px) {
  .pos-dash { grid-template-columns: repeat(3, 1fr); }
  .advisory-grid { grid-template-columns: repeat(3, 1fr); }
}
@media (max-width: 768px) {
  .pos-dash { grid-template-columns: repeat(2, 1fr); }
  .advisory-grid { grid-template-columns: repeat(2, 1fr); }
}

@media (hover: hover) {
  .etf-tab:hover { border-color: var(--c-primary, #2563eb); box-shadow: var(--shadow-sm); }
}

.shadow-card { border: 1px dashed #64748b; background: #f8fafc; }
.shadow-badge {
  margin-left: 8px; font-size: 11px; font-weight: 700; color: #1e40af;
  background: #dbeafe; border-radius: 4px; padding: 2px 6px; vertical-align: 1px;
}
.shadow-model { font-size: 12px; color: #64748b; margin: -4px 0 10px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
.shadow-grid {
  display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px 14px;
}
.sg { display: flex; flex-direction: column; gap: 2px; }
.sk { font-size: 11px; color: #64748b; }
.sv { font-size: 14px; font-weight: 600; color: #0f172a; }
.sv.mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 11px; letter-spacing: .02em; }
.sv.cf { color: #475569; } /* counterfactual 弱化，避免被当成正式建议 */
.sv.small-value { font-size: 12px; line-height: 1.4; font-weight: 500; }

.shadow-flags { display: flex; flex-wrap: wrap; gap: 8px; margin: 0 0 10px; }
.shadow-flags .flag {
  font-size: 11px; font-weight: 700; padding: 2px 8px; border-radius: 4px;
  background: #f1f5f9; color: #64748b; border: 1px solid #e2e8f0;
}
.shadow-flags .flag.on { background: #ecfdf5; color: #047857; border-color: #a7f3d0; }
.shadow-flags .flag.off { background: #f8fafc; color: #64748b; }
.shadow-flags .flag.muted { background: #eff6ff; color: #1e40af; border-color: #bfdbfe; }
.shadow-empty {
  margin: 0 0 10px; padding: 8px 10px; font-size: 12px; color: #92400e;
  background: #fffbeb; border: 1px solid #fde68a; border-radius: 6px;
}
.shadow-note {
  margin-top: 12px; font-size: 12px; color: #475569;
  padding: 8px 10px; background: #fff; border-radius: 6px; border: 1px solid #e2e8f0;
}
@media (max-width: 768px) {
  .shadow-grid { grid-template-columns: repeat(2, 1fr); }
}
</style>
