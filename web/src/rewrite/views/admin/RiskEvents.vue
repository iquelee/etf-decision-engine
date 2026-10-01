<script setup>
/**
 * 风险事件 —— 后台路由目标视图
 *
 * SPEC          §5 策略配置
 * 里程碑        M8（本文件为 M1 建立的**可达骨架**；业务内容在 M8 实现）
 * 业务职责      触发风险事件（类型/等级/处置/理由必填）+ 事件列表 + 解除（理由必填）
 * 数据来源      GET /api/admin/risk/list · POST /api/admin/risk
 *
 * ⛔ 实现约束（SPEC §2.2）：
 *    本文件 ⛔ 不得 import api/ 或 adapters/；数据经 compose/ 注入；
 *    ⛔ 不得在模板里解释后端原始字段；⛔ 不得自行实现 action/risk/regime 文案或数字格式化。
 * ⛔ 样式禁止：linear-gradient / backdrop-filter（SPEC §12.3）。
 *    共用样式走全局原子类（styles/utilities.css），⛔ 不在此重复声明。
 */
</script>

<template>
  <section class="page">

    <header class="page-head">
      <h2>风险事件</h2>
      <p class="page-sub">触发风险事件（类型/等级/处置/理由必填）+ 事件列表 + 解除（理由必填）</p>
    </header>

    <div class="pending">
      <div class="pending-title">待实现（M8）</div>
      <div class="pending-sub">数据来源：GET /api/admin/risk/list · POST /api/admin/risk</div>
    </div>

    <div class="section">
      <div class="section-head">
        <div>
          <div class="section-title">约定区块</div>
          <div class="section-sub">以下区块按 SPEC §5 策略配置 落实，实现后删除本占位块</div>
        </div>
      </div>
      <ul class="block-list">
        <li>触发表单</li>
        <li>事件列表</li>
        <li>解除</li>
      </ul>
    </div>
  </section>
</template>
