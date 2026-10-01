<script setup>
/**
 * 生产生命周期条（web/src/rewrite/components/domain/LifecycleStrip.vue）
 * 规范依据：SPEC §1.2 / §1.3 / §7
 *
 * ★★ 三条硬约束（owner 裁定）：
 *   1. **8 个维度分开呈现**，⛔ 不合并成「一个总状态」；
 *   2. 无 API 数据 ⇒ 显示「数据未提供」+ 原因，⛔ 前端不写死当前状态；
 *   3. **三个轴必须永远可区分**：代码上线 ≠ 生产运行 ≠ 资格演进。
 *
 * ⛔ 本组件只渲染 adapter 给的 `valueText` / `reasonText`，
 *    自身不含任何状态字面量（COMPLETE / NOT_STARTED / … 均不得出现）。
 */
defineProps({
  /** adapter 的 lifecycle 对象：{ axesView, items, unavailableCount, totalCount, ... } */
  lifecycle: { type: Object, required: true }
});
</script>

<template>
  <div class="lifecycle">
    <section v-for="ax in lifecycle.axesView" :key="ax.axis" class="lc-axis">
      <div class="lc-axis-head">
        <span class="lc-axis-title">{{ ax.label }}</span>
        <span class="badge outline sm">{{ ax.allProvided ? '数据齐备' : '部分未提供' }}</span>
      </div>
      <div v-for="it in ax.items" :key="it.dim" class="lc-item">
        <span class="lc-k">{{ it.label }}</span>
        <span class="lc-v" :class="{ missing: !it.provided }" :title="it.provided ? it.sourceText : (it.reasonText + ' · ' + it.sourceText)">
          {{ it.valueText }}
        </span>
      </div>
      <p v-for="it in ax.items" v-show="it.caveat" :key="it.dim + '-caveat'" class="lc-caveat">{{ it.caveat }}</p>
    </section>
  </div>
</template>
