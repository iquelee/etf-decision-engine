<script setup>
import { ref, computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { adminApi, setToken } from '../api/request.js';
import { ENGINE_VERSION } from '../utils/constants.js';

const route = useRoute();
const router = useRouter();

// 移动端抽屉开关
const menuOpen = ref(false);

// 后台导航菜单（与 router/index.js 后台子路由保持一致）
const adminMenus = [
  { path: '/admin/gen1', title: 'Gen-1 运行状态' },
  { path: '/admin/gen2', title: '选池观察' },
  { path: '/admin/data', title: '数据管理' },
  { path: '/admin/param', title: '参数配置' },
  { path: '/admin/fundamental', title: '基本面录入' },
  { path: '/admin/risk', title: '风险事件' },
  { path: '/admin/trade', title: '操作记录' }
];

const today = computed(() => {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
});

const isActive = (path) => route.path.startsWith(path);

async function logout() {
  menuOpen.value = false;
  try {
    await adminApi.logout();
  } catch (e) {
    // 后端登出失败也强制清本地 token，避免残留会话
  }
  setToken(null);
  router.replace('/login');
}
</script>

<template>
  <div class="layout">
    <!-- 移动端遮罩 -->
    <div v-if="menuOpen" class="sidebar-mask" @click="menuOpen = false"></div>

    <!-- 左侧窄导航 -->
    <aside class="sidebar" :class="{ open: menuOpen }">
      <div class="brand">
        <div class="brand-logo">ETF</div>
        <div class="brand-sub">仓位决策 {{ ENGINE_VERSION }}</div>
      </div>
      <router-link to="/dashboard" class="nav-item back-front" @click="menuOpen = false">← 返回前台</router-link>
      <nav class="nav">
        <div class="nav-group-label">后台管理</div>
        <router-link
          v-for="m in adminMenus"
          :key="m.path"
          :to="m.path"
          class="nav-item"
          :class="{ active: isActive(m.path) }"
          @click="menuOpen = false"
        >{{ m.title }}</router-link>
      </nav>
      <div class="sidebar-foot">
        <router-link
          to="/admin/password"
          class="foot-link"
          :class="{ active: isActive('/admin/password') }"
          @click="menuOpen = false"
        >修改密码</router-link>
        <button class="foot-link foot-logout" @click="logout">退出登录</button>
        <div class="sidebar-tag">非预测 · 非自动交易</div>
      </div>
    </aside>

    <!-- 右侧主区 -->
    <div class="main">
      <header class="topbar">
        <div class="topbar-left">
          <button class="hamburger" aria-label="打开菜单" @click="menuOpen = true">☰</button>
          <div class="topbar-title">{{ route.meta.title || '后台管理' }}</div>
        </div>
        <div class="topbar-right">
          <span class="topbar-date">{{ today }}</span>
          <span class="topbar-tag">后台</span>
        </div>
      </header>
      <main class="content">
        <router-view />
      </main>
    </div>
  </div>
</template>

<style scoped>
.layout { display: flex; height: 100vh; height: 100dvh; overflow: hidden; }
.sidebar {
  width: 168px; flex-shrink: 0; background: #111827; color: #e5e7eb;
  display: flex; flex-direction: column;
  padding-top: env(safe-area-inset-top, 0px);
  padding-bottom: env(safe-area-inset-bottom, 0px);
}
.brand { padding: 18px 16px 14px; border-bottom: 1px solid #1f2937; }
.brand-logo { font-size: 20px; font-weight: 700; letter-spacing: 1px; }
.brand-sub { font-size: 11px; color: #9ca3af; margin-top: 2px; }
.back-front {
  margin: 10px 8px 0; color: #93c5fd; font-size: 13px;
  border-radius: 6px; padding: 8px 10px; text-decoration: none;
}
.nav { flex: 1; padding: 6px 8px 10px; overflow-y: auto; }
.nav-group-label { font-size: 11px; color: #6b7280; padding: 12px 8px 4px; }
.nav-item {
  display: block; padding: 8px 10px; border-radius: 6px; color: #d1d5db;
  text-decoration: none; font-size: 13px; margin-bottom: 2px; transition: all .15s;
}
.nav-item.active { background: #2563eb; color: #fff; }
.sidebar-foot { padding: 10px 16px 12px; border-top: 1px solid #1f2937; }
.foot-link {
  display: block; width: 100%; text-align: left; background: none; border: none;
  padding: 8px 0; cursor: pointer; color: #9ca3af; font-size: 12px;
  text-decoration: none; min-height: 36px;
}
.foot-link.active { color: #fff; font-weight: 600; }
.foot-logout { color: #fca5a5; }
.sidebar-tag { font-size: 11px; color: #6b7280; margin-top: 4px; }

.main { flex: 1; display: flex; flex-direction: column; overflow: hidden; min-width: 0; }
.topbar {
  height: 52px; flex-shrink: 0; background: #fff; border-bottom: 1px solid #e5e7eb;
  display: flex; align-items: center; justify-content: space-between; padding: 0 20px;
  padding-top: env(safe-area-inset-top, 0px);
  height: calc(52px + env(safe-area-inset-top, 0px));
}
.topbar-left { display: flex; align-items: center; gap: 10px; min-width: 0; }
.topbar-title { font-size: 16px; font-weight: 600; color: #111827; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.topbar-right { display: flex; align-items: center; gap: 12px; flex-shrink: 0; }
.topbar-date { font-size: 13px; color: #374151; }
.topbar-tag { font-size: 11px; color: #6b7280; background: #f3f4f6; padding: 3px 8px; border-radius: 10px; }
.content {
  flex: 1; overflow-y: auto; padding: 20px; background: #f9fafb;
  padding-bottom: calc(20px + env(safe-area-inset-bottom, 0px));
}

.hamburger {
  display: none; background: none; border: none; cursor: pointer;
  font-size: 20px; line-height: 1; color: #111827;
  min-width: 40px; min-height: 40px;
  align-items: center; justify-content: center; border-radius: 8px;
}
.sidebar-mask { display: none; }

/* 平板：侧栏略宽，内容仍并排 */
@media (max-width: 1100px) {
  .sidebar { width: 180px; }
  .content { padding: 16px; padding-bottom: calc(16px + env(safe-area-inset-bottom, 0px)); }
}

@media (max-width: 900px) {
  .hamburger { display: inline-flex; }
  .sidebar {
    position: fixed; top: 0; left: 0; bottom: 0; z-index: 100;
    width: 220px; transform: translateX(-100%);
    transition: transform .25s ease;
  }
  .sidebar.open { transform: translateX(0); }
  .sidebar-mask {
    display: block; position: fixed; inset: 0; background: rgba(0,0,0,.4); z-index: 90;
  }
  .nav-item { padding: 12px 12px; font-size: 14px; min-height: 44px; box-sizing: border-box; display: flex; align-items: center; }
  .back-front { min-height: 44px; display: flex; align-items: center; }
  .topbar { padding-left: 12px; padding-right: 12px; }
  .topbar-date { display: none; }
  .content {
    padding: 12px;
    padding-bottom: calc(12px + env(safe-area-inset-bottom, 0px));
  }
}

@media (max-width: 768px) {
  .topbar-title { font-size: 15px; }
}

@media (hover: hover) {
  .back-front:hover { background: #1f2937; color: #fff; }
  .nav-item:hover { background: #1f2937; color: #fff; }
  .foot-link:hover { color: #fff; }
  .foot-logout:hover { color: #f87171; }
  .hamburger:hover { background: #f3f4f6; }
}
</style>
