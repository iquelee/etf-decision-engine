<script setup>
/**
 * 标的 —— 前台路由目标视图
 *
 * SPEC          §4.1 前台 B · §4.2
 * 里程碑        M4（本文件为 M1 建立的**可达骨架**；业务内容在 M4 实现）
 * 业务职责      单只 ETF 全链路：动作 → 仓位 → 解释 → 环境 → WDHVF → K线 → 加仓/防守雷达 → Gen-1 timing → 基本面 → 情报 → 历史
 * 数据来源      /api/etf/:code · /api/etf/list · /api/etf/:code/kline · /api/etf/:code/decisions
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
      <h2>标的</h2>
      <p class="page-sub">单只 ETF 全链路：动作 → 仓位 → 解释 → 环境 → WDHVF → K线 → 加仓/防守雷达 → Gen-1 timing → 基本面 → 情报 → 历史</p>
    </header>

    <div class="pending">
      <div class="pending-title">待实现（M4）</div>
      <div class="pending-sub">数据来源：/api/etf/:code · /api/etf/list · /api/etf/:code/kline · /api/etf/:code/decisions</div>
    </div>

    <div class="section">
      <div class="section-head">
        <div>
          <div class="section-title">约定区块</div>
          <div class="section-sub">以下区块按 SPEC §4.1 前台 B · §4.2 落实，实现后删除本占位块</div>
        </div>
      </div>
      <ul class="block-list">
        <li>基础信息</li>
        <li>当前动作</li>
        <li>当前/目标仓位</li>
        <li>决策解释（为什么）</li>
        <li>市场环境</li>
        <li>W/D/H/V/F</li>
        <li>K线/量价</li>
        <li>加仓雷达</li>
        <li>防守雷达</li>
        <li>Gen-1 timing</li>
        <li>基本面摘要</li>
        <li>相关情报</li>
        <li>历史决策变化</li>
      </ul>
    </div>
  </section>
</template>
