<script setup>
/**
 * 工作台页头（web/src/rewrite/components/workbench/WorkbenchHeader.vue）
 * 规范依据：用户 M4-P1 指令（Header = ETF Identity + price + trade date + decision date + freshness）
 *          ＋ owner 裁定 M5-P1（D-M5-3 组合环境只读引用 · Single-Source）
 *
 * ★ 涨跌颜色跟随**中国股市惯例：涨=红、跌=绿**（`--mkt-up` / `--mkt-down`）。
 *   ⛔ 与风险色域、动作 tone 物理隔离。
 * ★ 只展示 adapter 已归一的数据，⛔ 组件内不做任何单位判断。
 *
 * ★ M5-P1 变更：
 *   · **移除**「配置上限 / 配置标准」—— 它们的主位在「仓位与风险」，页头重复会与
 *     「仓位上限」产生第二套解读；
 *   · **新增**「组合环境」—— 只读引用 `/api/dashboard#overview.market_regime`
 *     （契约已证实，见 `adapters/marketRegime.js`）；取不到 ⇒ NOT_PROVIDED；
 *   · 「K 线止于」标注为 **引用位**（主位在「K 线」区，⛔ 页头不渲染第二张图）。
 */
import ToneBadge from '../domain/ToneBadge.vue';
/* ★ M5-P10（2026-10-01）：删除 dead import `FieldValue`
   （模板与本组件脚本内零引用 —— 用未使用导入扫描器逐项核实） */
import Fact from '../domain/Fact.vue';
import { FACT, OWNER } from '../../domain/ownership.js';

const props = defineProps({
  identity: { type: Object, required: true },
  price: { type: Object, required: true },
  decision: { type: Object, required: true },
  freshness: { type: Object, required: true },
  kline: { type: Object, required: true },
  /** adapter 的 `vm.marketRegime`（M5-P1 只读引用） */
  marketRegime: { type: Object, required: true }
});

/** 涨跌 tone（红涨绿跌）—— 仅用于样式类名，⛔ 不含业务判断 */
function dirTone(f) {
  if (!f || f.missing) return 'muted';
  const n = Number(f.field && f.field.value);
  if (Number.isNaN(n)) return 'muted';
  if (n > 0) return 'up';
  if (n < 0) return 'down';
  return 'flat';
}
</script>

<template>
  <header class="wb-head">
    <div class="wb-head-left">
      <div class="wb-code">
        {{ identity.codeText }}
        <span v-if="identity.isQdii && identity.isQdii.value" class="badge outline sm">QDII</span>
      </div>
      <h1 class="wb-name">{{ identity.nameText }}</h1>
      <div class="wb-meta">
        <span>{{ identity.sectorText }}</span>
        <span class="wb-dot">·</span>
        <!-- ★ M5-P1：组合环境（唯一主位；只读引用 /api/dashboard，无契约 ⇒ NOT_PROVIDED） -->
        <span class="wb-regime">
          <Fact :fact="FACT.MARKET_REGIME">
            {{ marketRegime.title }}
            <ToneBadge :text="marketRegime.regimeText" :tone="marketRegime.regimeTone" small />
          </Fact>
        </span>
      </div>
    </div>

    <div class="wb-head-right">
      <div class="wb-price" :class="'dir-' + dirTone(price.change5dText)">
        <div class="wb-price-num">{{ price.change5dText.text }}</div>
        <div class="wb-price-label">近 5 日</div>
      </div>
      <div class="wb-dates">
        <div class="wb-date-row">
          <span class="wb-date-k">快照日</span>
          <span class="wb-date-v">{{ identity.asOfText.text }}</span>
          <ToneBadge :text="freshness.snapshot.text" :tone="freshness.snapshot.level === 'FRESH' ? 'good' : 'risk'" small />
        </div>
        <div class="wb-date-row">
          <span class="wb-date-k">决策日</span>
          <span class="wb-date-v">{{ decision.dateText.text }}</span>
          <ToneBadge :text="freshness.decision.text" :tone="freshness.decision.level === 'FRESH' ? 'good' : 'risk'" small />
        </div>
        <div class="wb-date-row">
          <span class="wb-date-k">K 线止于</span>
          <span class="wb-date-v">
            <Fact :fact="FACT.KLINE_LAST_DATE" role="ref" :ref-to="OWNER.KLINE">{{ kline.lastBarDateText }}</Fact>
          </span>
          <ToneBadge
            :text="kline.freshness.text"
            :tone="kline.isSeverelyStale ? 'risk' : (kline.freshness.level === 'FRESH' ? 'good' : 'muted')"
            small
          />
        </div>
      </div>
    </div>
  </header>
</template>
