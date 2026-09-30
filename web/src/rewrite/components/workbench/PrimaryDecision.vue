<script setup>
/**
 * 正式决策区（web/src/rewrite/components/workbench/PrimaryDecision.vue）
 * 规范依据：SPEC §3.1 ＋ M4-P0 §B 硬约束 1/2/3
 *
 * ★★ 本区是**全页最高权威层**：`V3 Safety Core → Formal Decision / Authority`。
 *   · 归属标注必须可见（不是装饰）；
 *   · Gen-1 的任何数值 ⛔ 不得在本区出现或与之并列（视觉层级 Safety Core > Gen-1 Legacy Advisory）。
 *
 * ★ 三条禁止（用户 M4-P1 指令）：
 *   ① ⛔ 不重算 `position_gap` / `final target`（只展示 `decision` 块服务端值）；
 *   ② ⛔ 不跨 endpoint 偷补；
 *   ③ ⛔ 不把 legacy 值标成 canonical。
 */
import SectionHeader from '../SectionHeader.vue';
import FieldValue from '../domain/FieldValue.vue';
import ToneBadge from '../domain/ToneBadge.vue';
import ActionBadge from '../domain/ActionBadge.vue';

defineProps({
  /** adapter 的 `vm.decision` */
  decision: { type: Object, required: true },
  /** adapter 的 `vm.risk`（风险在 VM 顶层，与 decision 分开建轴） */
  risk: { type: Object, required: true },
  /** adapter 的 `vm.boundaries`（文案来源，⛔ 组件不硬编码） */
  boundaries: { type: Object, required: true }
});
</script>

