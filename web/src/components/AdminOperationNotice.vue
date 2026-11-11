<script setup>
import {computed} from 'vue';
const props = defineProps({state: {type: Object, required: true}, reviewed: Boolean, feedback: String});
const emit = defineEmits(['review', 'acknowledge', 'update:reviewed']);
const labels = {login: '登录', logout: '退出登录', changePassword: '修改密码', risk: '风险事件', param: '参数更新',
  trade: '交易记录', portfolio: '账户快照', fetch: '数据抓取', intel: '情报刷新', fundamental: '基本面更新', gen1: '健康复核'};
const label = computed(() => labels[props.state.record?.endpoint.match(/\/api\/admin\/([^/? ]+)/)?.[1]] || '后台操作');
const visible = computed(() => props.state.error || (props.state.record &&
  (props.state.record.state === 'UNCERTAIN' || props.state.record.review_requested || !props.state.busy)));
</script>

<template>
  <section v-if="visible" class="operation-notice" role="status" aria-live="polite" aria-label="操作结果核对">
    <template v-if="state.record">
      <h2>{{ state.record.state === 'QUEUED' ? label + '已接单，等待执行' : label + '结果待核对' }}</h2>
      <p v-if="state.record.state === 'QUEUED'">接单不代表执行完成。请查看抓取日志核对结果，未核对前勿重复提交。</p>
      <p v-else>请刷新页面，核对这次操作是否已生效。未核对前请勿作为新操作重复提交。</p>
      <div class="operation-id">操作标识 {{ state.record.id }}</div>
      <div class="notice-actions">
        <button type="button" :disabled="state.busy" @click="emit('review')">刷新查看结果</button>
        <template v-if="state.record.review_requested">
          <label class="review-check"><input type="checkbox" :checked="reviewed"
            @change="emit('update:reviewed', $event.target.checked)" />我已核对这次操作的结果</label>
          <button type="button" :disabled="state.busy || !reviewed" @click="emit('acknowledge')">确认核对并结束</button>
        </template>
      </div>
      <p class="notice-note">结束核对只关闭本页记录，不会取消任务或解除后台暂停。</p>
    </template>
    <p v-else>{{ state.error }}</p>
    <p v-if="feedback" role="alert">{{ feedback }}</p>
  </section>
</template>

<style scoped>
.operation-notice { position: fixed; z-index: 3000; bottom: max(16px, env(safe-area-inset-bottom)); left: 50%;
  transform: translateX(-50%); width: min(620px, calc(100vw - 32px)); box-sizing: border-box;
  max-height: 65vh; overflow-y: auto; padding: 16px; background: #fffbeb; color: #713f12;
  border: 1px solid #d97706; border-radius: 10px; box-shadow: 0 4px 20px #0002; font-size: 13px; }
h2 { font-size: 15px; margin: 0 0 8px; } p { margin: 8px 0; line-height: 1.6; }
.operation-id { overflow-wrap: anywhere; font-size: 11px; }
.notice-actions { display: flex; gap: 10px; flex-wrap: wrap; align-items: center; margin-top: 12px; }
button { min-height: 40px; padding: 8px 12px; border-radius: 6px; border: 1px solid #b45309; color: #713f12;
  background: #fff; cursor: pointer; font: inherit; }
button:disabled { opacity: .5; cursor: default; } button:focus-visible, input:focus-visible { outline: 2px solid #2563eb; outline-offset: 3px; }
.review-check { display: flex; align-items: center; gap: 6px; min-height: 40px; }
.review-check input { width: 18px; height: 18px; } .notice-note { font-size: 11px; }
</style>
