<script setup>
/**
 * 情报 —— 前台路由目标视图
 *
 * SPEC          §4.1 前台 C · §4.2 · §8
 * 里程碑        M6（本文件为 M1 建立的**可达骨架**；业务内容在 M6 实现）
 * 业务职责      当前结论 / 硬数据 / 景气财报 / 事件 / AI 研究证据 / 来源与时间 / 数据完整性
 * 数据来源      /api/fundamentals · /api/intel?limit=
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
      <h2>情报</h2>
      <p class="page-sub">当前结论 / 硬数据 / 景气财报 / 事件 / AI 研究证据 / 来源与时间 / 数据完整性</p>
    </header>

    <div class="pending">
      <div class="pending-title">待实现（M6）</div>
      <div class="pending-sub">数据来源：/api/fundamentals · /api/intel?limit=</div>
    </div>

    <div class="section">
      <div class="section-head">
        <div>
          <div class="section-title">约定区块</div>
          <div class="section-sub">以下区块按 SPEC §4.1 前台 C · §4.2 · §8 落实，实现后删除本占位块</div>
        </div>
      </div>
      <ul class="block-list">
        <li>当前结论</li>
        <li>硬数据</li>
        <li>景气 / 财报</li>
        <li>事件</li>
        <li>AI 研究证据</li>
        <li>来源和时间</li>
        <li>数据完整性</li>
        <li>5 分钟轮询 + 可见性暂停（手动刷新在后台，SPEC §8.2）</li>
      </ul>
    </div>
  </section>
</template>
