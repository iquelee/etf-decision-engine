<script setup>
/**
 * Gen-1 运行状态 —— 后台路由目标视图
 *
 * SPEC          §5 系统运行
 * 里程碑        M8（本文件为 M1 建立的**可达骨架**；业务内容在 M8 实现）
 * 业务职责      Gen-1 模型健康 6 项 + 最新 EOD 信号表（仅供模型运行核验，不是人工交易建议）
 * 数据来源      GET /api/admin/gen1/health
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
      <h2>Gen-1 运行状态</h2>
      <p class="page-sub">Gen-1 模型健康 6 项 + 最新 EOD 信号表（仅供模型运行核验，不是人工交易建议）</p>
    </header>

    <div class="pending">
      <div class="pending-title">待实现（M8）</div>
      <div class="pending-sub">数据来源：GET /api/admin/gen1/health</div>
    </div>

    <div class="section">
      <div class="section-head">
        <div>
          <div class="section-title">约定区块</div>
          <div class="section-sub">以下区块按 SPEC §5 系统运行 落实，实现后删除本占位块</div>
        </div>
      </div>
      <ul class="block-list">
        <li>模型 / 冻结工件 / 主建议 / 快速通道 / 自动交易 / 核验日期</li>
        <li>最新 EOD 信号表</li>
      </ul>
    </div>
  </section>
</template>
