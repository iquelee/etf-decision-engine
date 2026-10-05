/**
 * ⚠️ 已废弃的位置 —— 请改用 `./domain/index.js`（`web/src/rewrite/domain/`）。
 *
 * 本文件是 owner 早期骨架的 `web/src/rewrite/domain.js`。现已收敛为**薄转发层**，理由：
 *   · 旧骨架把标签、格式化、阈值混在一个文件里，正是审计 §4.2 指出的
 *     「同一映射多处拷贝」的病根；
 *   · SPEC §2.3 要求 `domain/` 按职责拆分（enums / labels / thresholds / format / freshness / …）；
 *   · 保留本文件仅避免早期引用硬断，**新代码一律 `import { … } from './domain/index.js'`**。
 *
 * ★ D-7 裁定在本层继续生效：**不存在**任何「按数值大小推断单位」的启发式。
 *
 * @deprecated 使用 `import { … } from './domain/index.js'`
 */
export * from './domain/index.js';

/** 旧名兼容：`rawPct` = 百分数（输入已是百分数，⛔ 不做 ×100 推断） */
export { formatPercent as rawPct } from './domain/format.js';
/** 旧名兼容：`num` = 通用数值 */
export { formatNumber as num } from './domain/format.js';
/** 旧名兼容：`dateText` = 日期时间 */
export { formatDateTime as dateText } from './domain/format.js';
