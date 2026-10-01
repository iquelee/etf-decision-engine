<script setup>
/**
 * 事实主位 / 引用位包裹器（web/src/rewrite/components/domain/Fact.vue）
 * 规范依据：owner 裁定 M5-P1（Single-Source Display Governance）＋ domain/ownership.js
 *
 * ★ 唯一职责：给一个**后端事实**的渲染打上机器可判定的标记：
 *     data-fact   = 事实 ID（如 `risk_flag`）
 *     data-role   = `owner`（主位）| `ref`（引用位）
 *     data-ref-to = 引用位指向的主位区块（`owner` 角色时不渲染该属性）
 *   ⇒ 测试据此断言「每个事实 canonical owner count = 1」。
 *
 * ★ 引用位必须**可见地**标明「引用 · 见「X」」，文案来自 `domain/ownership.js`
 *   （⛔ 组件不得自行拼写区块名，避免出现第二套叫法）。
 *
 * ⛔ 本组件不含任何业务规则、不做格式化、不判断数值语义；只包一层。
 */
import { refText } from '../../domain/ownership.js';

defineProps({
  /** 事实 ID（`domain/ownership.js` 的 `FACT.*`） */
  fact: { type: String, required: true },
  /** `owner` = 主位；`ref` = 引用位 */
  role: { type: String, default: 'owner' },
  /** 引用位指向的主位区块（`OWNER.*`）；仅 `role === 'ref'` 时生效 */
  refTo: { type: String, default: '' }
});
</script>

<template>
  <span
    class="fact"
    :data-fact="fact"
    :data-role="role"
    :data-ref-to="role === 'ref' ? (refTo || '') : undefined"
  >
    <slot />
    <span v-if="role === 'ref'" class="fact-ref">· 引用 · {{ refTo ? refText(refTo) : '见主位' }}</span>
  </span>
</template>
