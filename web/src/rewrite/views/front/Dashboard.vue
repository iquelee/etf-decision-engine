<script setup>
/**
 * 全局 —— 前台路由目标视图
 *
 * SPEC          §4.1 前台 A · §4.2
 * 里程碑        M3（本文件为 M1 建立的**可达骨架**；业务内容在 M3 实现）
 * 业务职责      用最短路径回答：市场环境 / 需关注的 ETF / 系统建议 / 仓位与目标 / 为什么 / 什么证据 / 最近变化
 * 数据来源      GET /api/dashboard · GET /api/constants
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
      <h2>全局</h2>
      <p class="page-sub">用最短路径回答：市场环境 / 需关注的 ETF / 系统建议 / 仓位与目标 / 为什么 / 什么证据 / 最近变化</p>
    </header>

    <div class="pending">
      <div class="pending-title">待实现（M3）</div>
      <div class="pending-sub">数据来源：GET /api/dashboard · GET /api/constants</div>
    </div>

    <div class="section">
      <div class="section-head">
        <div>
          <div class="section-title">约定区块</div>
          <div class="section-sub">以下区块按 SPEC §4.1 前台 A · §4.2 落实，实现后删除本占位块</div>
        </div>
      </div>
      <ul class="block-list">
        <li>结论带（市场环境·风险·数据截至）</li>
        <li>生命周期条（SPEC §1.2 / §7）</li>
        <li>Gen-1 主建议（契约缺则显式态）</li>
        <li>5 张标的卡（动作 / 仓位→目标 / 风险 / 阶段码）</li>
        <li>组合状态（金额默认遮罩 + 显隐）</li>
        <li>重要风险条</li>
        <li>数据新鲜度</li>
        <li>系统运行状态（折叠）</li>
      </ul>
    </div>
  </section>
</template>
