/**
 * ETF 工作台取数钩子（web/src/rewrite/compose/useEtfDetail.js）
 * 规范依据：SPEC §2.2 / §9 ＋ owner 裁定 M4-P1
 *
 * ★ 本层是**唯一**允许 import `api` + `adapters` 的业务层（与 `useDashboard` 同级）。
 *   视图只拿到 **ViewModel**，⛔ 不接触 raw response。
 *
 * ★ 三个请求的失败语义**刻意不同**（⛔ 不搞一刀切）：
 *   · `/api/etf/:code`        失败 ⇒ **整页 error**（没有它就没有页面）；
 *   · `/api/constants`        失败 ⇒ **不阻断**（只影响 Gen-1 authority 兜底）；
 *   · `/api/etf/:code/kline`  失败 ⇒ **不阻断**，但 K 线面板必须显式标「读取失败」
 *     （⛔ 不得静默显示成「无行情数据」—— 那是把**错误**说成**空**，SPEC §9 明令禁止）。
 *
 * ★ 并发安全：后发请求胜出（过期响应丢弃）。
 */
import { ref, computed } from 'vue';
import { api } from '../api.js';
import { adaptEtfDetail } from '../adapters/etfDetail.js';
import { describeError as describeErrorBase } from './useDashboard.js';

export { PAGE_PHASE } from './useDashboard.js';

const PROVIDED_STATES = ['PROVIDED', 'STALE'];

/**
 * 取数 + 适配（可注入 loader 以便测试；⛔ 生产路径默认只用真实 api）。
 * @param {string} code ETF 代码
 * @param {{etfDetail:Function, kline:Function, constants:Function}} [loader]
 * @param {{retrievedAt?:string}} [meta]
 * @returns {Promise<object>} ETF Detail ViewModel
 */
export async function loadEtfDetail(code, loader = api, meta = {}) {
  const retrievedAt = meta.retrievedAt || new Date().toISOString();
  /**
   * ⚠️ `dashboard` 可能不存在于注入式 loader（测试用的最小桩）⇒ 缺省视为「未请求」
   *    （UNAVAILABLE / NOT_PROVIDED），⛔ 不得让缺失的方法把整页打成 ERROR。
   */
  const dashboardLoader = typeof loader.dashboard === 'function'
    ? loader.dashboard()
    : Promise.resolve(undefined);

  const [detailRes, constRes, klineRes, decRes, marketRes] = await Promise.allSettled([
    loader.etfDetail(code),
    loader.constants(),
    loader.kline(code, 'daily'),
    loader.decisions(code),
    dashboardLoader
  ]);

  // 主数据失败 ⇒ 整页失败（由页面转 error 态）
  if (detailRes.status === 'rejected') throw detailRes.reason;

  const rs = constRes.status === 'fulfilled' && constRes.value && typeof constRes.value === 'object'
    ? constRes.value.runtime_status
    : null;

  const klineFailed = klineRes.status === 'rejected';
  const klineRaw = klineFailed ? null : klineRes.value;

  /**
   * ★ 历史决策：失败 ⛔ 不阻断整页，但必须让 adapter 拿到 `null`（= 请求失败）
   *   而不是 `undefined`（= 未请求）—— 两者在 UI 上的文案**不同**（用户 M4-P1b §七）。
   */
  const decFailed = decRes.status === 'rejected';
  const decisionsRaw = decFailed ? null : decRes.value;

  /**
   * ★ M5-P1（D-M5-3）：组合环境为**只读引用**，⛔ 不阻断整页；
   *   失败 ⇒ `null`（ERROR），未请求/无方法 ⇒ `undefined`（UNAVAILABLE ⇒ NOT_PROVIDED）。
   */
  const marketFailed = marketRes.status === 'rejected';
  const marketRaw = marketFailed ? null : marketRes.value;

  return adaptEtfDetail(detailRes.value, rs || null, {
    klineRaw,
    klineError: klineFailed ? ((klineRes.reason && klineRes.reason.message) || 'kline request failed') : null,
    decisionsRaw,
    decisionsError: decFailed ? ((decRes.reason && decRes.reason.message) || 'decisions request failed') : null,
    marketRaw,
    marketError: marketFailed ? ((marketRes.reason && marketRes.reason.message) || 'dashboard request failed') : null,
    retrievedAt
  });
}

/**
 * 页面状态机（与 Dashboard 同构）。
 * ★ 判定只看「有没有可用主数据」，⛔ 不依赖任何业务状态值。
 */
export function phaseOf(vm) {
  if (!vm || vm.available !== true) return 'empty';
  const hasIdentity = !!(vm.identity && vm.identity.code &&
    PROVIDED_STATES.includes(vm.identity.code.state));
  const hasDecision = !!(vm.decision && vm.decision.available === true);
  if (!hasIdentity && !hasDecision) return 'empty';
  // 非 canonical Gen-1 通道 ⇒ 降级态（必须显式告知，⛔ 不静默）
  return vm.gen1Detail && vm.gen1Detail.isCanonical ? 'ready' : 'ready-degraded';
}

/** 错误归一为**用户可读**文案（⛔ 不回显堆栈 / 原始响应） */
export function describeError(e) {
  return describeErrorBase(e);
}

const EMPTY_TEXT = '后端未返回可用的标的详情（可能代码不存在，或接口尚未就绪）。';

/**
 * 页面状态容器。
 * @param {() => string} code 当前标的代码（响应式取值函数）
 * @param {object} [loader] 测试可注入；生产不传
 */
export function useEtfDetail(code, loader = api) {
  const phase = ref('loading');
  const vm = ref(null);
  const error = ref('');
  const emptyText = ref(EMPTY_TEXT);
  const refreshing = ref(false);
  let seq = 0;

  async function refresh() {
    const mine = ++seq;
    refreshing.value = true;
    error.value = '';
    try {
      const c = typeof code === 'function' ? code() : code;
      const next = await loadEtfDetail(c, loader);
      if (mine !== seq) return;
      vm.value = next;
      phase.value = phaseOf(next);
    } catch (e) {
      if (mine !== seq) return;
      error.value = describeError(e);
      phase.value = 'error';
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
