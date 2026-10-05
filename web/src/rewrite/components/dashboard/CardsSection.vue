<script setup>
/**
 * 标的区（web/src/rewrite/components/dashboard/CardsSection.vue）
 * 规范依据：SPEC §4.1 / §4.2 / §13
 *
 * ★ 响应式要求：⛔ 不用「桌面表格横向滚动」当移动方案。
 *   桌面（>900px）→ 表格；移动（≤900px）→ 一行一标的的堆叠卡（信息不丢）。
 *
 * ★ 数值全部来自 adapter 的 `display.*`（⛔ 组件不格式化数字、不重算 gap）。
 */
import SectionHeader from '../SectionHeader.vue';
import ActionBadge from '../domain/ActionBadge.vue';
import ToneBadge from '../domain/ToneBadge.vue';
import FieldValue from '../domain/FieldValue.vue';

defineProps({
  /** adapter 的 cards Field<Array> */
  cards: { type: Object, required: true },
  title: { type: String, default: '标的' },
  subtitle: { type: String, default: '' }
});
</script>

<template>
  <section class="section">
    <SectionHeader :title="title" :subtitle="subtitle" />

    <!-- 卡片整块缺失 -->
    <div v-if="cards.state !== 'PROVIDED'" class="banner">
      <div class="banner-text">
        标的列表：<b>{{ cards.state === 'MISSING' ? '字段缺失' : '数据未提供' }}</b>
        <template v-if="cards.missingReason">（原因：{{ cards.missingReason }}）</template>
      </div>
    </div>

    <div v-else-if="cards.value.length === 0" class="banner">
      <div class="banner-text">标的列表为空（后端返回 0 条）。</div>
    </div>

    <template v-else>
      <!-- 桌面：表格 -->
      <div class="tbl-wrap">
        <table class="tbl">
          <thead>
            <tr>
              <th class="col-name">标的</th>
              <th>动作</th>
              <th class="num">当前</th>
              <th class="num">目标</th>
              <th class="num">缺口</th>
              <th>超配</th>
              <th>机会</th>
              <th>风险</th>
              <th>阶段</th>
              <th>Gen-1</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="c in cards.value" :key="c.display.code">
              <td class="col-name">
                <div class="fw-semibold">{{ c.display.name }}</div>
                <div class="attn-code">{{ c.display.code }} · {{ c.sectorLabel }}</div>
              </td>
              <td><ActionBadge :text="c.display.action" :tone="c.display.actionTone" small /></td>
              <td class="num"><FieldValue :d="c.display.current" /></td>
              <td class="num"><FieldValue :d="c.display.target" strong /></td>
              <td class="num"><FieldValue :d="c.display.gap" /></td>
              <td>{{ c.display.overAlloc }}</td>
              <td><ToneBadge :text="c.display.opportunity" :tone="c.display.opportunityTone" small /></td>
              <td>{{ c.display.risk }}</td>
              <td class="stage-cell" :title="c.display.stageText">{{ c.display.trendStageText }}</td>
              <td>
                <ToneBadge
                  :text="c.display.gen1.available ? c.display.gen1.statusText : '数据未提供'"
                  :tone="c.display.gen1.available ? c.display.gen1.statusTone : 'muted'"
                  small
                />
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- 移动：一行一标的（避免横滑） -->
      <div class="tbl-mobile">
        <article v-for="c in cards.value" :key="c.display.code" class="row-card">
          <div class="row-head">
            <div>
              <div class="fw-semibold">{{ c.display.name }}</div>
              <div class="attn-code">{{ c.display.code }} · {{ c.sectorLabel }}</div>
            </div>
            <ActionBadge :text="c.display.action" :tone="c.display.actionTone" small />
          </div>
          <div class="row-nums">
            <div class="kv"><span class="kv-k">当前</span><span class="kv-v"><FieldValue :d="c.display.current" /></span></div>
            <div class="kv"><span class="kv-k">目标</span><span class="kv-v"><FieldValue :d="c.display.target" strong /></span></div>
            <div class="kv"><span class="kv-k">缺口</span><span class="kv-v"><FieldValue :d="c.display.gap" /></span></div>
            <div class="kv"><span class="kv-k">超配</span><span class="kv-v">{{ c.display.overAlloc }}</span></div>
            <div class="kv"><span class="kv-k">机会</span><span class="kv-v">{{ c.display.opportunity }}</span></div>
            <div class="kv"><span class="kv-k">风险</span><span class="kv-v">{{ c.display.risk }}</span></div>
          </div>
          <p class="state-sub mt-2">{{ c.display.stageText }}</p>
          <p class="state-sub">Gen-1：{{ c.display.gen1.available ? c.display.gen1.statusText : '数据未提供' }} · 数据时点 {{ c.display.dataTime }}</p>
        </article>
      </div>
    </template>
  </section>
</template>
