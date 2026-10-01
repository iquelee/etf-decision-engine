<script setup>
/**
 * V3.6.5 生产状态 —— 后台路由目标视图
 *
 * SPEC          §1.2 · §7
 * 里程碑        M8（本文件为 M1 建立的**可达骨架**；业务内容在 M8 实现）
 * 业务职责      展示 V3.6.5 生产生命周期矩阵：6 个维度分开建模，无 API 的部分显示「数据未提供 · 待后端契约」
 * 数据来源      /api/constants → runtime_status（部分）· 其余维度无接口（SPEC §7.1）
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
      <h2>V3.6.5 生产状态</h2>
      <p class="page-sub">展示 V3.6.5 生产生命周期矩阵：6 个维度分开建模，无 API 的部分显示「数据未提供 · 待后端契约」</p>
    </header>

    <div class="pending">
      <div class="pending-title">待实现（M8）</div>
      <div class="pending-sub">数据来源：/api/constants → runtime_status（部分）· 其余维度无接口（SPEC §7.1）</div>
      <p class="pending-sub">SPEC §1.3：⛔ 不得把「部署完成」写成「正式生产运行」；⛔ 不得在无 run evidence 时显示「最近生产运行」；⛔ 不得硬编码生命周期状态。</p>
    </div>

    <div class="section">
      <div class="section-head">
        <div>
          <div class="section-title">约定区块</div>
          <div class="section-sub">以下区块按 SPEC §1.2 · §7 落实，实现后删除本占位块</div>
        </div>
      </div>
      <ul class="block-list">
        <li>deployment_state</li>
        <li>activation_authorization</li>
        <li>first_controlled_run</li>
        <li>prospective_epoch</li>
        <li>run_history_index</li>
        <li>general_production</li>
        <li>runtime_status 边界字段组（SPEC §7.2）</li>
      </ul>
    </div>
  </section>
</template>
