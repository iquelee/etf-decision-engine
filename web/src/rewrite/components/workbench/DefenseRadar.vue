<script setup>
/**
 * 防守雷达（web/src/rewrite/components/workbench/DefenseRadar.vue）
 * 规范依据：owner M4-P1b §四 / §九.1
 *
 * ★★ 本区**只用后端已算结果**：
 *   `defense_state.level`（数字 0~4）· `.reason` · `.score`（0~100 分）· `.factor`（乘性系数）
 *   ⛔ **禁止**任何前端 heuristic（旧前端按 W 态 + 放量字段自行分档，已移除）。
 *
 * ★ 量纲必须在 UI 上可辨（用户反复强调）：
 *   `37` 是**分数**（⛔ 不加 %）；`0.95` 是**乘性系数**（⛔ 不是 95%）；`level` 是**数字档位**。
 *   三个值各带 `.note` 说明，⛔ 不得只给数字让人猜。
 *
 * ★ 视觉权重：Risk / Defense 属**第 2 档**（低于正式决策、高于仓位与证据）。
 */
import SectionHeader from '../SectionHeader.vue';
import FieldValue from '../domain/FieldValue.vue';
import ToneBadge from '../domain/ToneBadge.vue';

defineProps({
  /** adapter 的 `vm.defense` */
  defense: { type: Object, required: true }
});
</script>

<template>
  <section class="section rank-defense">
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
            <span class="def-level" :class="'text-tone-' + defense.levelTone">{{ defense.levelLabel }}</span>
            <span class="def-level-raw">level = {{ defense.levelNumber === null ? '—' : defense.levelNumber }}</span>
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
        <div class="kv">
          <span class="kv-k">风险旗标</span>
          <span class="kv-v"><ToneBadge :text="defense.riskLabel" :tone="defense.riskTone" dot /></span>
        </div>
        <div class="kv">
          <span class="kv-k">人工覆盖</span>
          <span class="kv-v"><FieldValue :d="defense.riskOverrideText" /></span>
        </div>
        <div class="kv">
          <span class="kv-k">超配状态</span>
          <span class="kv-v">{{ defense.overAllocText }}</span>
        </div>
        <div class="kv">
          <span class="kv-k">溢价状态</span>
          <span class="kv-v">{{ defense.premiumText }}</span>
        </div>
        <div class="kv">
          <span class="kv-k">溢价率</span>
          <span class="kv-v"><FieldValue :d="defense.premiumRateText" /></span>
        </div>
      </div>

      <hr class="divider" />

      <!-- ★ 风险事件：★ 空数组只能说「没有返回事件数据」（用户 §六） -->
      <div class="section-head" style="margin-bottom:8px">
        <div>
          <div class="section-title">风险事件</div>
          <div class="section-sub">
            <template v-if="defense.events.isEmpty">{{ defense.events.emptyNote }}</template>
            <template v-else-if="defense.events.available">共 {{ defense.events.count }} 条</template>
            <template v-else>该字段未提供，已按「无事件可展示」处理并标注</template>
          </div>
        </div>
        <ToneBadge
          :text="defense.events.available ? (defense.events.isEmpty ? '无事件记录' : defense.events.count + ' 条') : '数据未提供'"
          tone="outline"
          small
        />
      </div>

      <div v-if="defense.events.isEmpty" class="banner">
        <div class="banner-text">{{ defense.events.emptyText }}</div>
      </div>
      <ul v-else-if="defense.events.available" class="block-list">
        <li v-for="(e, i) in defense.events.items" :key="i">
          <b>{{ e.reasonText }}</b>
          <span class="text-11" style="color:var(--c-text-3)">
            · {{ e.statusText }}<template v-if="e.riskFlag && e.riskFlag.value"> · {{ e.riskFlag.value }}</template>
            · {{ e.triggerTimeText }}
          </span>
        </li>
      </ul>
    </template>
  </section>
</template>
