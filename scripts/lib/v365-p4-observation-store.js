/**
 * V3.6.5 P-4 —— 观测存储（**test-only 内存实现**）
 *
 * ⛔ 不连接数据库、不创建生产 collection、不被 cloudfunctions/ 引用。
 * 用途：在没有真实库的前提下验证「caller 传输记录 + 下游业务自证」的关联语义。
 *
 * 关键性质：
 *   - `nextAttempt(pipeline_key)` 单调递增，**不依赖 wall-clock**
 *   - 所有写入深拷贝，防止调用方持引用造成假通过
 *   - 不实现任何「按时间窗口猜关联」的兜底（关联只认 pipeline_run_id 相等）
 */
'use strict';

const path = require('path');

const REPO = path.join(__dirname, '..', '..');
const {
  canonicalPipelineKey, buildPipelineIdentity, reconcile
} = require(path.join(REPO, 'src', 'common', 'utils', 'pipeline-correlation.js'));

function deepCopy(v) { return v == null ? v : JSON.parse(JSON.stringify(v)); }

function createObservationStore() {
  const attempts = new Map();       // pipeline_key -> last allocated attempt
  const callRecords = new Map();    // pipeline_run_id -> call record
  const businessObs = new Map();    // pipeline_run_id -> business observation

  return {
    /** 分配同一条 pipeline_key 的下一次 attempt（1,2,3…）—— ⛔ 不用时钟 */
    nextAttempt(pipelineKey) {
      const n = (attempts.get(pipelineKey) || 0) + 1;
      attempts.set(pipelineKey, n);
      return n;
    },

    /** 一步到位：按 key 分配 attempt 并构建身份 */
    allocateIdentity(input) {
      const key = canonicalPipelineKey(input);
      const attempt = this.nextAttempt(key);
      return buildPipelineIdentity(Object.assign({}, input, { attempt }));
    },

    async putCallRecord(record) {
      if (!record || !record.pipeline_run_id) throw new Error('putCallRecord: 缺 pipeline_run_id');
      callRecords.set(record.pipeline_run_id, deepCopy(record));
      return { ok: true };
    },

    async getCallRecord(pipelineRunId) {
      return deepCopy(callRecords.get(pipelineRunId) || null);
    },

    async putBusinessObservation(rec) {
      if (!rec || !rec.pipeline_run_id) throw new Error('putBusinessObservation: 缺 pipeline_run_id');
      businessObs.set(rec.pipeline_run_id, deepCopy(rec));
      return { ok: true };
    },

    async getBusinessObservation(pipelineRunId) {
      return deepCopy(businessObs.get(pipelineRunId) || null);
    },

    /** 按 pipeline_run_id 关联两侧记录 */
    async reconcileByRunId(pipelineRunId) {
      return reconcile({
        callRecord: await this.getCallRecord(pipelineRunId),
        businessObservation: await this.getBusinessObservation(pipelineRunId)
      });
    },

    /** 按同一 pipeline_key 列出全部 attempt（用于 retry 识别） */
    async listAttempts(pipelineKey) {
      const out = [];
      callRecords.forEach((r) => { if (r.pipeline_key === pipelineKey) out.push(deepCopy(r)); });
      return out.sort((a, b) => a.attempt - b.attempt);
    },

    snapshot() {
      return {
        allocated_attempts: Array.from(attempts.entries()).map(([k, v]) => ({ pipeline_key: k, last_attempt: v })),
        call_records: callRecords.size,
        business_observations: businessObs.size
      };
    }
  };
}

module.exports = { createObservationStore };
