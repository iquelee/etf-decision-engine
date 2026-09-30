<script setup>
/**
 * 看盘 —— 前台路由目标视图
 *
 * SPEC          §4.1 前台 E · §4.2
 * 里程碑        M5（本文件为 M1 建立的**可达骨架**；业务内容在 M5 实现）
 * 业务职责      以结构识别为中心（阶段 / 横盘 / 量价结构 / 破位与防守）
 * 数据来源      /api/etf/:code · /api/etf/:code/kline
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
      <h2>看盘</h2>
      <p class="page-sub">以结构识别为中心（阶段 / 横盘 / 量价结构 / 破位与防守）</p>
    </header>

    <div class="pending">
      <div class="pending-title">待实现（M5）</div>
      <div class="pending-sub">数据来源：/api/etf/:code · /api/etf/:code/kline</div>
    </div>

    <div class="section">
      <div class="section-head">
        <div>
          <div class="section-title">约定区块</div>
          <div class="section-sub">以下区块按 SPEC §4.1 前台 E · §4.2 落实，实现后删除本占位块</div>
        </div>
      </div>
      <ul class="block-list">
        <li>结构总览（阶段码 + 横盘四重确认）</li>
        <li>K线/量价（结构标注）</li>
        <li>加仓结构雷达</li>
        <li>防守结构雷达</li>
      </ul>
    </div>
  </section>
</template>
