<script setup>
/**
 * 全局 · Dashboard 路由目标视图（web/src/rewrite/views/front/Dashboard.vue）
 *
 * SPEC          §4.1 前台 A · §4.2（首屏信息层级）
 * 里程碑        M3（参考实现；本页为其余页面的结构样板）
 * 业务职责      用最短路径回答：现在系统怎么看市场 / 正式决策与风险是什么 /
 *               Gen-1 时机建议与适用性如何 / 数据是否足够支撑以上结论
 * 数据来源      GET /api/dashboard · GET /api/constants（经 compose/useDashboard）
 *
 * ⛔ 实现约束（SPEC §2.2）：
 *    本文件 ⛔ 不得 import api/ 或 adapters/；取数经 compose/，渲染经 components/；
 *    ⛔ 模板中不得出现后端原始字段名；⛔ 不得自行格式化数字或拼装业务文案。
 * ⛔ 样式：走全局原子类与 components.css，⛔ 不在此重复声明。
 * ⛔ 禁止 linear-gradient / backdrop-filter（SPEC §12.3）。
 */
import { useDashboard } from '../../compose/useDashboard.js';
import DashboardView from '../../components/dashboard/DashboardView.vue';

const { state, refresh } = useDashboard();

// ⚠️ SSR/测试环境下不自动取数（无 window），由调用方显式 refresh
if (typeof window !== 'undefined') refresh();
</script>

<template>
  <DashboardView :state="state" />
</template>
