<script setup>
/**
 * K 线区（web/src/rewrite/components/workbench/KlineSection.vue）
 * 规范依据：owner 裁定 M4-D2 ＋ M4-P0 §0-2（K 线陈旧）
 *
 * ★ 与「决策新鲜度」**严格独立**：
 *   决策数据可以是 FRESH，同时 K 线是 STALE（实测正是如此：决策 2026-09-29，K 线止于 2024-08-27）。
 *   ⛔ 本组件不得把两者合成一个「数据日期」。
 * ★ 三态必须分得开（SPEC §9）：STALE（过期）≠ MISSING（字段缺失）≠ 空数组（合法 0 根）。
 */
import SectionHeader from '../SectionHeader.vue';
import ToneBadge from '../domain/ToneBadge.vue';
import MiniKline from './MiniKline.vue';
import Fact from '../domain/Fact.vue';
import { FACT } from '../../domain/ownership.js';

defineProps({
  /** adapter 的 `vm.kline` */
  kline: { type: Object, required: true },
  /** 标的代码（仅用于标题） */
  code: { type: String, default: '' }
});
</script>

<template>
  <section class="section prio-evidence">
    <!-- ★ M5-P1：K 线时点的**主位**标记放在**始终渲染**的区块标题上 ——
         否则当 K 线不可用（空/缺失/失败）时，页头的引用位会变成「悬空引用」
         （由 `m5-visual-check.py` 的更严规则：ref>0 而 owner=0 即缺陷）。 -->
    <Fact :fact="FACT.KLINE_LAST_DATE">
      <SectionHeader
        eyebrow="行情"
        title="K 线"
        :subtitle="kline.available ? ('数据截至 ' + kline.lastBarDateText) : ''"
      >
        <template #actions>
          <ToneBadge
            :text="kline.statusLabel"
            :tone="kline.isSeverelyStale ? 'risk' : (kline.freshness.level === 'FRESH' ? 'good' : 'muted')"
            small
          />
        </template>
      </SectionHeader>
    </Fact>

    <!-- ⓪ 请求失败 ⇒ 必须与「空」和「缺失」都区分开（⛔ 不把错误说成空） -->
    <div v-if="kline.state === 'ERROR'" class="banner mb-3">
      <div class="banner-text">
        K 线<b>读取失败</b><template v-if="kline.errorText">（{{ kline.errorText }}）</template>。
        这是请求错误，<b>不是</b>「没有行情数据」，故不显示空图。
      </div>
    </div>

    <!-- ① 未提供（未请求 / 契约缺失） -->
    <div v-else-if="!kline.available && kline.state === 'UNAVAILABLE'" class="banner mb-3">
      <div class="banner-text">K 线<b>数据未提供</b>。本页不会用其它来源的价格替代。</div>
    </div>

    <!-- ② 显式缺失（畸形响应） -->
    <div v-else-if="!kline.available" class="banner mb-3">
      <div class="banner-text">
        K 线<b>字段缺失</b>（后端返回结构异常）。⛔ 与「没有行情数据」不是同一状态，故不显示空图。
      </div>
    </div>

    <!-- ③ 合法空（0 根） -->
    <div v-else-if="kline.count === 0" class="banner mb-3">
      <div class="banner-text">K 线数据为<b>空</b>（0 根），属合法状态，区别于缺失或错误。</div>
    </div>

    <!-- ④ 有数据：照常绘制（★ 陈旧也保留） -->
    <template v-else>
      <MiniKline :bars="kline.bars" :height="200" />

      <div class="kv-grid mt-2">
        <div class="kv">
          <span class="kv-k">数据截至</span>
          <span class="kv-v"><b>{{ kline.lastBarDateText }}</b></span>
        </div>
        <div class="kv">
          <span class="kv-k">K 线新鲜度</span>
          <span class="kv-v">
            {{ kline.freshness.text }}
            <template v-if="kline.isSeverelyStale">（滞后 {{ kline.staleDays }} 天）</template>
          </span>
        </div>
        <div class="kv">
          <span class="kv-k">根数</span>
          <span class="kv-v">{{ kline.count }}</span>
        </div>
        <div class="kv">
          <span class="kv-k">决策新鲜度（独立）</span>
          <span class="kv-v">{{ kline.decisionFreshnessText }}</span>
        </div>
      </div>
    </template>
  </section>
</template>
