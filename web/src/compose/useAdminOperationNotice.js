import {ref, shallowRef, onMounted, onUnmounted} from 'vue';
import {adminOperations, reviewDestination} from '../utils/admin-operations.js';
import {readDispatchStatuses, dispatchStatusMessage} from '../utils/core-dispatch.js';
export function useAdminOperationNotice() {
  const state = shallowRef(adminOperations.state()), reviewed = ref(false), feedback = ref(''), queueVerified = ref(false);let unsubscribe, reviewGeneration=0;
  const update = () => {
    const next = adminOperations.state();if (next.record?.id !== state.value.record?.id || (next.record?.state === 'QUEUED' &&
      (state.value.record?.state !== 'QUEUED' || next.record.review_requested !== state.value.record?.review_requested ||
        JSON.stringify(next.record.dispatch)!==JSON.stringify(state.value.record?.dispatch)))) {reviewed.value = false;queueVerified.value = false;}
    state.value = next;
  };
  onMounted(() => {unsubscribe = adminOperations.subscribe(update);update();});
  onUnmounted(() => unsubscribe?.());
  async function review() {
    const generation=++reviewGeneration;
    try {
      if(state.value.record.state==='QUEUED') {
        reviewed.value=false;queueVerified.value=false;
        const id=state.value.record.id, receipt=JSON.stringify(state.value.record.dispatch), statuses=await readDispatchStatuses(state.value.record.dispatch.jobs);
        if(generation!==reviewGeneration) return;
        if(state.value.record?.id!==id || JSON.stringify(state.value.record.dispatch)!==receipt) throw Error('操作记录已变化，请重新核验');
        feedback.value=statuses.map(dispatchStatusMessage).join('；');
        if(statuses.every(s=>s.state==='COMPLETE')) {await adminOperations.requestReview(id);
          if(generation!==reviewGeneration) return;
          if(state.value.record?.id!==id || JSON.stringify(state.value.record.dispatch)!==receipt) throw Error('操作记录已变化，请重新核验');queueVerified.value=true;}
        return;
      }
      const target = reviewDestination(state.value.record.endpoint, window.location.href);
      await adminOperations.requestReview(state.value.record.id);
      if (target === window.location.href) window.location.reload();else window.location.assign(target);
    }
    catch (error) {if(generation===reviewGeneration) feedback.value = error.message;}
  }
  async function acknowledge() {
    try {if(state.value.record.state==='QUEUED' && !queueVerified.value) throw Error('任务尚未确认调用完成，请保持待核对');
      await adminOperations.acknowledge(state.value.record.id, reviewed.value);feedback.value = '';}
    catch (error) {feedback.value = error.message;}
  }
  return {state, reviewed, feedback, queueVerified, review, acknowledge};
}
