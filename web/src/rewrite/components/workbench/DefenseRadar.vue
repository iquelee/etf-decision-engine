<script setup>
/**
 * 防守雷达（web/src/rewrite/components/workbench/DefenseRadar.vue）
 * 规范依据：owner M4-P1b §四 / §九.1 ＋ owner 裁定 M5-P1（2026-10-01）
 *
 * ★★ 本区**只用后端已算结果**：
 *   `defense_state.level`（数字 0~4）· `.reason` · `.score`（0~100 分）· `.factor`（乘性系数）
 *   ⛔ **禁止**任何前端 heuristic（旧前端按 W 态 + 放量字段自行分档，已移除）。
 *
 * ★ 量纲必须在 UI 上可辨（用户反复强调）：
 *   `37` 是**分数**（⛔ 不加 %）；`0.95` 是**乘性系数**（⛔ 不是 95%）；`level` 是**数字档位**。
 *   三个值各带 `.note` 说明，⛔ 不得只给数字让人猜。
 *
 * ★ M5-P1（Single-Source）本区**主位**：防守 level / score / factor · 溢价状态与溢价率 ·
 *   超配状态。
 *   `risk_flag` 为**引用位**（主位「正式决策」）；`risk_events` 为**引用位**
 *   （主位「情报 / 基本面」，完整清单只在那里渲染 —— ⛔ 不再两处各自解释同一批事件）。
 *
 * ★ 视觉优先级：Risk & Defense 属**第二优先**（低于 Formal Decision、高于 Advisory／Evidence）。
 */
import SectionHeader from '../SectionHeader.vue';
import FieldValue from '../domain/FieldValue.vue';
import ToneBadge from '../domain/ToneBadge.vue';
import Fact from '../domain/Fact.vue';
import { FACT, OWNER } from '../../domain/ownership.js';

defineProps({
  /** adapter 的 `vm.defense` */
  defense: { type: Object, required: true }
});
</script>

<template>
  <section class="section prio-risk">
    <SectionHeader
      eyebrow="防守雷达"
      title="防守状态与风险"
      :subtitle="defense.readonlyNote"
    >
      <template #actions>
        <ToneBadge
          :text="defense.available ? defense.levelLabel : '数据未提供'"
          :tone="defense.available ? defense.levelTone : 'muted'"
          dot
        />
      </template>
    </SectionHeader>

    <p class="state-sub mb-3">{{ defense.scopeNote }}</p>

    <!-- 防守不可用：⛔ 不显示 0 分 / ⛔ 不显示 1.00 -->
    <div v-if="!defense.available" class="banner mb-3">
      <div class="banner-text">
        防守<b>数据未提供</b>（后端未下发防守族）。
        ⛔ 本页<b>不会</b>按周线状态或放量字段自行推算防守等级。
      </div>
    </div>

    <template v-else>
      <!-- ★ 主行：等级 + 原因（分数与系数在明细里，各带量纲说明） -->
      <div class="def-hero">
        <div class="def-hero-main">
          <div class="def-hero-label">防守等级</div>
          <div class="def-hero-value">
            <Fact :fact="FACT.DEFENSE_STATE">
              <span class="def-level" :class="'text-tone-' + defense.levelTone">{{ defense.levelLabel }}</span>
              <span class="def-level-raw">level = {{ defense.levelNumber === null ? '—' : defense.levelNumber }}</span>
            </Fact>
          </div>
          <div class="def-hero-note">原因：{{ defense.reasonText }}</div>
        </div>

        <div class="def-hero-cell">
          <div class="def-hero-label">防守分数</div>
          <div class="def-hero-num" :class="{ 'is-missing': defense.scoreText.missing }">
            {{ defense.scoreText.text }}
          </div>
          <div class="def-hero-note">{{ defense.scoreNote }}</div>
        </div>

        <div class="def-hero-cell">
          <div class="def-hero-label">防守系数</div>
          <div class="def-hero-num" :class="{ 'is-missing': defense.factorText.missing }">
            {{ defense.factorText.text }}
          </div>
          <div class="def-hero-note">{{ defense.factorNote }}</div>
        </div>
      </div>

      <!-- ★ 顶层冗余字段不一致时的警示（⛔ 不静默选边） -->
      <div v-if="defense.crossCheck.inconsistent" class="banner mb-3">
        <div class="banner-text">{{ defense.crossCheck.note }}</div>
      </div>

      <div class="kv-grid">
        <!-- 风险旗标 = 引用位（主位在「正式决策」，⛔ 本区不形成第二个风险结论） -->
        <div class="kv">
          <span class="kv-k">风险旗标</span>
          <span class="kv-v">
            <Fact :fact="FACT.RISK_FLAG" role="ref" :ref-to="OWNER.PRIMARY_DECISION">
              <ToneBadge :text="defense.riskLabel" :tone="defense.riskTone" dot />
            </Fact>
          </span>
        </div>
        <div class="kv">
          <span class="kv-k">人工覆盖</span>
          <span class="kv-v"><FieldValue :d="defense.riskOverrideText" /></span>
        </div>
        <div class="kv">
          <span class="kv-k">超配状态</span>
          <span class="kv-v"><Fact :fact="FACT.OVER_ALLOC">{{ defense.overAllocText }}</Fact></span>
        </div>
        <div class="kv">
          <span class="kv-k">溢价状态</span>
          <span class="kv-v"><Fact :fact="FACT.PREMIUM_FLAG">{{ defense.premiumText }}</Fact></span>
        </div>
        <div class="kv">
          <span class="kv-k">溢价率</span>
          <span class="kv-v"><Fact :fact="FACT.PREMIUM_RATE"><FieldValue :d="defense.premiumRateText" /></Fact></span>
        </div>
      </div>

      <hr class="divider" />

      <!-- ★ M5-P1：风险事件 = **引用位**（主位在「情报 / 基本面」）⇒ 本区只给条数，⛔ 不重复渲染清单 -->
      <div class="section-head">
        <div>
          <div class="section-title">风险事件</div>
          <div class="section-sub">
            完整清单与空数组文案由「情报 / 基本面」承载（主位）；本区只作条数引用。
          </div>
        </div>
        <ToneBadge
          :text="defense.events.available ? (defense.events.isEmpty ? '无事件记录' : '共 ' + defense.events.count + ' 条') : '数据未提供'"
          tone="outline"
          small
        />
      </div>
      <p class="state-sub mt-2">
        <Fact :fact="FACT.RISK_EVENTS" role="ref" :ref-to="OWNER.INTELLIGENCE">
          {{ defense.events.available
            ? (defense.events.isEmpty ? defense.events.emptyText : '共 ' + defense.events.count + ' 条风险事件')
            : '数据未提供' }}
        </Fact>
      </p>
    </template>
  </section>
</template>
