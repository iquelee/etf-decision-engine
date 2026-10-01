<script setup>
/**
 * 登录页 —— 后台入口
 *
 * SPEC          §5 账户与安全 · §8
 * 里程碑        M1（本页在 M1 即可用；M8 再做视觉收口）
 * 业务职责      密码登录；成功后按 `redirect` 回到来源页；改密后强制重登
 * 数据来源      POST /api/admin/login
 *
 * 安全约束（SPEC §8）：
 *  - ⛔ 不记录、不落盘密码；⛔ 不把密码写入日志或 URL；
 *  - redirect 白名单：仅接受站内绝对路径，防开放跳转；
 *  - 未登录访问受限页由 router 守卫引导到此页并保留来源（§8.4：不静默吞掉上下文）。
 */
import { ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useSession } from '../../compose/useSession.js';

const route = useRoute();
const router = useRouter();
const session = useSession();

const password = ref('');
const submitting = ref(false);
const error = ref('');

function safeRedirect(raw) {
  const s = String(raw || '');
  if (s.startsWith('/') && !s.startsWith('//') && s.indexOf('://') < 0) return s;
  return '/admin/data';
}

async function submit() {
  if (!password.value) { error.value = '请输入密码'; return; }
  submitting.value = true;
  error.value = '';
  try {
    await session.login(password.value);
    password.value = '';
    router.replace(safeRedirect(route.query.redirect));
  } catch (e) {
    // 仅回显后端 message；⛔ 不回显输入内容
    error.value = (e && e.message) || '登录失败';
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <div class="login-wrap">
    <form class="login-box" @submit.prevent="submit">
      <div class="login-head">
        <span class="mark">ETF</span>
        <span class="head-title">仓位决策 · 后台</span>
      </div>

      <label class="field">
        <span class="field-label">登录密码</span>
        <input
          v-model="password"
          type="password"
          class="input"
          autocomplete="current-password"
          placeholder="请输入后台登录密码"
          @keyup.enter="submit"
        />
      </label>

      <p v-if="error" class="err">{{ error }}</p>

      <button type="submit" class="btn" :disabled="submitting">
        {{ submitting ? '登录中…' : '登录' }}
      </button>

      <RouterLink to="/dashboard" class="back">← 返回前台</RouterLink>
    </form>
  </div>
</template>

<style scoped>
.login-wrap {
  min-height: 100vh; min-height: 100dvh;
  display: flex; align-items: center; justify-content: center;
  background: var(--c-bg);
  padding: max(var(--sp-4), env(safe-area-inset-top)) max(var(--sp-4), env(safe-area-inset-right))
           max(var(--sp-4), env(safe-area-inset-bottom)) max(var(--sp-4), env(safe-area-inset-left));
}
.login-box {
  width: 340px; max-width: 100%;
  background: var(--c-surface);
  border: 1px solid var(--c-border);
  border-radius: var(--r-lg);
  padding: var(--sp-6);
  box-shadow: var(--sh-2);
}
.login-head { display: flex; align-items: baseline; gap: var(--sp-2); margin-bottom: var(--sp-5); }
.mark {
  font-family: var(--font-en); font-size: var(--fs-16); font-weight: var(--fw-bold);
  letter-spacing: .05em; color: var(--c-surface); background: var(--c-accent);
  border-radius: var(--r-sm); padding: 3px 7px;
}
.head-title { font-size: var(--fs-13); color: var(--c-text-2); }

.field { display: block; margin-bottom: var(--sp-4); }
.field-label { display: block; font-size: var(--fs-13); color: var(--c-text-2); margin-bottom: var(--sp-1); }
.input {
  width: 100%; padding: var(--sp-2) var(--sp-3);
  border: 1px solid var(--c-border); border-radius: var(--r-md);
  background: var(--c-surface); outline: none;
  transition: border-color var(--tr-fast);
}
.input:focus { border-color: var(--c-focus); }

.err {
  font-size: var(--fs-12); color: var(--risk-red);
  background: var(--risk-red-bg); border-radius: var(--r-sm);
  padding: var(--sp-2) var(--sp-3); margin-bottom: var(--sp-3);
}

.btn {
  width: 100%; min-height: var(--touch-min);
  display: inline-flex; align-items: center; justify-content: center;
  background: var(--c-accent); color: #fff;
  border: 1px solid var(--c-accent); border-radius: var(--r-md);
  font-size: var(--fs-14); font-weight: var(--fw-semibold); cursor: pointer;
  transition: opacity var(--tr-fast);
}
.btn:disabled { opacity: .55; cursor: not-allowed; }

.back { display: inline-block; margin-top: var(--sp-4); font-size: var(--fs-12); color: var(--c-text-2); }
</style>
