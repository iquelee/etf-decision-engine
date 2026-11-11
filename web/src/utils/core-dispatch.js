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
