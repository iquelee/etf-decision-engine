'use strict';
const assert = require('assert');
const {readProductionHistory,bounds} = require('../src/common/utils/production-history');
const C = require('../src/common/utils/v365-contracts').V365_COLLECTIONS;
const op = (name) => value => ({op:name,value});
const command = {gte:op('gte'),lte:op('lte'),lt:op('lt'),and:(...value)=>({op:'and',value})};
function matches(actual,test) {
  if (!test || typeof test !== 'object') return actual === test;
  if (test.op === 'and') return test.value.every(t => matches(actual,t));
  return test.op === 'gte' ? actual >= test.value : test.op === 'lte' ? actual <= test.value : actual < test.value;
}
function fixture() {
  const tables = {[C.RUN_HISTORY]:[],[C.RUN_MANIFEST]:[],[C.CANDIDATE_DECISION]:[],[C.CANDIDATE_PORTFOLIO]:[],
    [C.ACTIVE_POINTER]:[],decision_result:[]};
  function seed(date,revision,run='r'+revision) {
    tables[C.RUN_HISTORY].push({scope:'production',promoted:true,status:'COMPLETE',run_id:run,revision,expected_trade_date:date,engine_version:'v3.6.7'});
    tables[C.RUN_MANIFEST].push({run_id:run,revision,status:'COMPLETE',validation_passed:true,expected_trade_date:date,expected_codes:['A','B']});
    tables[C.CANDIDATE_DECISION].push(...['A','B'].map(code=>({code,run_id:run,decision_date:date,final_action:'HOLD'})));
    tables[C.CANDIDATE_PORTFOLIO].push({run_id:run,candidate_key:'portfolio',snapshot_date:date});
    tables[C.ACTIVE_POINTER]=[{scope:'production',run_id:run,revision,expected_trade_date:date}];
  }
  let reads = 0;
  const db = {getCommand:()=>command,query:async(table,where,options={})=>{
    if (table === C.ACTIVE_POINTER) reads++;
    let rows=(tables[table] || []).filter(r=>Object.entries(where).every(([k,v])=>matches(r[k],v)));
    for (const order of [...(options.orderBy||[])].reverse()) rows.sort((a,b)=>String(a[order.field]).localeCompare(String(b[order.field]))*(order.direction==='desc'?-1:1));
    return rows.slice(0,options.limit || rows.length);
  }};
  seed('2026-10-08',2);seed('2026-10-09',3);
  return {tables,db,seed,getReads:()=>reads};
}
let passed=0;
async function test(name,fn) {await fn();passed++;console.log('[PASS]',name);}
(async()=>{
  await test('normal promoted history, single pointer pin, row provenance',async()=>{
    const f=fixture(),r=await readProductionHistory(f.db,{from:'2026-10-08',to:'2026-10-09'});
    assert.strictEqual(r.history.status,'OK');assert.strictEqual(r.decisions.length,4);assert.strictEqual(f.getReads(),1);
    assert.ok(r.decisions.every(d=>d.history_provenance.axis==='RUN_AXIS'));
  });
  await test('superseded same-day runs yield one winner; unpromoted candidates excluded',async()=>{
    const f=fixture();f.seed('2026-10-08',4);f.seed('2026-10-09',5);
    f.tables[C.RUN_HISTORY].push({scope:'production',promoted:false,status:'COMPLETE',run_id:'bad',revision:6,expected_trade_date:'2026-10-09'});
    const r=await readProductionHistory(f.db,{from:'2026-10-08',to:'2026-10-09'});
    assert.deepStrictEqual(r.decisions.map(d=>d.run_id),['r5','r5','r4','r4']);
  });
  await test('concurrent later revisions are excluded by the pinned revision',async()=>{
    const f=fixture();f.seed('2026-10-08',4);f.tables[C.ACTIVE_POINTER]=[{scope:'production',run_id:'r3',revision:3,expected_trade_date:'2026-10-09'}];
    const r=await readProductionHistory(f.db,{from:'2026-10-08',to:'2026-10-09'});
    assert.ok(r.decisions.every(d=>d.run_id!=='r4'));
  });
  await test('cross-switch segments do not read legacy rows on/after switch',async()=>{
    const f=fixture();f.seed('2026-09-30',1);
    f.tables.decision_result=[{code:'A',decision_date:'2026-09-29'},{code:'A',decision_date:'2026-09-30'}];
    const r=await readProductionHistory(f.db,{code:'A',from:'2026-09-29',to:'2026-09-30'});
    assert.strictEqual(r.history.status,'OK');assert.strictEqual(r.decisions.length,2);assert.strictEqual(r.history.segments.length,2);
    assert.deepStrictEqual(r.decisions.map(d=>d.history_provenance.axis),['RUN_AXIS','LEGACY_ARCHIVE']);
  });
  for (const mutation of ['missing decision','duplicate code','cross-run row','wrong date','manifest invalid','portfolio absent']) {
    await test(mutation+' is an explicit gap without fallback to older same-day run',async()=>{
      const f=fixture();f.seed('2026-10-08',4);f.seed('2026-10-09',5);
      const d=f.tables[C.CANDIDATE_DECISION].find(d=>d.run_id==='r4');
      if(mutation==='missing decision') f.tables[C.CANDIDATE_DECISION]=f.tables[C.CANDIDATE_DECISION].filter(x=>x!==d);
      if(mutation==='duplicate code') f.tables[C.CANDIDATE_DECISION].find(x=>x.run_id==='r4'&&x.code==='B').code='A';
      if(mutation==='cross-run row') d.run_id='other';
      if(mutation==='wrong date') d.decision_date='2026-10-07';
      if(mutation==='manifest invalid') f.tables[C.RUN_MANIFEST].find(x=>x.run_id==='r4').validation_passed=false;
      if(mutation==='portfolio absent') f.tables[C.CANDIDATE_PORTFOLIO]=f.tables[C.CANDIDATE_PORTFOLIO].filter(x=>x.run_id!=='r4');
      const r=await readProductionHistory(f.db,{from:'2026-10-08',to:'2026-10-09'});
      assert.strictEqual(r.history.status,'PARTIAL');assert.ok(r.history.gaps.some(g=>g.run_id==='r4'));
      assert.ok(r.decisions.every(x=>x.run_id==='r5'));
    });
  }
  await test('unavailable run index is not reported as successful empty history',async()=>{
    const f=fixture(),original=f.db.query;f.db.query=async(t,...args)=>{if(t===C.RUN_HISTORY)throw new Error('missing');return original(t,...args);};
    const r=await readProductionHistory(f.db,{from:'2026-10-08',to:'2026-10-09'});
    assert.strictEqual(r.history.status,'UNAVAILABLE');assert.strictEqual(r.decisions.length,0);
    assert.strictEqual(r.history.latest_fallback_used,false);
  });
  await test('missing trading day is detected, national holiday is not a gap',async()=>{
    const f=fixture();f.seed('2026-09-30',1);f.tables[C.ACTIVE_POINTER]=[{scope:'production',run_id:'r3',revision:3,expected_trade_date:'2026-10-09'}];
    f.tables[C.RUN_HISTORY]=f.tables[C.RUN_HISTORY].filter(h=>h.run_id!=='r2');
    const r=await readProductionHistory(f.db,{from:'2026-09-30',to:'2026-10-09'});
    assert.ok(r.history.gaps.some(g=>g.date==='2026-10-08'));
    assert.ok(!r.history.gaps.some(g=>g.date==='2026-10-01'));
  });
  await test('truncation is explicit and code-specific history stays code-specific',async()=>{
    const r=await readProductionHistory(fixture().db,{code:'A',from:'2026-10-08',to:'2026-10-09',limit:1});
    assert.strictEqual(r.history.status,'TRUNCATED');assert.strictEqual(r.decisions.length,1);assert.strictEqual(r.decisions[0].code,'A');
  });
  await test('invalid and reversed dates are rejected',async()=>{
    assert.throws(()=>bounds('2026-02-30','2026-03-01'),/INVALID/);
    assert.throws(()=>bounds('2026-10-09','2026-10-08'),/INVALID/);
  });
  console.log(`production-history: ${passed} passed`);
})().catch(e=>{console.error(e);process.exitCode=1;});
