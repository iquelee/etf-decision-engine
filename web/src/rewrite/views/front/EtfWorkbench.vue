<script setup>
/**
 * 标的 · ETF 工作台（web/src/rewrite/views/front/EtfWorkbench.vue）
 *
 * SPEC        §4.2 前台 B · ETF 工作台（前台最重要的页面）
 * 里程碑      M4-P1 第一阶段
 *             （ViewModel + Desktop IA + Mobile IA + Primary Decision
 *              + Gen-1 Legacy Advisory + K-line stale handling）
 * 业务职责    围绕**单只 ETF** 回答：现在是什么动作 / 目标与缺口是多少 / 实际仓位在哪 /
 *             风险如何 / Gen-1 时机建议是什么（且它**只是建议**）/ 证据与数据质量如何
 * 数据来源    GET /api/etf/:code · GET /api/etf/:code/kline · GET /api/constants
 *             （全部经 compose/useEtfDetail，⛔ 本文件不触 api / adapters）
 *
 * ⛔ 实现约束（SPEC §2.2）：
 *    本文件 ⛔ 不得 import api/ 或 adapters/；⛔ 模板中不得出现后端原始字段名；
 *    ⛔ 不得自行格式化数字或拼装业务文案；⛔ 不得在此重算任何服务端已算好的值。
 * ⛔ 本阶段**不**调用 `/api/etf/list` 与 `/api/etf/:code/decisions`
 *    （前者是禁止 2「跨 endpoint 偷补」的入口；后者属 M7 历史复盘范围）。
 * ⛔ 样式：走全局原子类与 components.css，⛔ 不在此重复声明。
 */
import { watch } from 'vue';
import { useRoute } from 'vue-router';
import { useEtfDetail } from '../../compose/useEtfDetail.js';
import DetailView from '../../components/workbench/DetailView.vue';
import PageStateBlock from '../../components/common/PageStateBlock.vue';

const route = useRoute();
const code = () => String(route.params.code || '');
const { state, refresh } = useEtfDetail(code);

// ⚠️ SSR/测试环境下不自动取数（无 window），由调用方显式 refresh
if (typeof window !== 'undefined') {
  refresh();
  // 切换标的必须重新取数（否则会把上一只的数据留在屏上）
  watch(() => route.params.code, () => refresh());
}
</script>

<template>
  <PageStateBlock
    v-if="state.phase !== 'ready' && state.phase !== 'ready-degraded'"
    :phase="state.phase"
    :error="state.error"
    :empty-text="state.emptyText"
    loading-text="正在读取 /api/etf/:code、K 线与常量"
    @retry="refresh"
  />
  <DetailView v-else :vm="state.vm" />
</template>
