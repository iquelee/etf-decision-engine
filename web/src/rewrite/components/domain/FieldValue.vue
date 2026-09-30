<script setup>
/**
 * 字段值渲染（web/src/rewrite/components/domain/FieldValue.vue）
 * 规范依据：SPEC §9（缺失状态机）/ §12.3 / §13
 *
 * 职责单一：把一个**已由 adapter 归一**的展示对象
 *   `{ text, missing, reasonText }` 渲染出来。
 * ⛔ 本组件不 import api/adapters；⛔ 不自行格式化数字、不猜单位、不判断业务语义。
 *
 * ★ 关键设计：`缺失` 与「值为 0 / 空」必须**视觉可区分**（虚线 + 灰字 + 悬停显示原因），
 *    避免旧前端用 `—` 把「字段缺失」和「值就是空」混为一谈。
 */
defineProps({
  /** adapter 产出的展示对象：{ text, missing, reason, reasonText } */
  d: { type: Object, required: true },
  /** 大号数字（仅用于首屏关键值） */
  big: { type: Boolean, default: false },
  strong: { type: Boolean, default: false }
});
</script>

<template>
  <span
    class="fv"
    :class="{ missing: d.missing, big, strong }"
    :title="d.missing ? (d.reasonText || '数据未提供') : ''"
  >{{ d.text }}</span>
</template>
