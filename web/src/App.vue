<script setup>
import { onMounted } from 'vue';
import { api } from './api/request.js';
import AdminOperationNotice from './components/AdminOperationNotice.vue';
import {useAdminOperationNotice} from './compose/useAdminOperationNotice.js';
const {state: operationState, reviewed, feedback, review, acknowledge} = useAdminOperationNotice();

// 启动时拉取后端常量（单一事实源），注入 window 供渐进迁移（组件仍可用本地常量兜底）
onMounted(async () => {
  try {
    const res = await api.constants();
    if (res && res.data) window.__CONSTANTS__ = res.data;
  } catch (e) {
    // 常量拉取失败不阻塞页面（组件有本地兜底）
    console.warn('constants 拉取失败，使用本地常量兜底:', e && e.message);
  }
});
</script>

<template>
  <router-view />
  <AdminOperationNotice :state="operationState" v-model:reviewed="reviewed" :feedback="feedback" @review="review" @acknowledge="acknowledge" />
</template>
