/**
 * Dashboard 取数钩子（web/src/rewrite/compose/useDashboard.js）
 * 规范依据：SPEC §2.2 / §9 / §8.3
 *
 * ★ 本层是**唯一**允许 import `api` + `adapters` 的业务层（另一处是 app 级装配）。
 *   视图只拿到 **ViewModel**，⛔ 不接触 raw response。
 *
 * ★ 页面状态机（SPEC §9）四态：
 *   loading → ready | ready-degraded | empty | error
 *   `ready-degraded`：能展示，但**契约未部署或走了非契约通道** —— 必须显式告知（⛔ 不静默降级）。
 *
 * ⚠️ 并发语义：后发的请求胜出（过期响应丢弃），避免快速连点刷新导致旧数据覆盖新数据。
 */
import { ref, computed } from 'vue';
import { api, API_ERROR_KIND } from '../api.js';
import { adaptDashboard } from '../adapters/dashboard.js';

export const PAGE_PHASE = Object.freeze({
  LOADING: 'loading',
  READY: 'ready',
  READY_DEGRADED: 'ready-degraded',
  EMPTY: 'empty',
  ERROR: 'error'
});

const PROVIDED_STATES = ['PROVIDED', 'STALE'];

/**
 * 取数 + 适配（可注入 loader 以便测试；⛔ 生产路径默认只用真实 api）。
 * @param {{dashboard:Function, constants:Function}} loader
 * @returns {Promise<object>} Dashboard ViewModel
 */
export async function loadDashboard(loader = api) {
  const retrievedAt = new Date().toISOString();
  // `constants` 只提供 runtime_status（生命周期 / 边界字段），失败 ⛔ 不应阻断主视图
  const [dashRes, constRes] = await Promise.allSettled([loader.dashboard(), loader.constants()]);
  if (dashRes.status === 'rejected') throw dashRes.reason;
  const rs = constRes.status === 'fulfilled' && constRes.value && typeof constRes.value === 'object'
    ? constRes.value.runtime_status
    : null;
  return adaptDashboard(dashRes.value, rs || null, { retrievedAt });
}

/**
 * 由 ViewModel 判定页面状态。
 * ★ 判定只依赖「有没有可用数据」，⛔ 不依赖任何业务状态值。
 */
export function phaseOf(vm) {
  if (!vm || vm.available !== true) return PAGE_PHASE.EMPTY;
  const regimeOk = !!(vm.market && vm.market.regime && PROVIDED_STATES.includes(vm.market.regime.state));
  const cardsOk = !!(vm.cards && vm.cards.state === 'PROVIDED' && vm.cards.value.length > 0);
  if (!regimeOk && !cardsOk) return PAGE_PHASE.EMPTY;
  return vm.provenance && vm.provenance.gen1Channel === 'CANONICAL'
    ? PAGE_PHASE.READY
    : PAGE_PHASE.READY_DEGRADED;
}

/** 错误归一为**用户可读**文案（⛔ 不回显堆栈 / 原始响应） */
export function describeError(e) {
  const kind = e && e.kind;
  if (kind === API_ERROR_KIND.NETWORK) return '网络不可达，请检查网络后重试。';
  if (kind === API_ERROR_KIND.TIMEOUT) return '请求超时，后端可能繁忙，请稍后重试。';
  if (kind === API_ERROR_KIND.UNAUTHORIZED) return '未登录或登录已过期。';
  if (kind === API_ERROR_KIND.PARSE) return '后端返回的不是合法 JSON。';
  if (kind === API_ERROR_KIND.HTTP) return '后端返回错误（HTTP ' + (e.httpStatus || '?') + '）。';
  if (kind === API_ERROR_KIND.ENVELOPE) return '后端返回业务错误：' + (e.message || '未知');
  return '读取失败：' + ((e && e.message) || '未知错误');
}

const EMPTY_TEXT = '后端未返回可用的市场环境与标的列表（可能非交易日，或接口尚未就绪）。';

/**
 * 页面状态容器。
 * @param {object} loader 测试可注入；生产不传
 */
export function useDashboard(loader = api) {
  const phase = ref(PAGE_PHASE.LOADING);
  const vm = ref(null);
  const error = ref('');
  const emptyText = ref(EMPTY_TEXT);
  const refreshing = ref(false);
  let seq = 0;

  async function refresh() {
    const mine = ++seq;
    refreshing.value = true;
    // 首次加载保持 loading 骨架；已有数据时刷新不闪空屏
    if (phase.value === PAGE_PHASE.LOADING) phase.value = PAGE_PHASE.LOADING;
    error.value = '';
    try {
      const next = await loadDashboard(loader);
      if (mine !== seq) return;
      vm.value = next;
      phase.value = phaseOf(next);
    } catch (e) {
      if (mine !== seq) return;
      error.value = describeError(e);
      phase.value = PAGE_PHASE.ERROR;
    } finally {
      if (mine === seq) refreshing.value = false;
    }
  }

  /** 传给视图的不可变快照 */
  const state = computed(() => Object.freeze({
    phase: phase.value,
    vm: vm.value,
    error: error.value,
    emptyText: emptyText.value,
    refreshing: refreshing.value,
    refresh
  }));

  return { state, refresh, phase, vm, error, emptyText };
}
