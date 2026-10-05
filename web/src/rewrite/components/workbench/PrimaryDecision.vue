<script setup>
/**
 * 正式决策区（web/src/rewrite/components/workbench/PrimaryDecision.vue）
 * 规范依据：SPEC §3.1 ＋ M4-P0 §B 硬约束 1/2/3
 *
 * ★★ 本区是**全页最高权威层**：`V3 Safety Core → Formal Decision / Authority`。
 *   · 归属标注必须可见（不是装饰）；
 *   · Gen-1 的任何数值 ⛔ 不得在本区出现或与之并列（视觉层级 Safety Core > Gen-1 Legacy Advisory）。
 *
 * ★ 三条禁止（用户 M4-P1 指令）：
 *   ① ⛔ 不重算 `position_gap` / `final target`（只展示 `decision` 块服务端值）；
 *   ② ⛔ 不跨 endpoint 偷补；
 *   ③ ⛔ 不把 legacy 值标成 canonical。
 *
 * ★ M5-P1（Single-Source）：本区**只保留它真正拥有的三件事** ——
 *   `action` / `final_target` / `risk_flag`（正式风险权威）+ 决策链与评分。
 *   · `position_gap` 的**主位在「仓位与风险」** ⇒ 此处只作**引用位**（带标记，⛔ 不重算）；
 *   · `target_band` 的主位在「仓位与风险」⇒ hero 里的区间文字为引用位；
 *   · 「建议仓位 / 建议核心·交易 / 仓位上限 / 加仓冷静期 / 超配状态 / 机会等级 /
 *      下一加仓条件 / 溢价」**已从本区移除** —— 它们各自有主位，此区不再复述。
 *
 * ★ M5-P8（2026-10-01）两处修正：
 *   ① ⛔ 不再向 `ActionBadge` 绑定 `code`：`decision.action` 是 **Field 对象**，
 *      而 `ActionBadge` 并未声明 `code` prop ⇒ 它会落入 `$attrs` 并作为 DOM 属性被
 *      **字符串化**输出（把对象泄漏进 HTML）。组件只需要 `text` / `tone`。
 *   ② hero 的 `large` 徽标此前**静默失效**（`ToneBadge` 未声明 `large`）⇒ 已补齐 prop 与样式。
 *
 * ⚠️ **模板注释纪律（FE-DEF-005 教训）**：Vue 的 dev/SSR 编译会**保留模板 HTML 注释**，
 *   其文字会进 HTML ⇒ 注释里 ⛔ 不得出现后端字段名，也 ⛔ 不得出现像「对象字符串化」
 *   这类**会被守卫命中的字面量**（否则注释本身就触发守卫）。
 */
import SectionHeader from '../SectionHeader.vue';
import ToneBadge from '../domain/ToneBadge.vue';
import ActionBadge from '../domain/ActionBadge.vue';
import Fact from '../domain/Fact.vue';
import { FACT, OWNER } from '../../domain/ownership.js';

defineProps({
  /** adapter 的 `vm.decision` */
  decision: { type: Object, required: true },
  /** adapter 的 `vm.risk`（风险在 VM 顶层，与 decision 分开建轴） */
  risk: { type: Object, required: true },
  /** adapter 的 `vm.boundaries`（文案来源，⛔ 组件不硬编码） */
  boundaries: { type: Object, required: true }
});
</script>

