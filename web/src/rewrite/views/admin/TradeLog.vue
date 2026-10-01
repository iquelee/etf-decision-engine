<script setup>
/**
 * 操作记录与账户快照 —— 后台路由目标视图
 *
 * SPEC          §5 执行
 * 里程碑        M8（本文件为 M1 建立的**可达骨架**；业务内容在 M8 实现）
 * 业务职责      账户快照录入（总资产/浮盈）+ 操作记录 CRUD + 筛选 + 自动算仓结果提示
 * 数据来源      /api/admin/trade · /api/admin/portfolio/snapshot
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
      <h2>操作记录与账户快照</h2>
      <p class="page-sub">账户快照录入（总资产/浮盈）+ 操作记录 CRUD + 筛选 + 自动算仓结果提示</p>
    </header>

    <div class="pending">
      <div class="pending-title">待实现（M8）</div>
      <div class="pending-sub">数据来源：/api/admin/trade · /api/admin/portfolio/snapshot</div>
    </div>

    <div class="section">
      <div class="section-head">
        <div>
          <div class="section-title">约定区块</div>
          <div class="section-sub">以下区块按 SPEC §5 执行 落实，实现后删除本占位块</div>
        </div>
      </div>
      <ul class="block-list">
        <li>账户快照</li>
        <li>操作记录</li>
        <li>筛选</li>
        <li>新增/编辑/删除</li>
      </ul>
    </div>
  </section>
</template>
