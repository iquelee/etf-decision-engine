'use strict';
/**
 * OLD(V3.6.1 生产)语义垫片 —— **不是** R1 的新实现。
 *
 * 存在原因：重放 harness（`scripts/lib/v364-replay-harness.js`，V3.6.4 期编写）
 * `require('./swing-structure.js')`，而 **V3.6.1 生产树里没有这个文件**。
 *
 * 本垫片刻意**委托给该树自己的旧实现** `trend-stage.js::swingHighLow`，
 * 后者只返回 `{ higherLow, lowerHigh }`（**没有 `lowerLow` 属性**）
 * ⇒ 任何 `swing.lowerLow` 读取得到 `undefined` ⇒ 与历史生产语义**逐位一致**。
 *
 * ⛔ 本文件**不得**用于 NEW 树；NEW 树用的是真正的 `src/common/utils/swing-structure.js`。
 */
const { swingHighLow } = require('./trend-stage.js');

module.exports = { swingHighLow };
