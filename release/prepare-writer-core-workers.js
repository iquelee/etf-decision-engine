#!/usr/bin/env node
'use strict';
// Current entry: only daily/realtime/news/extract from the historical capture.
// Gen1/Gen2 are not packaged; all candidate artifacts remain offline-only.
const assert = require('assert');
const {buildCore} = require('./prepare-writer-six-workers');
if (require.main === module) {
  const args = process.argv.slice(2);
  assert(args.length === 6 && args[0] === '--source' && args[2] === '--inventory-root' && args[4] === '--out');
  console.log(JSON.stringify(buildCore({source: args[1], inventoryRoot: args[3], out: args[5]}), null, 2));
}
module.exports = {buildCore};
