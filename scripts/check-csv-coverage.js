/**
 * 五票 CSV 覆盖检查：各票起止、五票交集、建议 eval 起点（+60 日预热）。
 * 运行：node scripts/check-csv-coverage.js [csvDir]
 */
'use strict';

const path = require('path');
const { getCsvCoverage, DEFAULT_CSV_DIR } = require('./lib/csv-coverage.js');

const csvDir = process.argv[2]
  ? path.resolve(process.argv[2])
  : DEFAULT_CSV_DIR;

const cov = getCsvCoverage(csvDir);

console.log('════════ CSV 覆盖检查 ════════');
console.log(`目录: ${cov.csvDir}\n`);
for (const p of cov.per) {
  console.log(`  ${p.code} ${p.name}: ${p.rows} 根  ${p.start} ~ ${p.end}`);
}
console.log('\n五票交集:');
console.log(`  ${cov.intersection.start} ~ ${cov.intersection.end}  (${cov.intersection.days} 交易日)`);
console.log(`  预热后 eval 建议 --from=${cov.intersection.evalStartAfterWarmup}`);
