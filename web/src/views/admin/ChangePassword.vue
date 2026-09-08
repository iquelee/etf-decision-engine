<script setup>
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import { adminApi, setToken } from '../../api/request.js';

const router = useRouter();
const oldPwd = ref('');
const newPwd = ref('');
const confirmPwd = ref('');
const saving = ref(false);
const error = ref('');

async function submit() {
  error.value = '';
  if (!oldPwd.value || !newPwd.value) { error.value = '请填写原密码和新密码'; return; }
  if (newPwd.value.length < 4) { error.value = '新密码至少 4 位'; return; }
  if (newPwd.value !== confirmPwd.value) { error.value = '两次输入的新密码不一致'; return; }
  saving.value = true;
  try {
    await adminApi.changePassword(oldPwd.value, newPwd.value);
    setToken(null);
    window.alert('密码已修改，请重新登录');
    router.replace('/login');
  } catch (e) {
    error.value = e.message || String(e);
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <div>
    <div class="card pwd-card">
      <div class="card-title">修改登录密码 <span class="sub">改密后旧会话失效，需重新登录</span></div>
      <div class="form-row">
        <label class="form-label">原密码</label>
        <input v-model="oldPwd" type="password" class="input" placeholder="当前密码" autocomplete="current-password" />
      </div>
      <div class="form-row">
        <label class="form-label">新密码（至少 4 位）</label>
        <input v-model="newPwd" type="password" class="input" placeholder="新密码" autocomplete="new-password" />
      </div>
      <div class="form-row">
        <label class="form-label">确认新密码</label>
        <input v-model="confirmPwd" type="password" class="input" placeholder="再次输入新密码" autocomplete="new-password" />
      </div>
      <div v-if="error" class="login-error">{{ error }}</div>
      <button class="btn primary" :disabled="saving" @click="submit">
        {{ saving ? '保存中…' : '修改密码' }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.form-row { margin-bottom: 12px; }
.login-error { color: #dc2626; font-size: 12px; margin: 8px 0; }

.pwd-card { max-width: 480px; }
@media (max-width: 768px) {
  .pwd-card { max-width: 100%; }
}
</style>
