<script setup>
/**
 * 第一主区：市场环境 + 正式决策（web/src/rewrite/components/dashboard/MarketDecisionSection.vue）
 * 规范依据：SPEC §3.1 / §4.2 / §9
 *
 * ★ 视觉权重（owner 要求）：**正式决策 > Gen-1**。
 *   本区放在首屏第一主区，Gen-1 单独成第二主区，且字号/边界条更弱。
 *
 * ★ 三处职责分离（SPEC §3）：
 *   · 市场环境 → 后端枚举 + 已本地化文案（Safety Core 口径）
 *   · 正式决策 / 风险 → V3 Safety Core（= 最终权威）
 *   · 本区 ⛔ 不呈现 Gen-2（Selection / Shadow / Research），也不呈现交易明细
 *
 * ⛔ 组件不做：数字格式化、gap 重算、阈值判断、文案拼装（全部来自 adapter 的 VM）。
 */
import { ref, computed } from 'vue';
import SectionHeader from '../SectionHeader.vue';
import ActionBadge from '../domain/ActionBadge.vue';
import RiskBadge from '../domain/RiskBadge.vue';
import ToneBadge from '../domain/ToneBadge.vue';
import FieldValue from '../domain/FieldValue.vue';
import ProvenanceLine from '../domain/ProvenanceLine.vue';

const props = defineProps({
  market: { type: Object, required: true },
  decision: { type: Object, required: true },
  portfolio: { type: Object, required: true },
  boundaries: { type: Object, default: () => ({}) }
});

/** 金额遮罩：**默认隐藏**（owner 既定隐私默认），仅本页会话内可显隐。 */
const moneyVisible = ref(false);

/** 已确认有值的金额项（缺失项不参与遮罩切换，避免把「缺失」伪装成「已隐藏」） */
const moneyRows = computed(() => ([
  { label: '总资产', d: props.portfolio.money.totalAsset },
  { label: '持仓市值', d: props.portfolio.money.holdingsMv },
  { label: '现金', d: props.portfolio.money.cashBalance },
  { label: '累计浮盈', d: props.portfolio.money.totalPnl }
]));
const hasAnyMoney = computed(() => moneyRows.value.some((r) => !r.d.missing));

const dist = computed(() => ([
  { k: '加仓/建仓', v: props.decision.counts.add },
  { k: '持有', v: props.decision.counts.hold },
  { k: '减仓/清仓', v: props.decision.counts.reduce },
  { k: '等待', v: props.decision.counts.wait }
]));
</script>

