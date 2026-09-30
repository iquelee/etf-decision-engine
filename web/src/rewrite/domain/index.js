/**
 * domain 层出口（web/src/rewrite/domain/index.js）
 *
 * ⚠️ 引用约定：
 *   · 视图 / 组件 / compose ⛔ 不得深入 `domain/xxx.js` 子路径，一律从 `domain/index.js` 引入；
 *   · 这样后续拆分层内文件时不需要改调用方。
 */
export * from './enums.js';
export * from './provenance.js';
export * from './freshness.js';
export * from './labels.js';
export * from './thresholds.js';
export * from './format.js';
export * from './lifecycle.js';
