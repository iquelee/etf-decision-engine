<script setup>
/**
 * 前台外壳（web/src/rewrite/）
 * 规范依据：SPEC §4.1 / §12 / §13 / §8.4
 *
 * 硬性要求：
 *  - 导航项与 router.js 的 FRONT_NAV **单一来源**，⛔ 不在模板里硬编码菜单；
 *  - 受限页（复盘）未登录时**显式显示锁标**（§8.4：不静默）；
 *  - ⛔ 无渐变、无 backdrop-filter（§12.3）。
 */
import { computed, watch, onMounted } from 'vue';
import { useRoute } from 'vue-router';
import { FRONT_NAV } from '../routes.js';
import { useSession } from '../compose/useSession.js';

const route = useRoute();
const session = useSession();

function refreshAuth() { session.refresh(); }

onMounted(refreshAuth);
watch(() => route.fullPath, refreshAuth);

const nav = computed(() => FRONT_NAV.map((m) => ({
  ...m,
  locked: m.needsAuth && !session.authed.value
})));

// '/etf' 需命中 '/etf/513310'；'/structure' 同理
function isActive(path) {
  return route.path === path || route.path.startsWith(path + '/');
}
</script>

<template>
  <div class="front">
    <header class="nav">
      <div class="nav-inner">
        <div class="brand">
          <span class="brand-mark">ETF</span>
          <span class="brand-title">仓位决策</span>
        </div>

        <nav class="menu" aria-label="前台导航">
          <RouterLink
            v-for="m in nav"
            :key="m.path"
            :to="m.path"
            class="item"
            :class="{ active: isActive(m.path) }"
          >
            {{ m.title }}<span v-if="m.locked" class="lock" title="需登录">·锁</span>
          </RouterLink>
        </nav>

        <div class="right">
          <RouterLink to="/admin/data" class="admin-link">后台</RouterLink>
        </div>
      </div>
    </header>

    <main class="main">
      <div class="content">
        <RouterView />
      </div>
    </main>
  </div>
</template>

<style scoped>
.front { min-height: 100vh; background: var(--c-bg); }

.nav {
  position: sticky; top: 0;
  z-index: var(--z-nav);
  background: var(--c-surface);
  border-bottom: 1px solid var(--c-border);
}
.nav-inner {
  max-width: var(--content-max); margin: 0 auto;
  padding: 0 var(--sp-5);
  height: var(--nav-h); display: flex; align-items: center; gap: var(--sp-6);
}
.brand { display: flex; align-items: baseline; gap: var(--sp-2); flex-shrink: 0; }
.brand-mark {
  font-family: var(--font-en);
  font-size: var(--fs-13); font-weight: var(--fw-bold); letter-spacing: .04em;
  color: var(--c-surface); background: var(--c-accent);
  border-radius: var(--r-sm); padding: 3px 7px;
}
.brand-title { font-size: var(--fs-13); font-weight: var(--fw-semibold); color: var(--c-text); }

.menu { display: flex; align-items: center; gap: var(--sp-1); flex: 1 1 auto; overflow-x: auto; }
.item {
  flex-shrink: 0; white-space: nowrap;
  padding: 6px var(--sp-3); border-radius: var(--r-md);
  font-size: var(--fs-14); color: var(--c-text-2);
  text-decoration: none;
}
.item.active { color: var(--c-accent); font-weight: var(--fw-semibold); background: var(--tone-accent-bg); }
.item:hover { text-decoration: none; }
.lock { font-size: var(--fs-11); color: var(--c-text-3); }

.right { flex-shrink: 0; }
.admin-link {
  font-size: var(--fs-12); color: var(--c-text-2); text-decoration: none;
  border: 1px solid var(--c-border); border-radius: var(--r-md);
  padding: 5px var(--sp-3);
}
.admin-link:hover { text-decoration: none; border-color: var(--c-accent); color: var(--c-accent); }

.main { padding: var(--sp-5) 0 var(--sp-8); }
.content { max-width: var(--content-max); margin: 0 auto; padding: 0 var(--sp-5); }

@media (min-width: 1800px) {
  .nav-inner, .content { max-width: var(--content-max-xl); }
}

@media (max-width: 768px) {
  .nav-inner {
    height: auto; flex-wrap: wrap; gap: 0;
    padding: calc(var(--sp-2) + env(safe-area-inset-top, 0px)) var(--sp-3) var(--sp-2);
  }
  .brand { order: 1; }
  .right { order: 2; margin-left: auto; }
  .menu {
    order: 3; flex: 0 0 100%; padding-top: var(--sp-2);
    -webkit-overflow-scrolling: touch; scrollbar-width: none;
    touch-action: pan-x;
  }
  .menu::-webkit-scrollbar { display: none; }
  .item {
    min-height: var(--touch-min); display: inline-flex; align-items: center;
    padding: var(--sp-2) var(--sp-3);
  }
  .admin-link { min-height: var(--touch-min); display: inline-flex; align-items: center; }
  .content { padding: 0 var(--sp-3); }
  .main { padding: var(--sp-3) 0 calc(var(--sp-8) + env(safe-area-inset-bottom, 0px)); }
}
</style>
