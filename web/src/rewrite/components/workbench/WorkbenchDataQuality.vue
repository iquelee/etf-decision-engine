<script setup>
/**
 * 数据质量 / 来源区（web/src/rewrite/components/workbench/WorkbenchDataQuality.vue）
 * 规范依据：用户 M4-P1 指令（最后统一展示 Decision freshness / K-line freshness /
 *   Gen-1 availability / source / as-of / missing fields）
 *
 * ★ 各域新鲜度**必须并列且独立**（⛔ 不得合成一个「数据日期」）。
 * ★ `source` / `as-of` / `provenance` 不得丢失。
 * ★ 同时诚实登记**本页不消费**的载荷块（M4-P0 §D）。
 */
import SectionHeader from '../SectionHeader.vue';
import ToneBadge from '../domain/ToneBadge.vue';

const props = defineProps({
  vm: { type: Object, required: true }
});

const freshTone = (level) => (level === 'FRESH' ? 'good' : level === 'STALE' ? 'risk' : 'muted');
</script>

<template>
  <section class="section prio-evidence">
    <SectionHeader
      eyebrow="数据质量"
      title="新鲜度 / 来源 / 缺什么"
      subtitle="各域新鲜度相互独立：决策新鲜 ⇏ K 线新鲜。"
    />

    <div class="kv-grid">
      <div class="kv">
        <span class="kv-k">决策（decision）</span>
        <span class="kv-v"><ToneBadge :text="vm.freshness.decision.text" :tone="freshTone(vm.freshness.decision.level)" small /></span>
      </div>
      <div class="kv">
        <span class="kv-k">快照（snapshot）</span>
        <span class="kv-v"><ToneBadge :text="vm.freshness.snapshot.text" :tone="freshTone(vm.freshness.snapshot.level)" small /></span>
      </div>
      <div class="kv">
        <span class="kv-k">K 线（kline）</span>
        <span class="kv-v"><ToneBadge :text="vm.freshness.kline.text" :tone="freshTone(vm.freshness.kline.level)" small /></span>
      </div>
      <div class="kv">
        <span class="kv-k">基本面（fundamental）</span>
        <span class="kv-v"><ToneBadge :text="vm.freshness.fundamental.text" :tone="freshTone(vm.freshness.fundamental.level)" small /></span>
      </div>
      <!-- ★ M5-P1：组合环境新鲜度（只读引用 `/api/dashboard`；无契约 ⇒ 未提供，⛔ 不猜） -->
      <div class="kv">
        <span class="kv-k">{{ vm.marketRegime.title }}（{{ vm.marketRegime.available ? '只读引用' : '未提供' }}）</span>
        <span class="kv-v">
          <ToneBadge
            :text="vm.marketRegime.available ? vm.marketRegime.freshness.text : '数据未提供'"
            :tone="vm.marketRegime.available ? freshTone(vm.marketRegime.freshness.level) : 'muted'"
            small
          />
        </span>
      </div>
      <div class="kv">
        <span class="kv-k">Gen-1 可用性</span>
        <span class="kv-v">
          <ToneBadge
            :text="vm.gen1Detail.available ? vm.gen1Detail.channelLabel : '数据未提供'"
            :tone="vm.gen1Detail.channelTone"
            small
          />
        </span>
      </div>
      <div class="kv">
        <span class="kv-k">取数时刻</span>
        <span class="kv-v">{{ vm.provenance.retrievedAtText || '—' }}</span>
      </div>
    </div>

    <hr class="divider" />

    <div class="section-title mb-2">来源（provenance）</div>
    <div class="kv-grid">
      <div class="kv"><span class="kv-k">数据源</span><span class="kv-v">{{ vm.provenance.source }}</span></div>
      <div class="kv"><span class="kv-k">Gen-1 通道</span><span class="kv-v">{{ vm.provenance.gen1ChannelLabel }}</span></div>
      <div class="kv"><span class="kv-k">是否 legacy 兜底</span><span class="kv-v">{{ vm.provenance.fallbackFrom || '否（canonical 或未提供）' }}</span></div>
      <div class="kv"><span class="kv-k">已消费块</span><span class="kv-v">{{ vm.provenance.blocks.join('、') }}</span></div>
    </div>

    <p class="state-sub mt-2">
      本页<b>不消费</b>的载荷块：{{ vm.provenance.notConsumedBlocks.join('、') }}
      —— 属 M6「基本面」页与后台范围，⛔ 不搬进工作台。
    </p>
    <p class="state-sub">{{ vm.provenance.listEndpointNote }}</p>

    <!-- ★ M5-P1：单源展示原则（本页唯一出处，⛔ 不在各区块重复声明） -->
    <p class="state-sub">
      <b>单源展示</b>：{{ vm.boundaries.singleSourcePrinciple }}
      <span class="text-11" style="color:var(--c-text-3)">
        （组合环境来源：{{ vm.marketRegime.sourceNote }}）
      </span>
    </p>

    <!-- 缺什么：把各域的显式缺失/未提供集中列出（⛔ 不静默） -->
    <template v-if="vm.missingItems && vm.missingItems.length">
      <hr class="divider" />
      <div class="section-title mb-2">显式缺失 / 未提供（{{ vm.missingItems.length }} 项）</div>
      <ul class="block-list">
        <li v-for="m in vm.missingItems" :key="m.k">
          <b>{{ m.k }}</b>：{{ m.v }}<span v-if="m.r" class="text-11" style="color:var(--c-text-3)"> · {{ m.r }}</span>
        </li>
      </ul>
    </template>
  </section>
</template>