<template>
  <div class="dash-primary">

    <!-- ============ 市场环境 ============ -->
    <section class="section">
      <SectionHeader eyebrow="市场环境" title="系统怎么看市场">
        <template #actions>
          <ToneBadge :text="market.regimeIsFallback ? '展示兜底' : '后端枚举'" tone="outline" small />
        </template>
      </SectionHeader>

      <div class="hero-top mb-3">
        <span class="hero-action" :class="'text-tone-' + market.regimeTone">{{ market.regimeLabel }}</span>
        <ToneBadge v-if="market.statusText.text && !market.statusText.missing" :text="'后端描述：' + market.statusText.text" tone="outline" small />
      </div>

      <div class="kv-grid">
        <div class="kv">
          <span class="kv-k">系统风险</span>
          <span class="kv-v"><RiskBadge :text="market.riskLabel" :tone="market.riskTone" /></span>
        </div>
        <div class="kv">
          <span class="kv-k">需防守标的</span>
          <span class="kv-v">{{ market.mostDefendLabel }}</span>
        </div>
        <div class="kv">
          <span class="kv-k">值得关注</span>
          <span class="kv-v"><FieldValue :d="market.mostWorthText" /></span>
        </div>
        <div class="kv">
          <span class="kv-k">组合 ETF 仓位</span>
          <span class="kv-v"><FieldValue :d="portfolio.etfTotal" strong /></span>
        </div>
        <div class="kv">
          <span class="kv-k">现金比例</span>
          <span class="kv-v"><FieldValue :d="portfolio.cashRatio" /></span>
        </div>
        <div class="kv">
          <span class="kv-k">科技 / 黄金 / 创新药</span>
          <span class="kv-v">
            <FieldValue :d="portfolio.techPosition" /> ·
            <FieldValue :d="portfolio.goldPosition" /> ·
            <FieldValue :d="portfolio.innovationPosition" />
          </span>
        </div>
      </div>

      <hr class="divider" />

      <div class="row-between mb-2">
        <span class="kv-k">组合金额（默认隐藏）</span>
        <button
          v-if="hasAnyMoney"
          type="button"
          class="badge outline sm"
          :aria-pressed="String(moneyVisible)"
          @click="moneyVisible = !moneyVisible"
        >{{ moneyVisible ? '隐藏' : '显示' }}</button>
      </div>
      <div class="kv-grid">
        <div v-for="r in moneyRows" :key="r.label" class="kv">
          <span class="kv-k">{{ r.label }}</span>
          <span class="kv-v">
            <template v-if="r.d.missing"><FieldValue :d="r.d" /></template>
            <template v-else>{{ moneyVisible ? r.d.text : '••••' }}</template>
          </span>
        </div>
      </div>
      <p class="state-sub mt-2">资产来源：<FieldValue :d="portfolio.assetSource" /> · 金额单位：元</p>

      <div class="mt-3">
        <ProvenanceLine :source="market.regimeSourceText" :channel-note="market.regimeSourceNote" />
      </div>
    </section>

    <!-- ============ 正式决策 ============ -->
    <section class="section hero-decision">
      <SectionHeader
        eyebrow="正式决策 · V3 Safety Core"
        title="当前系统建议与风险"
        :subtitle="'最终动作与目标仓位由 V3 Safety Core 决定；本区即为该权威口径。'"
      >
        <template #actions>
          <RiskBadge :text="'风险 · ' + decision.riskLabel" :tone="decision.riskTone" />
        </template>
      </SectionHeader>

      <!-- 动作分布（⛔ 计数，不是仓位数字） -->
      <div class="dist">
        <ToneBadge v-for="d in dist" :key="d.k" :text="d.k + ' ' + d.v" tone="outline" small />
        <ToneBadge v-if="decision.counts.other" :text="'其它 ' + decision.counts.other" tone="outline" small />
      </div>

      <!-- 需要动作的标的 -->
      <div class="mt-3">
        <div class="section-title mb-2">需要动作的标的</div>

        <div v-if="decision.attention.length === 0" class="banner">
          <div class="banner-text">当前无需动作：全部标的均为「等待 / 持有」，且无仓位缺口与红色风险。</div>
        </div>

        <div v-else class="attn">
          <article
            v-for="c in decision.attention"
            :key="c.display.code"
            class="attn-item"
            :class="'tone-' + c.display.actionTone"
          >
            <div class="grow">
              <div class="row gap-2">
                <span class="attn-name">{{ c.display.name }}</span>
                <span class="attn-code">{{ c.display.code }}</span>
                <ActionBadge :text="c.display.action" :tone="c.display.actionTone" small />
              </div>
              <div class="attn-nums mt-1">
                <span>当前 <b><FieldValue :d="c.display.current" /></b></span>
                <span>目标 <b><FieldValue :d="c.display.target" /></b></span>
                <span>目标带 {{ c.display.band }}</span>
                <span>缺口 <b><FieldValue :d="c.display.gap" /></b></span>
                <span>超配 {{ c.display.overAlloc }}</span>
                <span>机会 {{ c.display.opportunity }}</span>
              </div>
              <p class="state-sub mt-1">{{ c.display.stageText }}</p>
            </div>

            <details class="fold grow">
              <summary>
                为什么（决策链 {{ c.display.chain.text }}）
                <ToneBadge
                  :text="c.display.gen1.available ? ('Gen-1 ' + c.display.gen1.statusText) : 'Gen-1 数据未提供'"
                  :tone="c.display.gen1.available ? c.display.gen1.statusTone : 'muted'"
                  small
                />
              </summary>
              <div class="chain">
                <div v-for="(s, i) in c.display.chain.collapsed" :key="i" class="chain-step">
                  <span class="k">{{ s.step }}</span> · {{ s.condition }} ⇒ <b>{{ s.result }}</b>
                </div>
                <div v-if="c.display.chain.more" class="chain-step text-3">
                  另有 {{ c.display.chain.more }} 步未展开（完整链路见「标的」页）
                </div>
                <div v-if="c.display.chain.available && c.display.chain.steps.length === 0" class="chain-step text-3">
                  决策链为空（后端下发 0 步）
                </div>
              </div>
              <div class="mt-2">
                <template v-if="c.display.gen1.available">
                  <div class="chain-step">
                    Gen-1 档位 <b>{{ c.display.gen1.authorityText }}</b> ·
                    信号阶段 <b>{{ c.display.gen1.signalStageText }}</b> ·
                    概率 {{ c.display.gen1.probabilityText }} ·
                    阈值 {{ c.display.gen1.thresholdText }}
                  </div>
                  <div class="chain-step">
                    阶段：信号 {{ c.display.gen1.stageSignalText }} / 基线 {{ c.display.gen1.stageBaselineText }} / 生效 {{ c.display.gen1.stageEffectiveText }}
                    · 安全门 {{ c.display.gen1.safetyPermissionText }}
                  </div>
                  <div v-show="c.display.gen1.safetyReasonText" class="chain-step text-3">{{ c.display.gen1.safetyReasonText }}</div>
                  <div class="chain-step text-3">{{ c.display.gen1.applicabilityMessageText }}</div>
                </template>
                <div v-else class="chain-step text-3">
                  标的级 Gen-1：数据未提供（{{ c.display.gen1.reasonText }}）
                </div>
              </div>
            </details>
          </article>
        </div>
      </div>

      <hr class="divider" />

      <div class="kv-grid">
        <div class="kv">
          <span class="kv-k">组合目标合计</span>
          <span class="kv-v"><FieldValue :d="{ text: decision.targetTotal.text, missing: true, reasonText: decision.targetTotal.reasonText }" /></span>
          <span class="kv-k mt-1">{{ decision.targetTotal.note }}</span>
        </div>
        <div class="kv">
          <span class="kv-k">仓位缺口</span>
          <span class="kv-v">{{ decision.gap.text }}</span>
        </div>
        <div class="kv">
          <span class="kv-k">绑定约束</span>
          <span class="kv-v">{{ decision.bindingConstraintText }}</span>
        </div>
        <div class="kv">
          <span class="kv-k">Gen-1 建议</span>
          <span class="kv-v">
            <ToneBadge
              :text="decision.gen1Available ? '见下方 Gen-1 区（仅时机建议）' : '数据未提供'"
              :tone="decision.gen1Available ? 'outline' : 'muted'"
              small
            />
          </span>
        </div>
      </div>

      <p v-if="boundaries.gen2Note" class="state-sub mt-3">
        ⛔ 本页不呈现 Gen-2 数据。{{ boundaries.gen2Note }}
      </p>
    </section>
  </div>
</template>
