<script setup>
/**
 * 轻量 SVG K 线（web/src/rewrite/components/workbench/MiniKline.vue）
 * 规范依据：SPEC §12.3（反装饰）+ owner 裁定 M4-D2
 *
 * ★ 零依赖、纯函数式渲染（⛔ 不引 ECharts —— 体积问题属 M5「看盘」范围）。
 * ★ 颜色跟随**中国股市惯例：涨=红（--mkt-up）、跌=绿（--mkt-down）**。
 *   ⛔ 与风险色域（--risk-*）、动作 tone（--tone-*）物理隔离，不得混用。
 * ★ **陈旧数据照常绘制**（owner 裁定 D2：⛔ 不隐藏、⛔ 不插值、⛔ 不猜最新价）；
 *   时点由外层 `KlineSection` 显式标注。
 * ★ 本组件**不做任何业务判断**：不判新鲜度、不裁数据、不补缺口。
 */
import { computed } from 'vue';

const props = defineProps({
  /** `[{date, open, close, low, high, volume}]`（已由 adapter 排序） */
  bars: { type: Array, default: () => [] },
  /** 绘制高度（CSS 像素；宽度自适应容器，内部用 viewBox 缩放） */
  height: { type: Number, default: 200 }
});

/** 逻辑坐标系宽度（固定，靠 viewBox 缩放 ⇒ 任意容器宽度都清晰） */
const VW = 1000;
const PAD = Object.freeze({ top: 10, bottom: 18, left: 4, right: 52 });
/** 右侧价格轴刻度数 */
const TICKS = 4;

const geom = computed(() => {
  const bars = (props.bars || []).filter((b) => b && b.close != null);
  if (!bars.length) return null;

  let lo = Infinity;
  let hi = -Infinity;
  for (const b of bars) {
    const l = b.low != null ? b.low : b.close;
    const h = b.high != null ? b.high : b.close;
    if (l < lo) lo = l;
    if (h > hi) hi = h;
  }
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return null;
  if (hi === lo) { hi = lo + Math.max(Math.abs(lo) * 0.01, 0.001); }

  const vh = props.height;
  const plotH = vh - PAD.top - PAD.bottom;
  const plotW = VW - PAD.left - PAD.right;
  const y = (v) => PAD.top + ((hi - v) / (hi - lo)) * plotH;

  const slot = plotW / bars.length;
  const cw = Math.max(1, Math.min(slot * 0.62, 14));

  const ticks = [];
  for (let i = 0; i <= TICKS; i++) {
    const v = lo + ((hi - lo) * i) / TICKS;
    ticks.push({ v, y: y(v), text: v.toFixed(3) });
  }

  return {
    vh,
    plotW,
    x: (i) => PAD.left + slot * i + slot / 2,
    y,
    slot,
    cw,
    ticks,
    lo,
    hi,
    first: bars[0],
    last: bars[bars.length - 1],
    candles: bars.map((b, i) => {
      const o = b.open != null ? b.open : b.close;
      const c = b.close;
      const h = b.high != null ? b.high : Math.max(o, c);
      const l = b.low != null ? b.low : Math.min(o, c);
      return {
        i,
        date: b.date,
        up: c >= o,
        cx: PAD.left + slot * i + slot / 2,
        wickTop: y(h),
        wickBottom: y(l),
        bodyTop: y(Math.max(o, c)),
        bodyBottom: y(Math.min(o, c))
      };
    })
  };
});

const hasData = computed(() => !!geom.value);
</script>

<template>
  <div class="mkline" :style="{ height: height + 'px' }">
    <svg
      v-if="hasData"
      class="mkline-svg"
      :viewBox="`0 0 ${VW} ${geom.vh}`"
      preserveAspectRatio="none"
      role="img"
      aria-label="K 线图"
    >
      <!-- 价格轴刻度（次要信息，弱化） -->
      <g class="mkline-axis">
        <line
          v-for="(t, i) in geom.ticks"
          :key="'t' + i"
          :x1="PAD.left" :x2="VW - PAD.right"
          :y1="t.y" :y2="t.y"
          stroke="var(--c-border)"
          stroke-width="1"
          vector-effect="non-scaling-stroke"
        />
        <text
          v-for="(t, i) in geom.ticks"
          :key="'l' + i"
          :x="VW - PAD.right + 6"
          :y="t.y + 3.5"
          class="mkline-tick"
        >{{ t.text }}</text>
      </g>

      <!-- 蜡烛：涨红跌绿（中国惯例） -->
      <g>
        <g
          v-for="c in geom.candles"
          :key="c.date"
          :class="c.up ? 'mkline-up' : 'mkline-down'"
          :data-date="c.date"
        >
          <line
            :x1="c.cx" :x2="c.cx" :y1="c.wickTop" :y2="c.wickBottom"
            class="mkline-wick"
            vector-effect="non-scaling-stroke"
          />
          <rect
            :x="c.cx - geom.cw / 2"
            :y="c.bodyTop"
            :width="geom.cw"
            :height="Math.max(1, c.bodyBottom - c.bodyTop)"
            class="mkline-body"
          />
        </g>
      </g>

      <!-- 末端竖线：强调「这就是数据的实际末端」 -->
      <line
        :x1="geom.candles[geom.candles.length - 1].cx"
        :x2="geom.candles[geom.candles.length - 1].cx"
        :y1="PAD.top"
        :y2="geom.vh - PAD.bottom"
        class="mkline-lastline"
        vector-effect="non-scaling-stroke"
      />
    </svg>

    <div v-else class="mkline-empty">无行情数据</div>

    <div v-if="hasData" class="mkline-foot">
      <span>起 {{ geom.first.date }}</span>
      <span class="mkline-foot-mid">共 {{ geom.candles.length }} 根</span>
      <span>止 <b>{{ geom.last.date }}</b></span>
    </div>
  </div>
</template>