<template>
  <section class="section primary-decision">
    <SectionHeader
      eyebrow="正式决策"
      title="当前建议与目标"
      :subtitle="boundaries.safetyCoreIdentity"
    >
      <template #actions>
        <ToneBadge text="最终权威" tone="accent" small />
      </template>
    </SectionHeader>

    <!-- 决策不可用：整块显式缺失（⛔ 不显示 0 / —） -->
    <div v-if="!decision.available" class="banner mb-3">
      <div class="banner-text">
        正式决策<b>数据未提供</b>（decision 块缺失）。本页不会用历史值或其它接口推算本次决策。
      </div>
    </div>

    <!--
      ★ M5-P3（2026-10-01）：主位标记必须在**始终渲染**的路径上。
        否则当 decision 不可用时，「正式决策」区的 `finalTarget` / `riskFlag` 主位会被整体跳过，
        而「仓位与风险」区的同事实**引用位仍然渲染** ⇒ 形成**悬空引用**
        （更严规则：`ref > 0` 而 `owner !== 1` 即缺陷，见 single-source.test）。
        与 FE-DEF-006 的处置方式一致：把主位锚点放进不可用分支。
        ⚠️ 值取自 VM（此刻实测为「数据未提供」），⛔ 不硬编码、⛔ 不推算。
    -->
    <div v-if="!decision.available" class="kv-grid mb-3">
      <div class="kv">
        <span class="kv-k">动作</span>
        <span class="kv-v"><Fact :fact="FACT.ACTION">{{ decision.actionText }}</Fact></span>
      </div>
      <div class="kv">
        <span class="kv-k">最终目标</span>
        <span class="kv-v"><Fact :fact="FACT.FINAL_TARGET">{{ decision.finalTargetText.text }}</Fact></span>
      </div>
      <div class="kv">
        <span class="kv-k">风险</span>
        <span class="kv-v"><Fact :fact="FACT.RISK_FLAG">{{ risk.flagText }}</Fact></span>
      </div>
    </div>

    <template v-else>
      <!-- ★ 主行：动作 + 最终目标（**主位**）· 缺口（**引用位**）· 风险旗标（主位） -->
      <div class="pd-hero">
        <div class="pd-hero-main">
          <div class="pd-hero-label">动作</div>
          <div class="pd-hero-value">
            <Fact :fact="FACT.ACTION">
              <!-- ★ M5-P8：此处⛔不得绑定 `code` —— 它是 adapter 的 Field 对象，
                 而非 ActionBadge 声明的 prop；未声明的对象属性会被字符串化并落进 DOM
                 （详见本文件 script 段的说明）。组件只需要 text / tone。 -->
            <ActionBadge :text="decision.actionText" :tone="decision.actionTone" large />
            </Fact>
          </div>
          <div class="pd-hero-note">{{ decision.dateText.text }} 决策</div>
        </div>

        <div class="pd-hero-cell">
          <div class="pd-hero-label">最终目标</div>
          <div class="pd-hero-num" :class="{ 'is-missing': decision.finalTargetText.missing }">
            <Fact :fact="FACT.FINAL_TARGET">{{ decision.finalTargetText.text }}</Fact>
          </div>
          <div class="pd-hero-note">
            目标带 {{ decision.targetBand.rangeText }}
            <Fact :fact="FACT.TARGET_BAND" role="ref" :ref-to="OWNER.POSITION_RISK" />
          </div>
        </div>

        <div class="pd-hero-cell">
          <div class="pd-hero-label">仓位缺口</div>
          <div class="pd-hero-num" :class="{ 'is-missing': decision.gapText.missing }">
            <Fact :fact="FACT.POSITION_GAP" role="ref" :ref-to="OWNER.POSITION_RISK">{{ decision.gapText.text }}</Fact>
          </div>
          <div class="pd-hero-note">{{ decision.gapNote }}</div>
        </div>

        <div class="pd-hero-cell">
          <div class="pd-hero-label">风险</div>
          <div class="pd-hero-value">
            <Fact :fact="FACT.RISK_FLAG">
              <ToneBadge :text="risk.flagText" :tone="risk.tone" dot />
            </Fact>
          </div>
        </div>
      </div>

      <!-- ★ 本区**不复述**其它主位的事实（M5-P1 单源展示） -->
      <p class="state-sub mt-3">{{ boundaries.primaryDecisionScopeNote }}</p>

      <hr class="divider" />

      <!-- 五维评分（点数，⛔ 不显总分）★ 主位（仅本区持有） -->
      <Fact :fact="FACT.SCORES">
        <div class="section-title mb-2">评分维度（点数，⛔ 不加 %、⛔ 不显总分）</div>
        <div class="kv-grid">
          <div class="kv"><span class="kv-k">趋势</span><span class="kv-v">{{ decision.scoresView.trend.text }}</span></div>
          <div class="kv"><span class="kv-k">量能</span><span class="kv-v">{{ decision.scoresView.volume.text }}</span></div>
          <div class="kv"><span class="kv-k">基本面</span><span class="kv-v">{{ decision.scoresView.fundamental.text }}</span></div>
          <div class="kv"><span class="kv-k">拥挤度</span><span class="kv-v">{{ decision.scoresView.crowding.text }}</span></div>
          <div class="kv"><span class="kv-k">风险</span><span class="kv-v">{{ decision.scoresView.risk.text }}</span></div>
          <div class="kv">
            <span class="kv-k">阶段 / 市场系数</span>
            <span class="kv-v">
              {{ decision.factorsView.stage.text }} / {{ decision.factorsView.market.text }}
              <span class="text-11" style="color:var(--c-text-3)">（系数 0~1，⛔ 不是百分比）</span>
            </span>
          </div>
        </div>
      </Fact>

      <hr class="divider" />

      <!-- ★ 决策链：定性（M4-D3）★ 主位（仅本区持有，⛔ 其它区块不复述链上条件） -->
      <Fact :fact="FACT.CHAIN">
        <div class="section-head" style="margin-bottom:8px">
          <div>
            <div class="section-title">{{ boundaries.chainTitle }}</div>
            <div class="section-sub">{{ boundaries.chainNote }}</div>
          </div>
          <ToneBadge
            :text="decision.chain.available ? (decision.chain.total + ' 步') : '数据未提供'"
            tone="outline"
            small
          />
        </div>

        <div v-if="!decision.chain.available" class="banner mb-2">
          <div class="banner-text">决策链<b>数据未提供</b>。</div>
        </div>
        <div v-else>
          <ol class="chain chain-qual">
            <li v-for="s in decision.chain.steps" :key="s.step" class="chain-step">
              <span class="chain-qual-cond">{{ s.conditionDisplay || '（条件未提供）' }}</span>
              <span v-if="s.resultDisplay" class="chain-qual-res">{{ s.resultDisplay }}</span>
              <span v-else-if="s.resultHiddenText" class="chain-qual-hidden">{{ s.resultHiddenText }}</span>
            </li>
          </ol>
          <p v-if="decision.chainHiddenSummary" class="state-sub mt-2">{{ decision.chainHiddenSummary }}</p>
        </div>
      </Fact>
    </template>
  </section>
</template>
