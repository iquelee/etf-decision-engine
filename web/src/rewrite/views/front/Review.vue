<script setup>
/**
 * 复盘 —— 前台路由目标视图
 *
 * SPEC          §4.1 前台 D · §4.2 · §8.1
 * 里程碑        M7（本文件为 M1 建立的**可达骨架**；业务内容在 M7 实现）
 * 业务职责      决策事件 → 系统建议 → 实际操作 → 偏差 → 响应时间 → 历史趋势（需鉴权）
 * 数据来源      GET /api/review（带 X-Admin-Token）
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
      <h2>复盘</h2>
      <p class="page-sub">决策事件 → 系统建议 → 实际操作 → 偏差 → 响应时间 → 历史趋势（需鉴权）</p>
    </header>

    <div class="pending">
      <div class="pending-title">待实现（M7）</div>
      <div class="pending-sub">数据来源：GET /api/review（带 X-Admin-Token）</div>
      <p class="pending-sub">SPEC §8.1：涉及 account snapshot / holdings / trade_log / actual execution / deviation 的数据不得变成公开页面。</p>
    </div>

    <div class="section">
      <div class="section-head">
        <div>
          <div class="section-title">约定区块</div>
          <div class="section-sub">以下区块按 SPEC §4.1 前台 D · §4.2 · §8.1 落实，实现后删除本占位块</div>
        </div>
      </div>
      <ul class="block-list">
        <li>复盘统计 8 项</li>
        <li>事件流（决策-执行配对，可展开）</li>
        <li>偏差</li>
        <li>历史趋势</li>
      </ul>
    </div>
  </section>
</template>
