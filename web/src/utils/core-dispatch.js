const targets = new Set(['fetchDailyData','fetchRealtimeData','fetchFundamentalNews','extractFundamental']);
export const isDispatchEndpoint = endpoint => /\/api\/admin\/(fetch|intel\/refresh)(?:[?#]|$)/.test(endpoint);
export function validateDispatch(value) {
  if (!value || value.schema !== 1 || value.state !== 'QUEUED' || !Array.isArray(value.jobs) || !value.jobs.length || value.jobs.length > 4 ||
      Object.keys(value).sort().join(',') !== 'jobs,schema,state') throw Error('接单确认格式异常');
  const seen = new Set();
  for (const job of value.jobs) {
    if (!job || Object.keys(job).sort().join(',') !== 'job_id,state,target' || !/^dispatch:[a-f0-9]{64}$/.test(job.job_id) ||
        !targets.has(job.target) || job.state !== 'PREPARED' || seen.has(job.job_id)) throw Error('任务接单确认格式异常');
    seen.add(job.job_id);
  }
  return JSON.parse(JSON.stringify(value));
}
export function dispatchAcknowledgment(json, endpoint) {
  if (!isDispatchEndpoint(endpoint) || json?.code !== 0) return null;
  if (json.writer_dispatch) return validateDispatch(json.writer_dispatch);
  if (json.data?.cooled === true && json.data?.triggered === false) return null;
  throw Error('未收到持久接单确认，请先核对执行结果');
}
export function unwrapCoreDispatch(json, endpoint) {
  if (!isDispatchEndpoint(endpoint) || !json?.writer_dispatch) return json?.data;
  return {...json.data, writer_dispatch: validateDispatch(json.writer_dispatch)};
}
export function dispatchMessage(data) {
  if (data?.writer_dispatch) {validateDispatch(data.writer_dispatch);return '已接单，等待执行。请核对执行结果，勿重复提交。';}
  if (data?.cooled && data?.triggered === false) return '刷新冷却中，未创建新任务。';
  return '请求已返回，执行状态未确认，请核对抓取日志。';
}
export function validateDispatchStatus(value, expected) {
  const fields='attempt,business_status,execution_status,job_id,reconciliation_required,schema,state,target';
  const mapping={PREPARED:'NOT_STARTED',CLAIMED:'UNCONFIRMED',COMPLETE:'COMPLETED',HOLD:'UNKNOWN'};
  if(!value || Object.keys(value).sort().join(',')!==fields || value.schema!==1 || !targets.has(value.target) ||
    value.job_id!==expected.job_id || value.target!==expected.target || !/^dispatch:[a-f0-9]{64}$/.test(value.job_id) ||
    !Object.hasOwn(mapping,value.state) || value.execution_status!==mapping[value.state] || value.business_status!=='NOT_OBSERVED' ||
    value.attempt!==(value.state==='PREPARED'?0:1) || value.reconciliation_required!==['CLAIMED','HOLD'].includes(value.state)) throw Error('任务状态确认不匹配，请保持待核对');
  return JSON.parse(JSON.stringify(value));
}
export async function readDispatchStatuses(jobs, {fetchImpl=globalThis.fetch, storage=globalThis.localStorage, base=(import.meta.env||{}).VITE_ADMIN_BASE||''}={}) {
  validateDispatch({schema:1,state:'QUEUED',jobs});
  const token=storage.getItem('admin_token');if(!token) throw Error('请先登录后核验任务状态');
  const results=[];
  for(const job of jobs) {
    // The target comes from build configuration, never the stored operation URL.
    const controller=typeof AbortController!=='undefined'?new AbortController():null;
    const timeout=controller?setTimeout(()=>controller.abort(),20000):null;
    try {
      const response=await fetchImpl(base+'/api/admin/dispatch/status?job_id='+encodeURIComponent(job.job_id),
        {method:'GET',headers:{'X-Admin-Token':token},cache:'no-store',...(controller?{signal:controller.signal}:{})});
      const json=await response.json();if(!response.ok || json?.code!==0) throw Error(json?.message||'任务状态暂不可核验');
      results.push(validateDispatchStatus(json.data,job));
    } finally {if(timeout)clearTimeout(timeout);}
  }
  return results;
}
export function dispatchStatusMessage(status) {
  const labels={fetchDailyData:'日线',fetchRealtimeData:'实时行情',fetchFundamentalNews:'新闻搜集',extractFundamental:'情报抽取'};
  const states={PREPARED:'尚未开始',CLAIMED:'执行结果未确认',COMPLETE:'调用已完成，业务结果仍需核对日志',HOLD:'结果不明，需要核验'};
  return labels[status.target]+'：'+states[status.state];
}
