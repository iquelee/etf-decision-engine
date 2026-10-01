<script setup>
/**
 * 后台外壳（web/src/rewrite/）
 * 规范依据：SPEC §5 / §8 / §12 / §13
 *
 * 硬性要求：
 *  - 菜单与 router.js 的 ADMIN_NAV **单一来源**（分组结构），⛔ 不在模板里硬编码；
 *  - 显式声明「非自动交易」边界（§1.1）；
 *  - ⛔ 无渐变、无 backdrop-filter（§12.3）。
 */
import { ref, computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ADMIN_NAV } from '../routes.js';
import { useSession } from '../compose/useSession.js';

const route = useRoute();
const router = useRouter();
const session = useSession();

const drawer = ref(false);

const groups = computed(() => ADMIN_NAV);

function isActive(path) {
  return route.path === path || route.path.startsWith(path + '/');
}

async function logout() {
  drawer.value = false;
  await session.logout();
  router.replace('/login');
}
</script>

<template>
  <div class="layout">
    <div v-if="drawer" class="mask" @click="drawer = false"></div>

    <aside class="sidebar" :class="{ open: drawer }">
      <div class="side-brand">
        <div class="side-mark">ETF</div>
        <div class="side-title">后台管理</div>
      </div>

      <RouterLink to="/dashboard" class="back" @click="drawer = false">← 返回前台</RouterLink>

      <nav class="side-nav">
        <template v-for="g in groups" :key="g.group">
          <div class="group-label">{{ g.group }}</div>
          <RouterLink
            v-for="m in g.items"
            :key="m.path"
            :to="m.path"
            class="nav-item"
            :class="{ active: isActive(m.path) }"
            @click="drawer = false"
          >{{ m.title }}</RouterLink>
        </template>
      </nav>

      <div class="side-foot">
        <RouterLink
          to="/admin/password"
          class="foot-link"
          :class="{ active: isActive('/admin/password') }"
          @click="drawer = false"
        >修改密码</RouterLink>
        <button class="foot-link foot-danger" @click="logout">退出登录</button>
        <div class="side-tag">非预测 · 非自动交易</div>
      </div>
    </aside>

    <div class="body">
      <header class="topbar">
        <div class="topbar-left">
          <button class="hamburger" aria-label="打开菜单" @click="drawer = true">≡</button>
          <h1 class="topbar-title">{{ route.meta.title || '后台管理' }}</h1>
        </div>
        <span class="tag">后台</span>
      </header>

      <main class="content">
        <RouterView />
      </main>
    </div>
  </div>
</template>

<style scoped>
.layout { display: flex; height: 100vh; height: 100dvh; overflow: hidden; }

/* ---------- 侧栏 ---------- */
.sidebar {
  width: var(--sidebar-w); flex-shrink: 0;
  display: flex; flex-direction: column;
  background: #111827; color: #e5e7eb;
  padding-top: env(safe-area-inset-top, 0px);
  padding-bottom: env(safe-area-inset-bottom, 0px);
}
.side-brand { padding: var(--sp-4) var(--sp-4) var(--sp-3); border-bottom: 1px solid #1f2937; }
.side-mark { font-family: var(--font-en); font-size: var(--fs-16); font-weight: var(--fw-bold); letter-spacing: .05em; }
.side-title { font-size: var(--fs-11); color: #9ca3af; margin-top: 2px; }

.back {
  margin: var(--sp-2) var(--sp-2) 0; padding: var(--sp-2) var(--sp-3);
  font-size: var(--fs-13); color: #93c5fd; text-decoration: none; border-radius: var(--r-md);
}
.back:hover { background: #1f2937; color: #fff; text-decoration: none; }

.side-nav { flex: 1 1 auto; padding: var(--sp-2) var(--sp-2) var(--sp-3); overflow-y: auto; }
.group-label { font-size: var(--fs-11); color: #6b7280; padding: var(--sp-3) var(--sp-2) var(--sp-1); }
.nav-item {
  display: block; padding: var(--sp-2) var(--sp-3); margin-bottom: 2px;
  border-radius: var(--r-md); font-size: var(--fs-13);
  color: #d1d5db; text-decoration: none;
}
.nav-item:hover { background: #1f2937; color: #fff; text-decoration: none; }
.nav-item.active { background: var(--c-accent); color: #fff; }

.side-foot { padding: var(--sp-3) var(--sp-4); border-top: 1px solid #1f2937; }
.foot-link {
  display: block; width: 100%; text-align: left;
  background: none; border: none; cursor: pointer;
  padding: var(--sp-2) 0; font-size: var(--fs-12);
  color: #9ca3af; text-decoration: none; min-height: 36px;
}
.foot-link:hover { color: #fff; text-decoration: none; }
.foot-link.active { color: #fff; font-weight: var(--fw-semibold); }
.foot-danger { color: #fca5a5; }
.foot-danger:hover { color: #f87171; }
.side-tag { font-size: var(--fs-11); color: #6b7280; margin-top: var(--sp-1); }

/* ---------- 主区 ---------- */
.body { flex: 1 1 auto; display: flex; flex-direction: column; overflow: hidden; min-width: 0; }
.topbar {
  flex-shrink: 0; display: flex; align-items: center; justify-content: space-between;
  background: var(--c-surface); border-bottom: 1px solid var(--c-border);
  padding: 0 var(--sp-5);
  padding-top: env(safe-area-inset-top, 0px);
  height: calc(var(--nav-h) + env(safe-area-inset-top, 0px));
}
.topbar-left { display: flex; align-items: center; gap: var(--sp-3); min-width: 0; }
.topbar-title {
  font-size: var(--fs-16); font-weight: var(--fw-semibold); color: var(--c-text);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.tag {
  flex-shrink: 0; font-size: var(--fs-11); color: var(--c-text-2);
  background: var(--c-surface-2); border-radius: var(--r-pill); padding: 3px var(--sp-2);
}
.content {
  flex: 1 1 auto; overflow-y: auto; padding: var(--sp-5);
  background: var(--c-bg);
  padding-bottom: calc(var(--sp-5) + env(safe-area-inset-bottom, 0px));
}

.hamburger {
  display: none; align-items: center; justify-content: center;
  min-width: var(--touch-min); min-height: var(--touch-min);
  background: none; border: none; cursor: pointer; border-radius: var(--r-md);
  font-size: var(--fs-20); line-height: 1; color: var(--c-text);
}
.mask { display: none; }

@media (max-width: 1100px) {
  .sidebar { width: var(--sidebar-w-tablet); }
  .content { padding: var(--sp-4); padding-bottom: calc(var(--sp-4) + env(safe-area-inset-bottom, 0px)); }
}

@media (max-width: 900px) {
  .hamburger { display: inline-flex; }
  .sidebar {
    position: fixed; top: 0; left: 0; bottom: 0;
    z-index: var(--z-drawer); width: var(--sidebar-w-mobile);
    transform: translateX(-100%);
    transition: transform var(--tr-base);
  }
  .sidebar.open { transform: translateX(0); }
  .mask {
    display: block; position: fixed; inset: 0;
    background: rgba(0, 0, 0, .4); z-index: calc(var(--z-drawer) - 10);
  }
  .nav-item { min-height: var(--touch-min); display: flex; align-items: center; font-size: var(--fs-14); }
  .back { min-height: var(--touch-min); display: flex; align-items: center; }
  .content { padding: var(--sp-3); padding-bottom: calc(var(--sp-3) + env(safe-area-inset-bottom, 0px)); }
}
</style>