<template>
  <section class="section primary-decision">
    <SectionHeader
      eyebrow="正式决策"
      title="当前建议与目标"
      :subtitle="boundaries.safetyCoreIdentity"
    >
      <template #actions>
        <ToneBadge text="最终权威" tone="accent" small />
      </template>
    </SectionHeader>

    <!-- 决策不可用：整块显式缺失（⛔ 不显示 0 / —） -->
    <div v-if="!decision.available" class="banner mb-3">
      <div class="banner-text">
        正式决策<b>数据未提供</b>（decision 块缺失）。本页不会用历史值或其它接口推算本次决策。
      </div>
    </div>

    <template v-else>
      <!-- ★ 主行：动作 + 目标 + 缺口（三个最重要的数字） -->
      <div class="pd-hero">
        <div class="pd-hero-main">
          <div class="pd-hero-label">动作</div>
          <div class="pd-hero-value">
            <ActionBadge :code="decision.action" :text="decision.actionText" :tone="decision.actionTone" large />
          </div>
          <div class="pd-hero-note">{{ decision.dateText.text }} 决策</div>
        </div>

        <div class="pd-hero-cell">
          <div class="pd-hero-label">最终目标</div>
          <div class="pd-hero-num" :class="{ 'is-missing': decision.finalTargetText.missing }">
            {{ decision.finalTargetText.text }}
          </div>
          <div class="pd-hero-note">
            目标带 {{ decision.targetBand.rangeText }}
          </div>
        </div>

        <div class="pd-hero-cell">
          <div class="pd-hero-label">仓位缺口</div>
          <div class="pd-hero-num" :class="{ 'is-missing': decision.gapText.missing }">
            {{ decision.gapText.text }}
          </div>
          <div class="pd-hero-note">{{ decision.gapNote }}</div>
        </div>

        <div class="pd-hero-cell">
          <div class="pd-hero-label">风险</div>
          <div class="pd-hero-value">
            <ToneBadge :text="risk.flagText" :tone="risk.tone" dot />
          </div>
          <div class="pd-hero-note">
            溢价 {{ risk.premiumText }} · 超配 {{ decision.overAllocText }}
          </div>
        </div>
      </div>

      <!-- 明细：目标带 / 仓位建议 / 约束 -->
      <div class="kv-grid mt-3">
        <div class="kv">
          <span class="kv-k">目标带（min / std / max）</span>
          <span class="kv-v">
            {{ decision.targetBand.minText.text }} /
            {{ decision.targetBand.stdText.text }} /
            {{ decision.targetBand.maxText.text }}
          </span>
        </div>
        <div class="kv">
          <span class="kv-k">建议仓位</span>
          <span class="kv-v"><FieldValue :d="decision.suggestedPositionText" /></span>
        </div>
        <div class="kv">
          <span class="kv-k">仓位上限</span>
          <span class="kv-v"><FieldValue :d="decision.maxPositionText" /></span>
        </div>
        <div class="kv">
          <span class="kv-k">建议核心 / 交易</span>
          <span class="kv-v">
            {{ decision.suggestedCoreText.text }} / {{ decision.suggestedTradeText.text }}
            <span class="badge outline sm" style="margin-left:6px">建议</span>
          </span>
        </div>
        <div class="kv">
          <span class="kv-k">加仓冷静期</span>
          <span class="kv-v"><FieldValue :d="decision.cooldownText" /></span>
        </div>
        <div class="kv">
          <span class="kv-k">超配状态</span>
          <span class="kv-v">{{ decision.overAllocText }}</span>
        </div>
        <div class="kv">
          <span class="kv-k">机会等级</span>
          <span class="kv-v">{{ decision.opportunity.gradeText }}（{{ decision.opportunity.scoreText.text }} 分）</span>
        </div>
        <div class="kv">
          <span class="kv-k">下一加仓条件</span>
          <span class="kv-v"><FieldValue :d="decision.nextAddConditionText" /></span>
        </div>
      </div>

      <hr class="divider" />

      <!-- 五维评分（点数，⛔ 不显总分） -->
      <div class="section-title mb-2">评分维度（点数，⛔ 不加 %、⛔ 不显总分）</div>
      <div class="kv-grid">
        <div class="kv"><span class="kv-k">趋势</span><span class="kv-v">{{ decision.scoresView.trend.text }}</span></div>
        <div class="kv"><span class="kv-k">量能</span><span class="kv-v">{{ decision.scoresView.volume.text }}</span></div>
        <div class="kv"><span class="kv-k">基本面</span><span class="kv-v">{{ decision.scoresView.fundamental.text }}</span></div>
        <div class="kv"><span class="kv-k">拥挤度</span><span class="kv-v">{{ decision.scoresView.crowding.text }}</span></div>
        <div class="kv"><span class="kv-k">风险</span><span class="kv-v">{{ decision.scoresView.risk.text }}</span></div>
        <div class="kv">
          <span class="kv-k">阶段 / 市场系数</span>
          <span class="kv-v">
            {{ decision.factorsView.stage.text }} / {{ decision.factorsView.market.text }}
            <span class="text-11" style="color:var(--c-text-3)">（系数 0~1，⛔ 不是百分比）</span>
          </span>
        </div>
      </div>

      <hr class="divider" />

      <!-- ★ 决策链：定性（M4-D3） -->
      <div class="section-head" style="margin-bottom:8px">
        <div>
          <div class="section-title">{{ boundaries.chainTitle }}</div>
          <div class="section-sub">{{ boundaries.chainNote }}</div>
        </div>
        <ToneBadge
          :text="decision.chain.available ? (decision.chain.total + ' 步') : '数据未提供'"
          tone="outline"
          small
        />
      </div>

      <div v-if="!decision.chain.available" class="banner mb-2">
        <div class="banner-text">决策链<b>数据未提供</b>。</div>
      </div>
      <div v-else>
        <ol class="chain chain-qual">
          <li v-for="s in decision.chain.steps" :key="s.step" class="chain-step">
            <span class="chain-qual-cond">{{ s.conditionDisplay || '（条件未提供）' }}</span>
            <span v-if="s.resultDisplay" class="chain-qual-res">{{ s.resultDisplay }}</span>
            <span v-else-if="s.resultHiddenText" class="chain-qual-hidden">{{ s.resultHiddenText }}</span>
          </li>
        </ol>
        <p v-if="decision.chainHiddenSummary" class="state-sub mt-2">{{ decision.chainHiddenSummary }}</p>
      </div>
    </template>
  </section>
</template>
