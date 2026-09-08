#!/usr/bin/env node
/** 跑全部单测：自动发现 tests/*.test.js */
'use strict';
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const dir = path.join(__dirname, '..', 'tests');
const tests = fs.readdirSync(dir).filter((f) => f.endsWith('.test.js')).sort();
let failed = 0;
for (const t of tests) {
  const file = path.join(dir, t);
  console.log(`\n── ${t} ──`);
  try {
    execSync(`node "${file}"`, { stdio: 'inherit' });
  } catch (e) {
    failed += 1;
  }
}
console.log(failed ? `\n${failed} 个测试文件失败` : '\n全部测试通过');
process.exit(failed ? 1 : 0);
