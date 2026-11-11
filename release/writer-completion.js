'use strict';
// Immutable, bounded Core long-task completion evidence. No raw business data.
const assert=require('assert'),crypto=require('crypto');
const {isDeepStrictEqual}=require('util');
const {canonical}=require('./writer-admission-cloudbase');
const environment='tradingview-etf-d0fa42yy57cbc11b';
const counters=Object.freeze({
  fetchFundamentalNews:['total_fetched','inserted','sec_financial','fast_news','macro','holdings','hk_income','dart_financial','biotech_news','etf_count'],
  extractFundamental:['processed','global_extracted','financial_extracted','news_total','hard','rollup_count']
});
const text=x=>typeof x==='string'&&/^[A-Za-z0-9_:./|#@+-]{1,200}$/.test(x);
function target(binding){assert(binding&&binding.environment===environment);const name=String(binding.scope).replace(/^production\//,'');assert(Object.hasOwn(counters,name)&&binding.scope==='production/'+name,'Core news/extraction only');return name;}
function identity(binding,value){const name=target(binding);assert(value&&text(value.request_id)&&text(value.token)&&value.owner==='new');
  assert(Number.isSafeInteger(value.epoch)&&value.epoch>=0&&value.epoch<Number.MAX_SAFE_INTEGER);
  return {environment,scope:binding.scope,target:name+'Node24',request_id:value.request_id,token:value.token,owner:'new',epoch:value.epoch};
}
function id(binding,value){return 'completion:'+crypto.createHash('sha256').update(canonical(identity(binding,value))).digest('hex');}
function create(binding,value,result){
  const name=target(binding),known=result&&typeof result==='object'&&!Array.isArray(result)?result:{};
  const counts={};for(const field of counters[name])if(Number.isSafeInteger(known[field])&&known[field]>=0)counts[field]=known[field];
  const issues=(Array.isArray(known.errors)?known.errors.length:0)+(Array.isArray(known.skipped)?known.skipped.length:known.skipped===true?1:0);
  const record={schema:1,...identity(binding,value),invocation_status:'COMPLETE',
    business_status:known.ok===true?'REPORTED_OK':known.ok===false?'REPORTED_FAILURE':'UNCLASSIFIED',reported_issue_count:issues,counters:counts};
  return validate(record,binding);
}
function validate(record,binding){
  assert(record&&typeof record==='object'&&!Array.isArray(record));
  assert(isDeepStrictEqual(JSON.parse(JSON.stringify(record)),record));
  assert.deepStrictEqual(Object.keys(record).sort(),['schema','environment','scope','target','request_id','token','owner','epoch','invocation_status','business_status','reported_issue_count','counters'].sort());
  const name=target(binding),expected=identity(binding,record);for(const [k,v]of Object.entries(expected))assert.strictEqual(record[k],v);
  assert(record.schema===1&&record.invocation_status==='COMPLETE');assert(['REPORTED_OK','REPORTED_FAILURE','UNCLASSIFIED'].includes(record.business_status));
  assert(Number.isSafeInteger(record.reported_issue_count)&&record.reported_issue_count>=0);
  assert(record.counters&&typeof record.counters==='object'&&!Array.isArray(record.counters));
  for(const [k,v]of Object.entries(record.counters))assert(counters[name].includes(k)&&Number.isSafeInteger(v)&&v>=0);
  assert(Buffer.byteLength(canonical(record))<=4096,'bounded completion evidence');return record;
}
function encode(record,binding){validate(record,binding);return {schema:1,kind:'completion',environment,scope:binding.scope,payload_json:canonical(record)};}
function decode(row,binding,value){if(row===null)return null;assert(row&&typeof row.payload_json==='string');const record=JSON.parse(row.payload_json);
  const expected=identity(binding,value);for(const [k,v]of Object.entries(expected))assert.strictEqual(record[k],v);
  assert.deepStrictEqual(row,{_id:id(binding,value),...encode(record,binding)},'corrupt or mismatched completion envelope');return record;
}
module.exports={environment,target,identity,id,create,validate,encode,decode};
