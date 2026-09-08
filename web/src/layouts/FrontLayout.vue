<script setup>
import { computed } from 'vue';
import { useRoute } from 'vue-router';

const route = useRoute();

// 前台导航菜单（与 router/index.js 前台子路由保持一致）
const frontMenus = [
  { path: '/dashboard', title: '全局' },
  { path: '/fundamentals', title: '基本面' },
  { path: '/structure', title: '看盘' },
  { path: '/etf', title: '执行' },
  { path: '/review', title: '历史' }
];

const today = computed(() => {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
});

// 精确匹配 + 子路径匹配（/etf 需命中 /etf/:code）
const isActive = (path) => route.path === path || route.path.startsWith(path + '/');
</script>

<template>
  <div class="front-layout">
    <header class="topnav">
      <div class="topnav-inner">
        <div class="brand">
          <span class="brand-logo">ETF</span>
          <span class="brand-sub">ETF 决策 · Gen-1 趋势启动增强</span>
        </div>
        <nav class="topnav-menu">
          <router-link
            v-for="m in frontMenus"
            :key="m.path"
            :to="m.path"
            class="topnav-link"
            :class="{ active: isActive(m.path) }"
          >{{ m.title }}</router-link>
        </nav>
        <div class="topnav-right">
          <span class="topnav-date">{{ today }}</span>
          <router-link to="/admin/data" class="topnav-admin">后台管理</router-link>
        </div>
      </div>
    </header>
    <main class="front-main">
      <div class="front-content">
        <router-view />
      </div>
    </main>
  </div>
</template>

<style scoped>
.front-layout {
  min-height: 100vh; --topnav-height: 58px;
  /* 右上角极淡品牌蓝晕，大面积底色不死板 */
  background:
    radial-gradient(1200px 420px at 72% -120px, rgba(37, 99, 235, .08), transparent 60%),
    var(--c-bg);
}
.topnav {
  position: sticky; top: 0; z-index: 50;
  background: rgba(255, 255, 255, .78);
  backdrop-filter: saturate(180%) blur(14px);
  -webkit-backdrop-filter: saturate(180%) blur(14px);
  border-bottom: 1px solid var(--c-border);
  box-shadow: 0 1px 3px rgba(16, 24, 40, .05);
}
.topnav-inner {
  max-width: var(--content-max, 1440px); margin: 0 auto; padding: 0 20px;
  height: 58px; display: flex; align-items: center; gap: 24px;
}
.brand { display: flex; align-items: center; gap: 10px; flex-shrink: 0; }
.brand-logo {
  display: flex; align-items: center; justify-content: center;
  width: 30px; height: 30px; border-radius: 8px;
  background: linear-gradient(135deg, #1d4ed8, #2563eb);
  color: #fff; font-size: 11px; font-weight: 800; letter-spacing: 0;
}
.brand-sub { font-size: 13px; font-weight: 600; color: var(--c-text); }
.topnav-menu { display: flex; align-items: center; gap: 4px; flex: 1; }
.topnav-link {
  padding: 7px 14px; border-radius: 8px; text-decoration: none;
  color: var(--c-text-2); font-size: 14px; transition: var(--transition);
}
.topnav-link.active {
  color: var(--c-primary); font-weight: 600; background: var(--c-primary-soft);
}
.topnav-right { display: flex; align-items: center; gap: 14px; flex-shrink: 0; }
.topnav-date { font-size: 12px; color: var(--c-text-2); }
.topnav-admin {
  font-size: 12px; color: var(--c-text-2); text-decoration: none;
  border: 1px solid var(--c-border); border-radius: 8px; padding: 5px 12px;
  transition: var(--transition); background: #fff;
}
.front-main { padding: 20px 0 40px; }
.front-content { max-width: var(--content-max, 1440px); margin: 0 auto; padding: 0 20px; }

@media (hover: hover) {
  .topnav-link:hover { color: var(--c-primary); background: var(--c-primary-soft); }
  .topnav-admin:hover { color: var(--c-primary); border-color: var(--c-primary); box-shadow: var(--shadow-sm); }
}

@media (max-width: 768px) {
  .front-layout { --topnav-height: 96px; }
  .topnav-inner {
    flex-wrap: wrap; gap: 0; height: auto;
    padding: calc(8px + env(safe-area-inset-top, 0px)) 12px 8px; row-gap: 4px;
  }
  .brand { order: 1; }
  .topnav-right { order: 2; margin-left: auto; gap: 0; }
  .topnav-date { display: none; }
  .topnav-menu {
    order: 3; flex: 0 0 100%;
    overflow-x: auto; -webkit-overflow-scrolling: touch;
    scrollbar-width: none; padding: 4px 0 6px;
    /* 避免横向滑动吞掉第一次点击 */
    touch-action: pan-x;
  }
  .topnav-menu::-webkit-scrollbar { display: none; }
  .topnav-link {
    flex-shrink: 0; white-space: nowrap;
    min-height: 40px; padding: 10px 14px;
    display: inline-flex; align-items: center;
  }
  .topnav-admin {
    min-height: 40px; display: inline-flex; align-items: center;
    padding: 8px 12px;
  }
  .front-main { padding: 12px 0 calc(32px + env(safe-area-inset-bottom, 0px)); }
  .front-content { padding: 0 12px; }
}

@media (min-width: 1800px) {
  .topnav-inner, .front-content { max-width: var(--content-max-xl, 1600px); }
}

</style>
