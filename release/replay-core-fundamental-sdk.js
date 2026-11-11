#!/usr/bin/env node
'use strict';
// Offline captured news/extraction entry + original SDK/parsers/database code.
// Only transport boundaries, clock and wait scheduling are synthetic. No cloud.
const assert=require('assert'),fs=require('fs'),path=require('path'),crypto=require('crypto');
const {spawnSync}=require('child_process');
const {fileMap}=require('./prepare-writer-workers');
const {createBusinessWire}=require('./writer-sdk-memory-wire');
const {backend}=require('../tests/writer-journal-cloudbase.test');
const {assertCoreWriters}=require('./runtime24-v3-core-scope');
const producers=['fetchFundamentalNews','extractFundamental'];assertCoreWriters(producers);
const manifest=require('./runtime24-writer-core-candidates.json');
const inventory=require('./runtime24-writer-six-inventory.json');
const ENV='tradingview-etf-d0fa42yy57cbc11b',JOURNAL='writer_admission_journal_v1';
const copy=x=>JSON.parse(JSON.stringify(x)),sha=x=>crypto.createHash('sha256').update(x).digest('hex');
const codes=['513310','515880','159582','518880','159570'];
const holdings={
  '513310':{stock_code:'000660',stock_name:'SK海力士',market:'kr'},
  '515880':{stock_code:'300502',stock_name:'新易盛',market:'cn'},
  '159582':{stock_code:'002371',stock_name:'北方华创',market:'cn'},
  '159570':{stock_code:'06160',stock_name:'百济神州',market:'hk'}
};
const newsCases=[
  {name:'news-full-all-providers',dart:true},
  {name:'news-update-and-sec-incremental',dart:true,existing:true},
  {name:'news-dart-key-absent'},
  {name:'news-fresh-running-skip',fresh:true},
  {name:'news-stale-running-sweep',stale:true},
  {name:'news-low-budget-partial',remaining:30000},
  {name:'news-provider-partial',providerFault:true},
  {name:'news-single-sec-save',business:{single:'MU',save:true}},
  {name:'news-hk-income-only',business:{hk_income_only:true}},
  {name:'news-admission-ack-lost',fault:'admit'},
  {name:'news-finish-ack-lost',dart:true,fault:'finish'}
];
const extractCases=[
  {name:'extract-missing-key',noKey:true},
  {name:'extract-empty-feed',empty:true},
  {name:'extract-valid-and-protected-indicators'},
  {name:'extract-empty-llm',emptyLlm:true},
  {name:'extract-malformed-llm',badLlm:true},
  {name:'extract-financial-conduction',financial:true},
  {name:'extract-hard-and-rollup',financial:true,business:{materialize_only:true,rollup_all:true}},
  {name:'news-to-extract-shared-tables',pipeline:true},
  {name:'extract-admission-ack-lost',fault:'admit'},
  {name:'extract-finish-ack-lost',fault:'finish'}
];
function noNetwork(){let attempts=0;const deny=()=>{attempts++;throw Error('OFFLINE_NETWORK_DENIED');};
  for(const n of ['http','https']){const m=require(n);m.request=m.get=deny;}
  require('net').Socket.prototype.connect=deny;require('tls').connect=deny;
  const dns=require('dns');for(const obj of [dns,dns.promises])for(const k of Object.keys(obj))if(/^(lookup|resolve|reverse)/.test(k)&&typeof obj[k]==='function')obj[k]=deny;
  global.fetch=deny;return()=>attempts;
}
function verify(root,map,hash){assert.strictEqual(sha(fs.readFileSync(map)),hash);assert.deepStrictEqual(fileMap(root),JSON.parse(fs.readFileSync(map)));}
function holdingHtml(code){const h=holdings[code];if(!h)return '';
  const stock=h.market==='kr'?`<span data-texch=''>${h.stock_code}</span>`:`<a href='unify/r/${h.market==='hk'?'116':'0'}.${h.stock_code}'>${h.stock_code}</a>`;
  return `截止至：<font>2026-09-30</font><tr><td>1</td>${stock}<td class='tol'><a>${h.stock_name}</a></td><td>12.5%</td></tr>`;
}
function secFacts(t){const amount=(value,start='2026-07-01',end='2026-09-30')=>({val:value,start,end,form:(t.forms||['10-Q'])[0],fy:2026,fp:'Q3',filed:'2026-10-28'});
  const revenue={units:{[t.currency||'USD']:[amount(1200000000),amount(1000000000,'2025-07-01','2025-09-30')]}};
  return {entityName:'Synthetic '+t.code,facts:{[t.ns||'us-gaap']:{Revenues:revenue,Revenue:revenue,
    NetIncomeLoss:{units:{USD:[amount(200000000)]}},PaymentsToAcquirePropertyPlantAndEquipment:{units:{USD:[amount(300000000,'2026-01-01')]}}}}};
}
function provider(side,config){
  const {definition:d,provider:requests}=side.state,u=new URL(config.url),method=config.method;
  const record={host:u.hostname,path:u.pathname,method,query:u.searchParams.toString().replace(/crtfc_key=[^&]+/g,'crtfc_key=fixture')};
  if(config.data)record.body=typeof config.data==='string'?config.data:JSON.stringify(config.data);
  requests.push(record);let data;
  if(u.hostname==='fundf10.eastmoney.com'&&u.pathname==='/FundArchivesDatas.aspx')data=holdingHtml(u.searchParams.get('code'));
  else if(u.hostname==='www.cninfo.com.cn'&&u.pathname==='/new/fulltextSearch/full'){
    assert.strictEqual(method,'post');const keyword=new URLSearchParams(config.data).get('searchkey');
    data={announcements:[{announcementTitle:`<em>${keyword}</em> 获批扩产`,secName:keyword,announcementTime:Date.parse('2026-10-28T08:00:00Z')}]};
  } else if(u.hostname==='www1.hkexnews.hk'&&u.pathname==='/search/prefix.do')data='callback('+JSON.stringify({stockInfo:[{stockId:'fixture-hk',code:'06160',name:'百济神州'}]})+');';
  else if(u.hostname==='www1.hkexnews.hk'&&u.pathname==='/search/titleSearchServlet.do')data={result:[{TITLE:'泽布替尼获批',DATE_TIME:'28/10/2026 16:00',STOCK_NAME:'百济神州',STOCK_CODE:'06160',FILE_LINK:'/fixture.pdf'},{TITLE:'月報表',DATE_TIME:'28/10/2026 16:00'}]};
  else if(u.hostname==='engopendart.fss.or.kr'&&u.pathname==='/engapi/list.json')data={status:'000',list:[{report_nm:'Synthetic HBM expansion',corp_name:'SK海力士',rcept_dt:'20261028',rcept_no:'fixture-dart'}]};
  else if(u.hostname==='engopendart.fss.or.kr'&&u.pathname==='/engapi/fnlttSinglAcnt.json')data={list:[{account_nm:'Revenue',thstrm_amount:'1,200',frmtrm_amount:'1,000',thstrm_dt:'2026-09-30'}]};
  else if(u.hostname==='datacenter.eastmoney.com'&&u.searchParams.get('reportName')==='RPT_HKF10_FN_INCOME')data={result:{data:[{STD_ITEM_CODE:'004001999',REPORT_DATE:'2026-06-30',YOY_RATIO:20,AMOUNT:1200,DATE_TYPE_CODE:'002',CURRENCY:'CNY'}]}};
  else if(u.hostname==='search-api-web.eastmoney.com')data='fixture('+JSON.stringify({result:{cmsArticleWebOld:[{title:'百济神州 FDA 获批',date:'2026-10-28 16:00:00',content:'泽布替尼',code:'fixture-search'}]}})+');';
  else if(u.hostname==='clinicaltrials.gov'&&u.pathname==='/api/v2/studies')data={studies:[{protocolSection:{identificationModule:{nctId:'NCTFIXTURE',briefTitle:'Synthetic phase III trial'},statusModule:{overallStatus:'COMPLETED',lastUpdatePostDateStruct:{date:'2026-10-28'}},designModule:{phases:['PHASE3']}}}]};
  else if(u.hostname==='api.fda.gov'&&u.pathname==='/drug/drugsfda.json')data={results:[{openfda:{brand_name:[u.searchParams.get('search').split(':')[1]]},submissions:[{submission_status:'AP',submission_status_date:'20261028',submission_type:'ORIG'}]}]};
  else if(u.hostname==='np-listapi.eastmoney.com'&&u.pathname==='/comm/web/getFastNewsList'){
    if(d.providerFault)throw Error('SYNTHETIC_FASTNEWS_UNAVAILABLE');
    data={data:{fastNewsList:[{title:'新易盛获批扩产',summary:'新易盛 300502',code:'fixture-fast',showTime:'2026-10-28 16:00:00',stockList:['300502']},{title:'无关天气',summary:'无关',code:'noise',showTime:'2026-10-28 16:00:00'}]}};
  } else if(u.hostname==='data.sec.gov'&&/^\/api\/xbrl\/companyfacts\/CIK\d+\.json$/.test(u.pathname)){
    const t=side.constants.SEC_FINANCIAL_TICKERS.find(t=>u.pathname.includes(t.cik));assert(t);data=secFacts(t);
  } else if(u.hostname==='datacenter-web.eastmoney.com'&&u.pathname==='/api/data/v1/get'){
    const m=side.constants.MACRO_DEFS.find(m=>m.reportName===u.searchParams.get('reportName'));assert(m);
    data={result:{data:[{REPORT_DATE:'2026-09-01',TIME:'2026年9月',[m.valueField]:2,...Object.fromEntries((m.extraFields||[]).map(f=>[f,1]))}]}};
  } else if(u.hostname==='api.deepseek.com'&&u.pathname==='/chat/completions'){
    assert.strictEqual(method,'post');assert.strictEqual(config.headers.Authorization,'Bearer fixture-deepseek');
    const body=JSON.parse(config.data);assert.strictEqual(body.model,'deepseek-chat');assert.strictEqual(config.timeout,60000);
    let results=[];const prompt=body.messages[1].content;
    if(!d.emptyLlm){
      if(prompt.startsWith('公司财报：'))results=[{related:'513310',indicator:'hbm_demand',grade:4,confidence:0.8,reason:'fixture financial'}];
      else for(const match of prompt.matchAll(/^(\d+)\. /gm)){
        const index=Number(match[1]);results.push({index,indicator:'hbm_demand',grade:4,confidence:0.8,reason:'fixture valid'},
          {index,indicator:'core_sales',grade:4,confidence:0.8,reason:'fixture valid'},
          {index,indicator:'dram_price',grade:5,confidence:0.8},{index,indicator:'NOT_ALLOWED',grade:4});
      }
    }
    data={choices:[{message:{content:d.badLlm?'{malformed':JSON.stringify({results})}}]};
  } else {side.state.forbidden.push(record);throw Error('UNREVIEWED_PROVIDER_REQUEST');}
  return {status:200,statusText:'OK',headers:{},config,data,request:{fixture:true}};
}
async function execute(inputs,candidates){
  assert.strictEqual(process.env.V3_CORE_FUNDAMENTAL_CHILD,'yes');assert.strictEqual(Number(process.versions.node.split('.')[0]),24);
  assert.strictEqual(manifest.release_scope,'V3_CORE_ONLY');
  const attempts=noNetwork(),NativeDate=Date,nativeTimeout=setTimeout,restorers=[];
  const instant=NativeDate.parse('2026-10-29T14:00:00Z');
  global.Date=class extends NativeDate{constructor(...args){super(...(args.length?args:[instant]));}static now(){return instant;}};
  global.setTimeout=(fn,ms,...args)=>nativeTimeout(fn,ms<=2000?0:ms,...args);
  process.env.TCB_ENV=ENV;process.env.SCF_NAMESPACE=ENV;
  const keys={fetchFundamentalNews:Buffer.alloc(32,61),extractFundamental:Buffer.alloc(32,62)};
  process.env.WRITER_NEWS_SIGNING_KEY_HEX=keys.fetchFundamentalNews.toString('hex');process.env.WRITER_EXTRACT_SIGNING_KEY_HEX=keys.extractFundamental.toString('hex');
  const roots=[],reports=[];let pipeline;
  function load(root,wrapped,producer){
    const sdk=require(path.join(root,'node_modules/@cloudbase/node-sdk')),axios=require(path.join(root,'node_modules/axios'));
    const {EJSON}=require(path.join(root,'node_modules/bson')),constants=require(path.join(root,'common/constants'));
    assert.strictEqual(require(path.join(root,'node_modules/@cloudbase/node-sdk/package.json')).version,'2.11.0');
    assert.strictEqual(require(path.join(root,'node_modules/@cloudbase/database/package.json')).version,'1.4.1');
    const state={business:null,journal:null,definition:null,provider:[],forbidden:[],ensures:[]},side={root,sdk,EJSON,constants,state,wrapped,producer};
    const {DBRequest}=require(path.join(root,'node_modules/@cloudbase/node-sdk/lib/utils/dbRequest')),previous=DBRequest.prototype.send;
    DBRequest.prototype.send=async function(action,params={}){
      assert.strictEqual(this.config.envName,ENV);if(wrapped){assert.strictEqual(this.config.retries,0);assert.strictEqual(this.config.keepalive,false);}
      if(/^database\.(startTransaction|commitTransaction|abortTransaction)$/.test(action)||params.collectionName===JOURNAL)return state.journal.send(action,params);
      if(action==='database.addCollection'){
        assert.strictEqual(params.collectionName,constants.COLLECTIONS.ETF_HOLDINGS);state.ensures.push({action,collection:params.collectionName});
        throw Error('ResourceExist: already exists'); // Explicit pre-existing table fixture; no resource created.
      }
      return state.business.send(action,params);
    };
    restorers.push(()=>{DBRequest.prototype.send=previous;});
    sdk.getCloudbaseContext=()=>({TCB_ENV:ENV,TRIGGER_SRC:'sdk'});axios.defaults.adapter=config=>Promise.resolve().then(()=>provider(side,config));
    side.index=require(path.join(root,'index.js'));roots.push(side);return side;
  }
  function reset(side,d){
    const c=side.constants.COLLECTIONS,s=side.state;s.definition=d;s.provider=[];s.forbidden=[];s.ensures=[];
    const names=[c.ETF_BASIC,c.ETF_HOLDINGS,c.NEWS_FEED,c.GLOBAL_FINANCIAL,c.MACRO,c.FETCH_LOG,c.FUNDAMENTAL_CONFIG,c.FUNDAMENTAL_EVIDENCE,c.FUNDAMENTAL_SERIES];
    s.business=createBusinessWire({EJSON:side.EJSON,collections:names});s.journal=backend(side.EJSON,JOURNAL);
    s.business.seed(c.ETF_BASIC,codes.map((code,i)=>({_id:'etf:'+code,code,status:'enable',sort_order:i})));
    s.business.seed(c.ETF_HOLDINGS,Object.entries(holdings).map(([code,h])=>({_id:'holding:'+code,code,...h,weight:12.5,report_date:'2026-09-30'})));
    if(d.fresh||d.stale)s.business.seed(c.FETCH_LOG,[{_id:'prior-job',source:'fundamental_news',status:'running',fetch_time:new Date(instant-(d.fresh?60000:600000))}]);
    if(side.producer==='extractFundamental'&&!d.empty){
      const feed=[{_id:'news:valid',code:'513310',title:'SK海力士 HBM 扩产',stock_name:'SK海力士',stock_code:'000660',holding_weight:12.5},
        {_id:'news:biotech',code:'159570',title:'百济神州泽布替尼获批',stock_name:'百济神州',stock_code:'06160'},
        {_id:'news:contamination',code:'518880',title:'SK海力士 HBM 扩产',stock_name:'SK海力士',stock_code:'000660'},
        {_id:'news:off-universe',code:'159570',title:'鲁抗医药获批',stock_name:'鲁抗医药',stock_code:'600789'},
        {_id:'news:all',code:'ALL',title:'市场新闻'}].map(r=>({...r,status:'new',publish_time:new Date(instant-3600000)}));
      s.business.seed(c.NEWS_FEED,feed);
    }
    if(d.financial)s.business.seed(c.GLOBAL_FINANCIAL,[{_id:'financial:MU',symbol:'usMU',code:'MU',name:'美光科技',period_end:'2026-09-30',capex_ytd:300000000,revenue:1200000000,revenue_yoy:20},
      {_id:'financial:hk',symbol:'hk06160',period_end:'2026-06-30',revenue_yoy:20}]);
    if(side.producer==='extractFundamental')s.business.seed(c.FUNDAMENTAL_SERIES,[{_id:'protected:dram',code:'513310',indicator:'dram_price',data_date:'2026-10-28',value:123,source:'real-price-fixture'}]);
    if(d.business?.rollup_all)s.business.seed(c.FUNDAMENTAL_EVIDENCE,[
      {_id:'evidence:valid',code:'513310',indicator:'hbm_demand',week_date:'2026-10-26',grade:4,confidence:0.8,title:'HBM扩产',stock_code:'000660',stock_name:'SK海力士',source:'deepseek'},
      {_id:'evidence:contamination',code:'159570',indicator:'core_sales',week_date:'2026-10-26',grade:5,confidence:0.8,title:'鲁抗获批',stock_code:'600789',stock_name:'鲁抗医药',source:'deepseek'}]);
    if(d.pipeline){assert(pipeline);for(const [name,rows] of Object.entries(pipeline))s.business.seed(name,rows);}
    if(d.existing){assert(pipeline);for(const [name,rows] of Object.entries(pipeline))s.business.seed(name,rows);}
  }
  try {
    for(const producer of producers){
      const pack=manifest.packages.find(p=>p.producer===producer),captured=inventory.functions.find(f=>f.FunctionName===producer);
      const input=path.resolve(inputs,producer+'-download'),candidate=path.resolve(candidates,pack.target);
      const check=()=>{
        verify(input,path.resolve(inputs,producer+'.files.json'),captured.download.raw_file_map_sha256);
        verify(candidate,path.resolve(candidates,pack.target+'.files.json'),pack.map_sha256);
        assert.strictEqual(sha(fs.readFileSync(path.resolve(inputs,producer+'.zip'))),captured.download.archive_sha256);
        assert.strictEqual(sha(fs.readFileSync(path.resolve(candidates,pack.target+'.zip'))),pack.zip_sha256);
        const id=JSON.parse(fs.readFileSync(path.join(candidate,'SOURCE_IDENTITY.json')));assert.strictEqual(id.source_commit,manifest.source_commit);assert.strictEqual(id.release_scope,'V3_CORE_ONLY');
      };check();
      const original=load(input,false,producer),actual=load(candidate,true,producer),adapter=require(path.join(candidate,'writer-journal-cloudbase')),
        journal=require(path.join(candidate,'writer-admission-journal')),entry=require(path.join(candidate,'writer-entry'));
      const binding={environment:ENV,scope:'production/'+producer},store=adapter.createProductionStore({database:actual.sdk.init({env:ENV,retries:0,keepalive:false}).database(),binding});
      const cases=[],faults=[];
      for(const d of producer==='fetchFundamentalNews'?newsCases:extractCases){
        process.env.OPENDART_API_KEY=d.dart?'fixture-dart':'';process.env.DEEPSEEK_API_KEY=d.noKey?'':'fixture-deepseek';
        for(const side of [original,actual])reset(side,d);
        actual.state.journal.seed(adapter.id(binding,'control'),adapter.encodeControl(journal.initial(binding),binding));
        assert((await journal.apply(store,binding,{type:'activate',owner:'new',revision:0,proof:{reference:'fixture:fundamental-sdk',entries_closed:true,executions_terminal:true,retries_accounted_for:true}})).ok);
        const business={task_name:'fixture:'+d.name,...d.business},context={function_name:pack.target,request_id:'fixture:'+d.name,getRemainingTimeInMillis:()=>d.remaining||540000};
        const request=entry.seal({binding,control:await store.read(binding),target:pack.target,request_id:'fixture:'+d.name,business,key:keys[producer]});
        if(d.fault){
          // Signed workers report ambiguity; their caller holds the control.
          // Exercise the sealed caller protocol too, rather than expecting the
          // direct worker entry to behave like its native timer facade.
          let childCalls=0;
          const caller=entry.createFacade({store,binding,targets:{old:producer,new:pack.target},key:keys[producer],
            identify:()=>({request_id:'fixture:'+d.name,business}),
            callFunction:async({name,data})=>{assert.strictEqual(name,pack.target);childCalls++;return {result:await actual.index.main(data,context)};},
            budget:{worker_ms:500,transport_ms:15000,facade_ms:18000,reserve_ms:1000}});
          if(d.fault==='admit')actual.state.journal.fault={action:'database.commitTransaction',after:true,response:{code:'SIMULATED_ACK_LOST',requestId:'fixture:ack'}};
          else {
            const expected=await original.index.main(copy(business),context);assert.strictEqual(expected.ok,true);
            const send=actual.state.journal.send.bind(actual.state.journal);let armed=false;
            actual.state.journal.send=async(action,params)=>{
              if(!armed&&action==='database.startTransaction'&&actual.state.business.writes.length){armed=true;actual.state.journal.fault={action:'database.commitTransaction',after:true,response:{code:'SIMULATED_ACK_LOST',requestId:'fixture:ack'}};}
              return send(action,params);
            };
          }
          const result=await caller(copy(business),context);assert.strictEqual(result.error_code,'WRITER_EXECUTION_UNKNOWN',d.name);assert.strictEqual(result.hold_confirmed,true);
          assert.strictEqual(actual.state.journal.fault,null);assert.strictEqual((await store.read(binding)).state,'HOLD');
          const before=[actual.state.business.calls.length,actual.state.business.writes.length,actual.state.provider.length];
          assert.strictEqual((await caller(copy(business),context)).error_code,'WRITER_ADMISSION_CLOSED');assert.strictEqual(childCalls,1);
          assert.deepStrictEqual([actual.state.business.calls.length,actual.state.business.writes.length,actual.state.provider.length],before);
          assert.deepStrictEqual(actual.state.business.violations,[]);assert.deepStrictEqual(actual.state.forbidden,[]);
          const receipts=actual.state.journal.rows().filter(r=>['request','token'].includes(r.kind));assert.strictEqual(receipts.length,2);
          assert(receipts.every(r=>JSON.parse(r.payload_json).status===(d.fault==='admit'?'RUNNING':'COMPLETE')));
          if(d.fault==='admit')assert.deepStrictEqual(before,[0,0,0]);else {
            assert(before[1]>0);assert.deepStrictEqual(copy(actual.state.business.writes),copy(original.state.business.writes));
            assert.deepStrictEqual(copy(actual.state.business.snapshot()),copy(original.state.business.snapshot()));
            assert.deepStrictEqual(actual.state.provider,original.state.provider);
          }
          faults.push({case:d.name,business_writes:before[1],provider_fixture_requests:before[2],control:'HOLD',sealed_caller_protocol:true,caller_transport:'FIXTURE_NOT_LONG_DURATION_PROOF',child_calls:childCalls,duplicate_business_calls:0});continue;
        }
        const expected=await original.index.main(copy(business),context),wrapped=await actual.index.main(copy(request),context);
        assert.strictEqual(wrapped.outcome,'COMPLETE');const result=wrapped.result;
        assert.deepStrictEqual(copy(result),copy(expected),d.name+': result');
        const left=actual.state,right=original.state;
        assert.deepStrictEqual(copy(left.business.writes),copy(right.business.writes),d.name+': write payload/order');
        assert.deepStrictEqual(copy(left.business.snapshot()),copy(right.business.snapshot()),d.name+': final tables');
        assert.deepStrictEqual(left.provider,right.provider);assert.deepStrictEqual(left.ensures,right.ensures);
        for(const s of [left,right]){assert.deepStrictEqual(s.business.violations,[]);assert.deepStrictEqual(s.forbidden,[]);}
        if(d.name==='news-full-all-providers'){
          assert.strictEqual(result.ok,true);assert.deepStrictEqual(result.errors,[]);assert.deepStrictEqual(result.skipped,[]);
          assert.strictEqual(result.holdings,4);assert.strictEqual(result.sec_financial,16);assert.strictEqual(result.dart_financial,2);assert(result.biotech_news>=4);assert.strictEqual(result.macro,4);
          pipeline=copy(left.business.snapshot());
        }
        if(d.fresh){assert.strictEqual(result.skipped,true);assert.strictEqual(left.business.writes.length,0);assert.strictEqual(left.provider.length,0);}
        if(d.existing)assert.strictEqual(result.sec_financial,0);
        if(d.remaining)assert(result.skipped.includes('sec_financial'));
        if(d.providerFault)assert(left.business.rows(actual.constants.COLLECTIONS.FETCH_LOG).some(r=>r.source==='eastmoney_fastnews'&&r.status==='fail'));
        if(d.noKey){assert.strictEqual(result.ok,false);assert.strictEqual(left.provider.length,0);}
        if(d.emptyLlm)assert(left.business.rows(actual.constants.COLLECTIONS.NEWS_FEED).some(r=>r.status==='extract_empty'));
        if(d.badLlm)assert(result.errors.length>0);
        if(d.name==='extract-valid-and-protected-indicators'){
          assert.strictEqual(result.processed,2);const evidence=left.business.rows(actual.constants.COLLECTIONS.FUNDAMENTAL_EVIDENCE);
          assert.strictEqual(evidence.length,2);assert(!evidence.some(r=>r.indicator==='dram_price'||r.stock_code==='600789'||r.code==='518880'));
          assert.strictEqual(left.business.rows(actual.constants.COLLECTIONS.FUNDAMENTAL_SERIES).find(r=>r._id==='protected:dram').value,123);
        }
        if(d.business?.rollup_all){assert.strictEqual(result.rollup_count,1);assert.strictEqual(result.hard,2);}
        if(d.pipeline){assert.strictEqual(result.ok,true);assert(result.processed>0);assert(result.financial_extracted>0);}
        const before=[left.business.calls.length,left.business.writes.length,left.provider.length];
        assert.strictEqual((await actual.index.main(copy(request),context)).admission,'ALREADY_COMPLETE');
        assert.deepStrictEqual([left.business.calls.length,left.business.writes.length,left.provider.length],before);
        const control=await store.read(binding);assert.strictEqual(control.state,'ACTIVE');assert.strictEqual(control.active,null);
        const receipts=left.journal.rows().filter(r=>['request','token'].includes(r.kind));assert.strictEqual(receipts.length,2);assert(receipts.every(r=>JSON.parse(r.payload_json).status==='COMPLETE'));
        cases.push({case:d.name,business_writes:left.business.writes.length,provider_fixture_requests:left.provider.length,result:copy(result),duplicate_business_calls:0});
      }
      check();reports.push({producer,cases,fault_cases:faults});
    }
    assert.strictEqual(attempts(),0);
    return {status:'PASS_CORE_FUNDAMENTAL_ACTUAL_SDK_MEMORY_WIRE',scope:'V3_CORE_ONLY',runtime:process.version,package_source:manifest.source_commit,sdk:'2.11.0',database:'1.4.1',reports,
      business_results_writes_and_final_tables_equal:true,shared_news_to_extract_tables:true,transport_and_waits:'SYNTHETIC_NO_LONG_DURATION_QUALIFICATION',dispatch_host_to_real_children:'NOT_RUN',network_attempts:attempts(),cloud_calls:0,production_and_natural_qualification:'NOT_PROVEN'};
  }finally{restorers.reverse().forEach(fn=>fn());global.Date=NativeDate;global.setTimeout=nativeTimeout;}
}
function main(){let args=process.argv.slice(2);const child=args[0]==='--child';if(child)args=args.slice(1);
  assert(args.length===4&&args[0]==='--inputs'&&args[2]==='--candidates');
  if(child)return execute(args[1],args[3]).then(r=>console.log(JSON.stringify(r)));
  const env={V3_CORE_FUNDAMENTAL_CHILD:'yes'};for(const key of ['PATH','SystemRoot','WINDIR','TEMP','TMP'])if(process.env[key])env[key]=process.env[key];
  const result=spawnSync(process.execPath,[__filename,'--child',...args],{env,encoding:'utf8',timeout:300000,maxBuffer:4*1024*1024});
  if(result.stdout)process.stdout.write(result.stdout);if(result.stderr)process.stderr.write(result.stderr);assert.strictEqual(result.status,0,'offline fundamental child failed');
}
if(require.main===module)Promise.resolve().then(main).catch(e=>{console.error(e);process.exitCode=1;});
