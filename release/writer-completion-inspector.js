'use strict';
// Exact snapshot inspection only. Never sends, commits, resets or releases HOLD.
const assert=require('assert');
const {isDeepStrictEqual}=require('util');
const completion=require('./writer-completion'),dispatch=require('./writer-dispatch-cloudbase');
const plan=require('./writer-dispatch-plan'),ledger=require('./writer-journal-cloudbase'),entry=require('./writer-entry');
function createInspector(options){
  assert(options&&typeof options==='object');assert.deepStrictEqual(Object.keys(options).sort(),['database','readKey']);
  const {database,readKey}=options;
  assert(database&&database.config&&database.config.envName===plan.environment&&database.config.retries===0&&database.config.keepalive===false);
  assert(typeof readKey==='function');
  const okay=r=>assert(r&&!r.code&&typeof r.requestId==='string'&&r.requestId.length,'ambiguous snapshot response');
  return async id=>{
    assert(typeof id==='string'&&/^dispatch:[a-f0-9]{64}$/.test(id));let tx,rollbackAttempted=false;
    try{
      tx=await database.startTransaction();assert(tx&&typeof tx.getTransactionId()==='string'&&tx.getTransactionId().length);
      const col=tx.collection(dispatch.collection);
      const row=async docId=>{const r=await col.doc(docId).get();okay(r);assert(r.data===null||(r.data&&typeof r.data==='object'&&!Array.isArray(r.data)));return r.data;};
      const job=dispatch.decode(await row(id),id);assert(job,'job missing');
      const binding={environment:plan.environment,scope:'production/'+job.spec.target};completion.target(binding);
      const base={schema:1,job_id:id,target:job.spec.target,job_state:job.state,execution_status:'NOT_DISPATCHED',
        business_status:'NOT_OBSERVED',reported_issue_count:null,counters:{},generation_matches:null,
        controls_held:null,can_release:false,can_retry:false,reconciliation_required:true};
      let result=base;
      if(job.state!=='PREPARED'){
        const key=await readKey(job.spec.target);assert(Buffer.isBuffer(key)&&key.length===32);
        entry.authenticate(job.wire,{binding,target:job.spec.target+'Node24',owner:'new',key});
        const controls=[];
        for(const [b,who]of [[plan.parentBinding,job.spec.parent],[binding,job.wire]]){
          const docId=ledger.id(b,'control'),control=ledger.decode(await row(docId),docId,b,'control');assert(control);
          controls.push({control,who});
        }
        const indexes=async(b,who)=>{
          const receipts=[];
          for(const kind of ['request','token']){
            const docId=ledger.id(b,kind,who[kind==='request'?'request_id':'token']);
            const receipt=ledger.decode(await row(docId),docId,b,kind);
            if(receipt)for(const k of ['environment','scope','request_id','token','owner','epoch'])assert.strictEqual(receipt[k],who[k]);
            receipts.push(receipt);
          }
          assert(isDeepStrictEqual(receipts[0],receipts[1]),'dual receipt mismatch');return receipts[0];
        };
        const parentReceipt=await indexes(plan.parentBinding,job.spec.parent);assert(parentReceipt&&parentReceipt.status==='COMPLETE');
        const receipt=await indexes(binding,job.wire);
        const evidence=completion.decode(await row(completion.id(binding,job.wire)),binding,job.wire);
        if(receipt&&receipt.status!=='COMPLETE'){
          const child=controls[1].control;
          assert(child.active&&['request_id','token','owner','epoch'].every(k=>child.active[k]===job.wire[k]));
          assert(child.receipts.length===1&&child.receipts[0].status===receipt.status);
        }
        if(receipt&&receipt.status==='COMPLETE')assert(!controls[1].control.active||controls[1].control.active.request_id!==job.wire.request_id,'completed request still occupies child slot');
        let status=receipt?{COMPLETE:'LEGACY_COMPLETE_NO_SUMMARY',RUNNING:'IN_FLIGHT',UNKNOWN:'UNKNOWN'}[receipt.status]:'NOT_OBSERVED';
        if(evidence){assert(receipt&&receipt.status==='COMPLETE','completion without dual COMPLETE');status='DURABLE_COMPLETE';}
        result={...base,execution_status:status,generation_matches:controls.every(({control,who})=>control.owner===who.owner&&control.epoch===who.epoch),
          controls_held:controls.some(({control})=>control.state==='HOLD'),
          ...(evidence?{business_status:evidence.business_status,reported_issue_count:evidence.reported_issue_count,counters:evidence.counters}:{})};
      }
      rollbackAttempted=true;okay(await tx.rollback());return result;
    }catch(_){
      if(tx&&!rollbackAttempted){rollbackAttempted=true;try{await tx.rollback();}catch(_){}}
      return {schema:1,job_id:id,execution_status:'UNVERIFIABLE',can_release:false,can_retry:false,reconciliation_required:true};
    }
  };
}
module.exports={createInspector};
