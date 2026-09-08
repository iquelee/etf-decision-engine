'use strict';
/**
 * Mock @cloudbase/node-sdk，供测试加载 src/common（db.js / intel-refresh.js 依赖它）时使用。
 *
 * 背景：src/common 是 canonical 单一真相源，但它的第三方依赖 @cloudbase/node-sdk
 * 只在部署目录 dist-functions/<fn>/node_modules 里（从 zip 快照恢复），仓库根不装。
 * 测试加载 src/common 时用本 helper 拦截该依赖，返回内存 mock（不连云端）。
 *
 * 用法：在测试文件顶部 require('./helpers/mock-cloudbase')（必须在任何 src/common 加载之前）。
 */
const Module = require('module');
const _origLoad = Module._load;

Module._load = function (request, parent, isMain) {
  if (request === '@cloudbase/node-sdk') {
    return {
      init: () => ({
        database: () => ({ command: {}, collection: () => ({}) }),
        callFunction: async () => ({}),
      }),
      SYMBOL_CURRENT_ENV: 'test-env',
    };
  }
  return _origLoad.call(this, request, parent, isMain);
};

module.exports = {};
