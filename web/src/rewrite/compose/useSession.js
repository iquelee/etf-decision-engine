/**
 * 会话/鉴权 组合式 hook（web/src/rewrite/compose/useSession.js）
 * 规范依据：docs/V365_PROJECT_FUNCTION_AND_FRONTEND_REWRITE_SPEC.md §2.2 / §8
 *
 * 为什么需要这一层：
 *   SPEC §2.2 规定 `views/` `components/`（以及本轮同样纳入的 `layouts/`）
 *   ⛔ 不得 import `api/` 或 `adapters/`。会话与登录属数据访问，必须经 `compose/` 暴露。
 *   ⇒ 本文件是**唯一**允许 import `api.js` 的地方之一（另一个是 app 级装配）。
 *
 * M1 范围：会话读写 + 登录 + 登出。
 * M2 会把 401 语义集中到这里（SPEC §8.3），届时 `api.js` 不再直接改 location。
 */
import { ref, computed } from 'vue';
import { getToken, setToken, admin } from '../api.js';

/** 非响应式：给 router 守卫这类非组件上下文使用 */
export function isAuthed() {
  return !!getToken();
}

/** 响应式会话状态（组件内使用） */
export function useSession() {
  const token = ref(getToken() || '');
  const authed = computed(() => !!token.value);

  function refresh() {
    token.value = getToken() || '';
  }

  /**
   * 登录。⛔ 不记录、不落盘密码；成功后只保存 token。
   * @returns {Promise<{ok:true}>}
   */
  async function login(password) {
    const res = await admin.login(password);
    const t = res && res.token;
    if (!t) throw new Error('登录响应缺少 token');
    setToken(t);
    refresh();
    return { ok: true };
  }

  /** 登出：即便后端登出失败也清本地 token，避免残留会话 */
  async function logout() {
    try {
      await admin.logout();
    } catch (e) {
      /* 见上：忽略后端失败 */
    }
    setToken(null);
    refresh();
  }

  return { token, authed, refresh, login, logout };
}
