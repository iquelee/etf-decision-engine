import {ref, shallowRef, onMounted, onUnmounted} from 'vue';
import {adminOperations, reviewDestination} from '../utils/admin-operations.js';
export function useAdminOperationNotice() {
  const state = shallowRef(adminOperations.state()), reviewed = ref(false), feedback = ref('');let unsubscribe;
  const update = () => {
    const next = adminOperations.state();if (next.record?.id !== state.value.record?.id) reviewed.value = false;
    state.value = next;
  };
  onMounted(() => {unsubscribe = adminOperations.subscribe(update);update();});
  onUnmounted(() => unsubscribe?.());
  async function review() {
    try {
      const target = reviewDestination(state.value.record.endpoint, window.location.href);
      await adminOperations.requestReview(state.value.record.id);
      if (target === window.location.href) window.location.reload();else window.location.assign(target);
    }
    catch (error) {feedback.value = error.message;}
  }
  async function acknowledge() {
    try {await adminOperations.acknowledge(state.value.record.id, reviewed.value);feedback.value = '';}
    catch (error) {feedback.value = error.message;}
  }
  return {state, reviewed, feedback, review, acknowledge};
}
