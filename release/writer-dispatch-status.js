'use strict';
const plan = require('./writer-dispatch-plan');
function publicStatus(job) {
  plan.validate(job);
  return {schema:1,job_id:job.spec.id,target:job.spec.target,state:job.state,attempt:job.attempt,
    execution_status:{PREPARED:'NOT_STARTED',CLAIMED:'UNCONFIRMED',COMPLETE:'COMPLETED',HOLD:'UNKNOWN'}[job.state],
    business_status:'NOT_OBSERVED',reconciliation_required:['CLAIMED','HOLD'].includes(job.state)};
}
module.exports = {publicStatus};
