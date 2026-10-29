<script setup>
/**
 * V3.6.5 生产状态 —— 后台路由目标视图
 *
 * SPEC          §1.2 · §7
 * 里程碑        M8（本文件为 M1 建立的**可达骨架**；业务内容在 M8 实现）
 * 业务职责      展示 V3.6.5 生产生命周期矩阵：6 个维度分开建模，无 API 的部分显示「数据未提供 · 待后端契约」
 * 数据来源      /api/constants → runtime_status（部分）· 其余维度无接口（SPEC §7.1）
 *
 * ★ 6 个生命周期维度（SPEC §7.1 —— 契约清单，保留供门禁/后续实现引用，⛔ 当前 UI 不渲染）：
 *     deployment_state · activation_authorization · first_controlled_run
 *     prospective_epoch · run_history_index · general_production
 *   ⚠️ 2026-10-02：原以「约定区块」列表形式渲染在页面上（含 milestone 编号与开发指令），
 *      属开发期痕迹，已从 UI 移除；清单改存本注释，⛔ 不暴露给最终用户。
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
      <p class="page-sub">展示 V3.6.5 生产生命周期矩阵：6 个维度分开建模，无 API 的部分显示「数据未提供」</p>
    </header>

    <div class="pending">
      <div class="pending-title">当前版本暂未提供</div>
      <div class="pending-sub">本页功能将在后续版本开放。</div>
    </div>

  </section>
</template>
