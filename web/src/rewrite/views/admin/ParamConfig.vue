<script setup>
/**
 * 参数配置 —— 后台路由目标视图
 *
 * SPEC          §5 策略配置
 * 里程碑        M8（本文件为 M1 建立的**可达骨架**；业务内容在 M8 实现）
 * 业务职责      参数表（现值/前值/版本/冻结态）+ 编辑 + 影响面确认
 * 数据来源      GET/POST /api/admin/param
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
      <h2>参数配置</h2>
      <p class="page-sub">参数表（现值/前值/版本/冻结态）+ 编辑 + 影响面确认</p>
    </header>

    <div class="pending">
      <div class="pending-title">当前版本暂未提供</div>
      <div class="pending-sub">本页功能将在后续版本开放。</div>
    </div>

  </section>
</template>
