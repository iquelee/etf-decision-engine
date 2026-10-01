<script setup>
/**
 * K 线滞后置顶提示（web/src/rewrite/components/workbench/StaleBanner.vue）
 * 规范依据：owner 裁定 M4-D2（2026-09-30）
 *
 * ★ 裁定要点（⛔ 不得偏离）：
 *   · 置顶 Banner + **图表保留**（⛔ 不修改数据、⛔ 不猜最新价、⛔ 不删历史数据伪装正常、⛔ 不把 stale 当 empty）；
 *   · 文案中的日期**必须来自实际数据**（由 adapter 组装，⛔ 组件不硬编码任何日期）；
 *   · ★ **不得**把「K 线 stale」扩展成「ETF decision stale」—— 两者是独立状态，
 *     故本组件**只**描述 K 线，并显式声明「与决策新鲜度无关」。
 */
defineProps({
  /** adapter 的 `kline.banner`：`{ show, title, text }` */
  banner: { type: Object, required: true },
  /** K 线状态标签（如 `STALE · 数据滞后`） */
  statusLabel: { type: String, default: '' },
  /** 保留说明（⛔ 组件不硬编码文案） */
  keepNote: { type: String, default: '' },
  /** 决策新鲜度文案（★ 用于**声明两者独立**，不是用于比较） */
  decisionFreshnessText: { type: String, default: '' }
});
</script>

<template>
  <div v-if="banner.show" class="stale-banner" role="status">
    <div class="stale-banner-main">
      <span class="stale-banner-icon" aria-hidden="true">!</span>
      <div>
        <div class="stale-banner-title">{{ banner.title }}</div>
        <div class="stale-banner-text">{{ banner.text }}</div>
      </div>
    </div>
    <div class="stale-banner-meta">
      <span class="stale-banner-tag">{{ statusLabel }}</span>
      <span v-if="keepNote" class="stale-banner-note">{{ keepNote }}</span>
      <span v-if="decisionFreshnessText" class="stale-banner-note">
        K 线新鲜度与决策新鲜度<b>相互独立</b>：决策数据当前为「{{ decisionFreshnessText }}」。
      </span>
    </div>
  </div>
</template>
