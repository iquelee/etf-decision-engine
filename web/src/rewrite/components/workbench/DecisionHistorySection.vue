<script setup>
/**
 * 历史决策变化（web/src/rewrite/components/workbench/DecisionHistorySection.vue）
 * 规范依据：owner M4-P1b §七 / §九.5（★ 硬规则：不伪造历史）
 *
 * ★★ 四条状态**必须分开**（⛔ 不得合并成"没有历史"一句话）：
 *   ① 未请求      ⇒ 「历史决策变化：数据未提供」（可自愈）
 *   ② 读取失败    ⇒ 「历史决策读取失败」（⛔ 与①不同）
 *   ③ 返回空数组  ⇒ 「后端返回的历史决策记录为空」（合法状态，⛔ 与①②都不同）
 *   ④ 有数据      ⇒ 逐条真实记录 + 变化标记
 *
 * ★ 硬规则：⛔ **绝对不得**用「当前 target + 当前 action + 当前日期」拼一条假历史；
 *   ⛔ 不得据当前字段推测「持有 → 加仓 → 防守」。
 *
 * ★ 视觉权重：History 属**最弱**一层（不抢决策与风险的注意力）。
 */
import SectionHeader from '../SectionHeader.vue';
import ToneBadge from '../domain/ToneBadge.vue';

defineProps({
  /** adapter 的 `vm.decisionHistory` */
  history: { type: Object, required: true }
});
</script>

<template>
  <section class="section rank-history">
    <SectionHeader
      eyebrow="历史"
      title="历史决策变化"
      :subtitle="history.available ? history.sourceNote : ''"
    >
      <template #actions>
        <ToneBadge
          :text="history.available ? (history.count + ' 条记录') : (history.state === 'ERROR' ? '读取失败' : '数据未提供')"
          :tone="history.state === 'ERROR' ? 'risk' : (history.available ? 'outline' : 'muted')"
          small
        />
      </template>
    </SectionHeader>

    <!-- ① 未请求 / ② 读取失败 / ③ 畸形：三种文案必须不同 -->
    <div v-if="!history.available" class="banner mb-3">
      <div class="banner-text">
        <b>{{ history.text }}</b>
        <template v-if="history.note"> {{ history.note }}</template>
      </div>
    </div>

    <!-- ④ 空数组（合法） -->
    <div v-else-if="history.count === 0" class="banner mb-3">
      <div class="banner-text">
        <b>{{ history.text }}</b> {{ history.note }}
      </div>
    </div>

    <!-- ⑤ 有真实历史 -->
    <template v-else>
      <p class="state-sub mb-2">
        {{ history.changeNote }}
        本页展示的都是<b>后端历史记录原值</b>，⛔ 不由当前字段拼装。
      </p>

      <div class="kv-grid mb-3">
        <div class="kv"><span class="kv-k">记录条数</span><span class="kv-v">{{ history.count }}</span></div>
        <div class="kv"><span class="kv-k">覆盖区间</span><span class="kv-v">{{ history.oldestDate }} ~ {{ history.newestDate }}</span></div>
        <div class="kv">
          <span class="kv-k">首条新鲜度</span>
          <span class="kv-v">
            <ToneBadge :text="history.freshness.text" :tone="history.freshness.level === 'FRESH' ? 'good' : 'risk'" small />
          </span>
        </div>
        <div class="kv"><span class="kv-k">检测到变化</span><span class="kv-v">{{ history.changedCount }} 处</span></div>
      </div>

      <!-- 变化摘要（★ 相邻两条实测值差异，⛔ 不推断原因） -->
      <template v-if="history.changedCount">
        <div class="section-title mb-2">变化点（相邻记录对比）</div>
        <ul class="block-list mb-3">
          <li v-for="(c, i) in history.changes" :key="i">
            <span class="text-11" style="color:var(--c-text-3)">{{ c.date }}</span>
            <b> {{ c.label }}</b>：{{ c.from }} → {{ c.to }}
          </li>
        </ul>
      </template>

      <!-- 桌面表 -->
      <div class="hist-tbl-wrap">
        <table class="hist-tbl">
          <thead>
            <tr>
              <th>日期</th><th>动作</th><th>目标</th><th>缺口</th>
              <th>风险</th><th>防守</th><th>防守分</th><th>超配</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(r, i) in history.items" :key="r.date" :class="{ 'hist-latest': i === 0 }">
              <td class="hist-date">{{ r.dateText }}</td>
              <td :class="'text-tone-' + r.actionTone"><b>{{ r.actionText }}</b></td>
              <td class="num">{{ r.finalTargetText.text }}</td>
              <td class="num">{{ r.gapText.text }}</td>
              <td :class="'text-tone-' + r.riskTone">{{ r.riskText }}</td>
              <td :class="'text-tone-' + r.defenseLevelTone">{{ r.defenseLevelText }}</td>
              <td class="num">{{ r.defenseScoreText.text }}</td>
              <td>{{ r.overAllocText }}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- 移动端卡（★ 同一份数据，⛔ 不换一套文案） -->
      <div class="hist-cards">
        <div v-for="(r, i) in history.items" :key="r.date" class="hist-card" :class="{ 'hist-latest': i === 0 }">
          <div class="hist-card-head">
            <span class="hist-date">{{ r.dateText }}</span>
            <span :class="'text-tone-' + r.actionTone"><b>{{ r.actionText }}</b></span>
          </div>
          <div class="hist-card-nums">
            <span>目标 {{ r.finalTargetText.text }}</span>
            <span>缺口 {{ r.gapText.text }}</span>
            <span>风险 {{ r.riskText }}</span>
            <span>防守 {{ r.defenseLevelText }}</span>
          </div>
        </div>
      </div>
    </template>
  </section>
</template>
