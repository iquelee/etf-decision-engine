<script setup>
import { ref } from 'vue';
import { prettyExplain } from '../../utils/state.js';

// 决策链「为什么」逐级展开组件
// 数据：explain_chain = [{step, condition, result}]
const props = defineProps({
  chain: { type: Array, default: () => [] },
  action: { type: String, default: '' },
  gen1: { type: Object, default: null }
});

const expanded = ref({});

function toggle(step) {
  expanded.value[step] = !expanded.value[step];
}
</script>

<template>
  <div class="decision-chain">
    <div v-if="action" class="chain-final">
      最终动作：<span class="chain-action">{{ action }}</span>
    </div>
    <div v-if="gen1" class="chain-ml-observe">
      <span class="ml-tag">Gen-1</span>
      <span class="ml-phase">{{ gen1.status && gen1.status.label }}</span>
      <span class="ml-desc">{{ gen1.advisory && gen1.advisory.message }} · 自动交易关闭</span>
    </div>
    <ol class="chain-list">
      <li v-for="item in chain" :key="item.step" class="chain-item">
        <div class="chain-step" @click="toggle(item.step)">
          <span class="chain-num">{{ item.step }}</span>
          <span class="chain-condition">{{ prettyExplain(item.condition) }}</span>
          <span class="collapse-toggle">{{ expanded[item.step] ? '收起' : '为什么' }}</span>
        </div>
        <div v-if="expanded[item.step]" class="chain-explain">
          <span class="chain-arrow">因为</span> {{ prettyExplain(item.condition) }}
          <span class="chain-arrow"> 所以</span> {{ prettyExplain(item.result) }}
        </div>
      </li>
    </ol>
  </div>
</template>

<style scoped>
.decision-chain { font-size: 13px; }
.chain-final { margin-bottom: 10px; color: #374151; }
.chain-action { font-weight: 700; color: #2563eb; }
.chain-list { list-style: none; margin: 0; padding: 0; }
.chain-item { border-bottom: 1px solid #f3f4f6; padding: 6px 0; }
.chain-step { display: flex; align-items: center; gap: 10px; cursor: pointer; }
.chain-num {
  width: 22px; height: 22px; border-radius: 50%; background: #eff6ff; color: #2563eb;
  display: flex; align-items: center; justify-content: center; font-size: 12px; flex-shrink: 0;
}
.chain-condition { flex: 1; color: #111827; }
.chain-explain {
  margin: 6px 0 4px 32px; padding: 8px 10px; background: #f9fafb; border-left: 3px solid #2563eb;
  border-radius: 4px; color: #4b5563; line-height: 1.6;
}
.chain-arrow { color: #2563eb; font-weight: 500; }

.chain-ml-observe {
  display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
  margin: 0 0 10px; padding: 8px 10px;
  background: #f8fafc; border: 1px dashed #94a3b8; border-radius: 6px;
  font-size: 12px; color: #475569;
}
.ml-tag { font-weight: 700; color: #0f172a; }
.ml-phase {
  font-weight: 700; font-size: 11px; color: #1e40af;
  background: #dbeafe; border-radius: 4px; padding: 1px 6px;
}
.ml-desc { color: #64748b; }
</style>
