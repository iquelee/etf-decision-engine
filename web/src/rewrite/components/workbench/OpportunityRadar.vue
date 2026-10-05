<script setup>
/**
 * 机会 / 辅助信号（web/src/rewrite/components/workbench/OpportunityRadar.vue）
 * 规范依据：owner M4-P1b §三 / §九.1 ＋ owner 裁定 M5-P1（2026-10-01）
 *
 * ★★ 命名纪律（本组件的**首要约束**）：
 *   后端已有正式 `action` / `final_target` / `position_gap` ⇒ 属 **V3 Safety Core 正式决策**；
 *   本区只呈现**辅助信号**，⛔ **不得**出现「建议加仓」这类措辞，
 *   ⛔ **不得**因 `position_gap > 0` 推导「应该加仓」。
 *
 * ★ 量纲：机会分 = 点数（⛔ 不加 %）；机会系数 = 乘性系数（⛔ 不是百分比）。
 *
 * ★ M5-P1（Single-Source）本区**主位**：机会分 / 机会等级 / 机会系数 · 加仓资格 10 项 ·
 *   加仓模式 / 冷静期 / 下一加仓条件。
 *   `position_gap` 为**引用位**（主位「仓位与风险」），⛔ 不据它推导动作。
 *   `next_add_condition` 文案中与结构化字段冲突的「Gap 数字」片段已被移除（owner D-M5-5 / DS-006）。
 */
import SectionHeader from '../SectionHeader.vue';
import FieldValue from '../domain/FieldValue.vue';
import ToneBadge from '../domain/ToneBadge.vue';
import Fact from '../domain/Fact.vue';
import { FACT, OWNER } from '../../domain/ownership.js';

defineProps({
  /** adapter 的 `vm.opportunity` */
  opportunity: { type: Object, required: true }
});
</script>

<template>
  <section class="section prio-advisory">
    <SectionHeader
      eyebrow="机会 / 辅助信号"
      title="机会与加仓条件"
      :subtitle="opportunity.sectionNote"
    >
      <template #actions>
        <ToneBadge
          :text="opportunity.available ? ('机会等级 ' + opportunity.gradeText) : '数据未提供'"
          :tone="opportunity.available ? opportunity.levelTone : 'muted'"
          small
        />
      </template>
    </SectionHeader>

    <p class="advisory-note">{{ opportunity.noDeriveNote }}</p>
    <p class="state-sub mb-3">{{ opportunity.scopeNote }}</p>

    <div v-if="!opportunity.available" class="banner mb-3">
      <div class="banner-text">
        机会 / 加仓辅助信号<b>数据未提供</b>。
        ⛔ 本页不会用当前仓位或缺口反推机会等级。
      </div>
    </div>

    <template v-else>
      <!-- 主行：机会分（点） + 等级 + 系数 -->
      <div class="def-hero">
        <div class="def-hero-cell">
          <div class="def-hero-label">机会分</div>
          <div class="def-hero-num" :class="{ 'is-missing': opportunity.scoreText.missing }">
            <Fact :fact="FACT.OPPORTUNITY_SCORE">{{ opportunity.scoreText.text }}</Fact>
          </div>
          <div class="def-hero-note">{{ opportunity.scoreNote }}</div>
        </div>
        <div class="def-hero-cell">
          <div class="def-hero-label">机会等级</div>
          <div class="def-hero-value">
            <Fact :fact="FACT.OPPORTUNITY_GRADE">
              <ToneBadge
                :text="opportunity.gradeText + ' · ' + opportunity.levelText"
                :tone="opportunity.levelTone"
              />
            </Fact>
          </div>
          <div class="def-hero-note">等级与文案均由后端下发</div>
        </div>
        <div class="def-hero-cell">
          <div class="def-hero-label">机会系数</div>
          <div class="def-hero-num" :class="{ 'is-missing': opportunity.factorText.missing }">
            {{ opportunity.factorText.text }}
          </div>
          <div class="def-hero-note">{{ opportunity.factorNote }}</div>
        </div>
      </div>

      <div class="kv-grid">
        <div class="kv">
          <span class="kv-k">加仓模式</span>
          <span class="kv-v">{{ opportunity.addModeText }}</span>
        </div>
        <div class="kv">
          <span class="kv-k">加仓冷静期</span>
          <span class="kv-v">
            <Fact :fact="FACT.COOLDOWN">{{ opportunity.cooldownText.text }}</Fact>
            <span class="text-11" style="color:var(--c-text-3)">（天）</span>
          </span>
        </div>
        <!-- ★ M5-P1：仓位缺口的**引用位**（主位在「仓位与风险」）——只展示，⛔ 不据此推导动作 -->
        <div class="kv">
          <span class="kv-k">仓位缺口（正式决策）</span>
          <span class="kv-v">
            <Fact :fact="FACT.POSITION_GAP" role="ref" :ref-to="OWNER.POSITION_RISK">
              {{ opportunity.gapText.text }}
            </Fact>
            <span class="text-11" style="color:var(--c-text-3)"> · {{ opportunity.gapNote }}</span>
          </span>
        </div>
      </div>

      <hr class="divider" />

      <!-- 加仓资格：★ 10 项判据（旧前端只列 8 项） -->
      <div class="section-head" style="margin-bottom:8px">
        <div>
          <div class="section-title">加仓资格判据</div>
          <div class="section-sub">逐项为后端判定结果（⛔ 本页不重算、⛔ 不合并为单一结论）</div>
        </div>
        <ToneBadge
          :text="opportunity.eligibility.available
            ? ('总体：' + opportunity.eligibility.overallText + '（未通过 ' + opportunity.eligibility.blockedCount + ' 项）')
            : '数据未提供'"
          :tone="opportunity.eligibility.available ? opportunity.eligibility.overallTone : 'muted'"
          small
        />
      </div>

      <Fact :fact="FACT.ADD_ELIGIBILITY">
        <div class="elig-grid">
          <div v-for="it in opportunity.eligibility.items" :key="it.key" class="elig-item">
            <div class="elig-label">{{ it.label }}</div>
            <div class="elig-value" :class="'text-tone-' + it.tone">{{ it.statusText }}</div>
          </div>
        </div>
      </Fact>

      <div class="kv mt-3">
        <span class="kv-k">下一加仓条件（后端原文）</span>
        <span class="kv-v">
          <Fact :fact="FACT.NEXT_ADD_CONDITION">
            <FieldValue :d="opportunity.nextAddConditionText" />
          </Fact>
        </span>
      </div>
      <!-- ★ 被移除片段的显式声明（⛔ 不静默；文案来自 domain/labels） -->
      <p v-if="opportunity.conditionQuantStripped" class="state-sub mt-2">
        {{ opportunity.conditionQuantNote }}
      </p>
    </template>
  </section>
</template>
