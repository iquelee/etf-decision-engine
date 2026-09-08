/**
 * 给横向可滚的 .table 包一层 .table-wrap，右侧渐隐提示「还能往右滑」。
 * 滚到最右或无需滚动时加 .at-right / .no-overflow。
 */
'use strict';

function syncWrap(wrap, scroller) {
  const max = scroller.scrollWidth - scroller.clientWidth;
  const noOverflow = max <= 1;
  const atRight = noOverflow || scroller.scrollLeft >= max - 1;
  wrap.classList.toggle('no-overflow', noOverflow);
  wrap.classList.toggle('at-right', atRight);
}

function bindTable(table) {
  if (table.dataset.scrollHintBound === '1') return;
  table.dataset.scrollHintBound = '1';

  let wrap = table.parentElement;
  if (!wrap || !wrap.classList.contains('table-wrap')) {
    wrap = document.createElement('div');
    wrap.className = 'table-wrap';
    table.parentNode.insertBefore(wrap, table);
    wrap.appendChild(table);
  }

  const onScroll = () => syncWrap(wrap, wrap);
  wrap.addEventListener('scroll', onScroll, { passive: true });
  if (typeof ResizeObserver !== 'undefined') {
    const ro = new ResizeObserver(() => syncWrap(wrap, wrap));
    ro.observe(wrap);
    ro.observe(table);
  }
  syncWrap(wrap, wrap);
}

export function enhanceTableScrollHints(root = document) {
  root.querySelectorAll('table.table').forEach(bindTable);
}

export function installTableScrollHints() {
  const run = () => enhanceTableScrollHints();
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', run, { once: true });
  } else {
    run();
  }
  const mo = new MutationObserver(() => run());
  mo.observe(document.documentElement, { childList: true, subtree: true });
  window.addEventListener('resize', run, { passive: true });
  return () => {
    mo.disconnect();
    window.removeEventListener('resize', run);
  };
}
