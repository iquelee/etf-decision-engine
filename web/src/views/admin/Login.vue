<script setup>
import { ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { adminApi, setToken } from '../../api/request.js';
import { ENGINE_VERSION } from '../../utils/constants.js';

const route = useRoute();
const router = useRouter();

const password = ref('');
const loading = ref(false);
const error = ref('');

async function submit() {
  if (!password.value) {
    error.value = '请输入密码';
    return;
  }
  loading.value = true;
  error.value = '';
  try {
    const data = await adminApi.login(password.value);
    setToken(data.token);
    const raw = String(route.query.redirect || '');
    const redirect = (raw.startsWith('/') && !raw.startsWith('//') && raw.indexOf('://') < 0)
      ? raw
      : '/admin/data';
    router.replace(redirect);
  } catch (e) {
    error.value = e.message || String(e);
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <div class="login-page">
    <div class="login-card">
      <div class="login-brand">
        <span class="login-logo">ETF</span>
        <span class="login-sub">仓位决策 {{ ENGINE_VERSION }} · 后台管理</span>
      </div>
      <form class="login-form" @submit.prevent="submit">
        <div class="form-row">
          <label class="form-label">登录密码</label>
          <input
            v-model="password"
            type="password"
            class="input"
            placeholder="请输入后台登录密码"
            autofocus
            @keyup.enter="submit"
          />
        </div>
        <div v-if="error" class="login-error">{{ error }}</div>
        <button type="submit" class="btn primary login-btn" :disabled="loading">
          {{ loading ? '登录中…' : '登录' }}
        </button>
      </form>
      <router-link to="/dashboard" class="login-back">← 返回前台</router-link>
    </div>
  </div>
</template>

<style scoped>
.login-page {
  min-height: 100vh; min-height: 100dvh; display: flex; align-items: center; justify-content: center;
  background: var(--c-bg);
  padding: max(16px, env(safe-area-inset-top)) max(16px, env(safe-area-inset-right)) max(16px, env(safe-area-inset-bottom)) max(16px, env(safe-area-inset-left));
  box-sizing: border-box;
}
.login-card {
  width: 340px; max-width: 90vw; background: #fff;
  border: 1px solid var(--c-border); border-radius: 12px; padding: 32px 28px;
  box-shadow: 0 8px 24px rgba(0,0,0,.06);
}
.login-brand { display: flex; align-items: baseline; gap: 8px; margin-bottom: 24px; }
.login-logo { font-size: 22px; font-weight: 700; letter-spacing: 1px; color: var(--c-primary); }
.login-sub { font-size: 12px; color: var(--c-text-2); }
.login-form { margin-bottom: 16px; }
.login-error { color: var(--c-bad); font-size: 12px; margin-bottom: 12px; }
.login-btn { width: 100%; justify-content: center; }
.login-back { font-size: 12px; color: var(--c-text-2); text-decoration: none; }
@media (hover: hover) {
  .login-back:hover { color: var(--c-primary); }
}
</style>
