<script setup>
import { ref, onMounted } from 'vue';
import { adminApi } from '../../api/request.js';

const loading = ref(true);
const error = ref('');
const list = ref([]);
const editing = ref(null); // 正在编辑的 key
const editValue = ref('');
const saving = ref(false);

function displayValue(item) {
  const v = item.value;
  if (v && typeof v === 'object' && v.v !== undefined) {
    if (typeof v.v === 'boolean' && /^ml_(shadow_observe|advisory_enabled|fast_path_enabled|execution_enabled|gen1_frozen)$/.test(item.key || '')) {
      return v.v ? '已启用' : '已关闭';
    }
    return typeof v.v === 'object' ? JSON.stringify(v.v) : v.v;
  }
  return v;
}

function displayPrev(item) {
  const v = item.prev_value;
  if (!v) return null;
  if (typeof v === 'object' && v.v !== undefined) {
    return typeof v.v === 'object' ? JSON.stringify(v.v) : v.v;
  }
  return v;
}

async function load() {
  loading.value = true;
  error.value = '';
  try {
    const res = await adminApi.params();
    list.value = res.list || [];
  } catch (e) {
    error.value = e.message || String(e);
  } finally {
    loading.value = false;
  }
}

function startEdit(item) {
  editing.value = item.key;
  // 展示层会把布尔值翻译为“已启用 / 已关闭”，编辑时必须保留原始值，
  // 否则保存会把 boolean 错误地写成中文字符串。
  const raw = item.value && typeof item.value === 'object' && item.value.v !== undefined
    ? item.value.v
    : item.value;
  editValue.value = typeof raw === 'object' ? JSON.stringify(raw) : String(raw ?? '');
}

function cancelEdit() {
  editing.value = null;
  editValue.value = '';
}

async function saveEdit(item) {
  // 保存前弹「影响 N 条历史信号」确认
  const parsed = parseValue(editValue.value);
  const confirmed = window.confirm(
    `本次改动「${item.key}」：${displayValue(item)} → ${editValue.value}\n\n` +
    `⚠️ 该参数改动将影响后续信号计算（历史信号将在下次重算时变化）。\n确认保存？`
  );
  if (!confirmed) return;

  saving.value = true;
  try {
    await adminApi.updateParam({ key: item.key, value: parsed });
    cancelEdit();
    await load();
  } catch (e) {
    error.value = e.message || String(e);
  } finally {
    saving.value = false;
  }
}

function parseValue(s) {
  const t = String(s).trim();
  if (t === '') return 0;
  if (t.startsWith('{') || t.startsWith('[')) {
    try { return JSON.parse(t); } catch (e) { return t; }
  }
  const n = Number(t);
  return Number.isNaN(n) ? t : n;
}

onMounted(load);
</script>

<template>
  <div>
    <div v-if="error" class="warning-bar">{{ error }}</div>

    <div class="card">
      <div class="card-title">参数配置 <span class="sub">改参带前后对比 + 影响面提示 + 版本留痕</span></div>
      <div v-if="loading" class="empty">加载中…</div>
      <table v-else-if="list.length" class="table">
        <thead>
          <tr><th>参数键</th><th>说明</th><th>分类</th><th>现值</th><th>前值</th><th>版本</th><th>操作</th></tr>
        </thead>
        <tbody>
          <tr v-for="item in list" :key="item.key">
            <td class="param-key">{{ item.key }} <span v-if="item.frozen" class="badge muted">已冻结</span></td>
            <td class="text-2">{{ item.description || '—' }}</td>
            <td>{{ item.category || '—' }}</td>
            <td>
              <span v-if="editing === item.key">
                <input v-model="editValue" class="input" style="width:120px" />
              </span>
              <strong v-else>{{ displayValue(item) }}</strong>
            </td>
            <td class="text-2">{{ displayPrev(item) != null ? displayPrev(item) : '—' }}</td>
            <td>v{{ item.version }}</td>
            <td>
              <span v-if="editing === item.key" class="flex gap-8">
                <button class="btn primary" :disabled="saving" @click="saveEdit(item)">保存</button>
                <button class="btn" @click="cancelEdit">取消</button>
              </span>
              <button v-else-if="item.frozen" class="btn" disabled title="已冻结，禁止从后台改">不可改</button>
              <button v-else class="btn" @click="startEdit(item)">编辑</button>
            </td>
          </tr>
        </tbody>
      </table>
      <div v-else class="empty">暂无参数</div>
    </div>
  </div>
</template>

<style scoped>
.param-key { font-family: monospace; font-size: 12px; color: #2563eb; }
</style>
