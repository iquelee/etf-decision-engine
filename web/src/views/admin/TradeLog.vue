<script setup>
import { ref, computed, onMounted } from 'vue';
import { api, adminApi } from '../../api/request.js';
import { formatShares, formatPrice, formatPercent } from '../../utils/format.js';
import { etfName } from '../../utils/etf.js';

const loading = ref(true);
const error = ref('');
const trades = ref([]);
const etfs = ref([]);

const filter = ref({ code: '', action: '' });
const showModal = ref(false);
const editing = ref(null); // null=新增，否则为编辑对象
const form = ref({ trade_date: '', code: '', action: 'buy', shares: '', price: '', position_after: '', reason: '' });

// 账户快照（总资产/浮盈）——前台「总览-浮盈」卡片的唯一数据源
const snapshotForm = ref({ total_asset: '', total_pnl: '' });
const snapshotMsg = ref('');
const snapshotSaving = ref(false);
async function saveSnapshot() {
  const asset = Number(snapshotForm.value.total_asset);
  const pnl = snapshotForm.value.total_pnl === '' ? null : Number(snapshotForm.value.total_pnl);
  if (Number.isNaN(asset) && pnl == null) { snapshotMsg.value = '总资产或浮盈至少填一个（数字）'; return; }
  snapshotSaving.value = true;
  snapshotMsg.value = '';
  try {
    const body = {};
    if (!Number.isNaN(asset) && snapshotForm.value.total_asset !== '') body.total_asset = asset;
    if (pnl != null) body.total_pnl = pnl;
    const res = await adminApi.portfolioSnapshot(body);
    snapshotMsg.value = `已保存（${res.snapshot_date}）` +
      (res.cash_balance != null ? ` · 现金 ${res.cash_balance} 元` : '');
  } catch (e) {
    snapshotMsg.value = `保存失败：${e.message || e}`;
  } finally {
    snapshotSaving.value = false;
  }
}

const filtered = computed(() => trades.value.filter((t) => {
  if (filter.value.code && t.code !== filter.value.code) return false;
  if (filter.value.action && t.action !== filter.value.action) return false;
  return true;
}));

async function load() {
  loading.value = true;
  error.value = '';
  try {
    const res = await adminApi.tradeList();
    trades.value = res.list || [];
  } catch (e) {
    error.value = e.message || String(e);
  } finally {
    loading.value = false;
  }
}

async function loadEtfs() {
  try {
    const res = await api.etfList();
    etfs.value = res.list || [];
  } catch (e) { /* 忽略 */ }
}

async function loadSnapshot() {
  try {
    const d = await api.dashboard();
    const ov = d && d.overview;
    if (!ov) return;
    if (ov.total_asset != null) snapshotForm.value.total_asset = ov.total_asset;
    if (ov.total_pnl != null) snapshotForm.value.total_pnl = ov.total_pnl;
  } catch (e) { /* 忽略 */ }
}

function openCreate() {
  editing.value = null;
  form.value = { trade_date: new Date().toISOString().slice(0, 10), code: etfs.value.length ? etfs.value[0].code : '', action: 'buy', shares: '', price: '', position_after: '', reason: '' };
  showModal.value = true;
}

function openEdit(t) {
  editing.value = t;
  form.value = {
    trade_date: t.trade_date, code: t.code, action: t.action,
    shares: t.shares, price: t.price, position_after: t.position_after != null ? t.position_after : '', reason: t.reason || ''
  };
  showModal.value = true;
}

async function save() {
  if (!form.value.reason) { window.alert('原因必填'); return; }
  if (!form.value.trade_date || !form.value.code || !form.value.shares || !form.value.price) {
    window.alert('日期/ETF/数量/价格必填'); return;
  }
  const body = {
    trade_date: form.value.trade_date,
    code: form.value.code,
    action: form.value.action,
    shares: Number(form.value.shares),
    price: Number(form.value.price),
    amount: Number(form.value.shares) * Number(form.value.price),
    position_after: form.value.position_after !== '' ? Number(form.value.position_after) : undefined,
    reason: form.value.reason
  };
  try {
    let res;
    if (editing.value) {
      res = await adminApi.tradeUpdate({ _id: editing.value._id, ...body });
    } else {
      res = await adminApi.tradeCreate(body);
    }
    showModal.value = false;
    await load();
    // 仓位联动结果提示（自动算仓 / 手动填 / 失败原因）
    const sync = res && res.sync;
    if (sync) {
      if (sync.ok && !sync.manual) {
        window.alert(`已自动计算仓位：当前 ${sync.position}%（持仓 ${sync.shares} 份 × 现价 ${sync.price} ÷ 活分母 ${sync.total_asset}）`);
      } else if (sync.ok && sync.manual) {
        window.alert(`已按手动填写更新仓位：当前 ${sync.position}%`);
      } else {
        window.alert(`操作已保存，但自动算仓未生效：${sync.error || '未知原因'}`);
      }
    }
  } catch (e) {
    error.value = e.message || String(e);
  }
}

async function remove(t) {
  if (!window.confirm(`确认删除 ${t.trade_date} ${etfName(t.code, etfs.value)}（${t.code}） ${t.action === 'buy' ? '买入' : '卖出'} ${t.shares} 份？\n删除将影响复盘偏差统计。`)) return;
  try {
    await adminApi.tradeDelete(t._id);
    await load();
  } catch (e) {
    error.value = e.message || String(e);
  }
}

onMounted(() => { load(); loadEtfs(); loadSnapshot(); });
</script>

<template>
  <div>
    <div v-if="error" class="warning-bar">{{ error }}</div>

    <!-- 账户快照：前台「总览」卡片的 总资产/浮盈 数据源（原后台缺失录入入口，浮盈恒显示 —） -->
    <div class="card">
      <div class="card-title">账户快照（总资产 / 浮盈）</div>
      <div class="flex gap-8 mb-8" style="align-items:flex-end; flex-wrap:wrap">
        <div>
          <div class="field-label">总资产（元）</div>
          <input v-model="snapshotForm.total_asset" type="number" class="input" style="width:160px" placeholder="如 100000" />
        </div>
        <div>
          <div class="field-label">浮盈（元，可留空）</div>
          <input v-model="snapshotForm.total_pnl" type="number" class="input" style="width:160px" placeholder="如 3500" />
        </div>
        <button class="btn primary" :disabled="snapshotSaving" @click="saveSnapshot">{{ snapshotSaving ? '保存中…' : '保存' }}</button>
        <span v-if="snapshotMsg" class="snapshot-msg">{{ snapshotMsg }}</span>
      </div>
      <div class="muted" style="font-size:12px">填「总资产」会按当前持股市值反推现金并落库。之后行情涨跌由引擎把总资产改成「市值+现金」，现金只随买卖变。不会改回测，也不会因为没现金而拒加仓。</div>
    </div>

    <div class="card">
      <div class="card-title flex-between">
        操作记录
        <button class="btn primary" @click="openCreate">新增操作</button>
      </div>

      <div class="filter-bar flex gap-8 mb-8">
        <select v-model="filter.code" class="select" style="width:220px">
          <option value="">全部 ETF</option>
          <option v-for="e in etfs" :key="e.code" :value="e.code">{{ e.name }}（{{ e.code }}）</option>
        </select>
        <select v-model="filter.action" class="select" style="width:120px">
          <option value="">全部动作</option>
          <option value="buy">买入</option>
          <option value="sell">卖出</option>
        </select>
      </div>

      <div v-if="loading" class="empty">加载中…</div>
      <table v-else-if="filtered.length" class="table">
        <thead>
          <tr><th>日期</th><th>标的</th><th>动作</th><th>数量(份)</th><th>价格</th><th>操作后仓位</th><th>原因</th><th>操作</th></tr>
        </thead>
        <tbody>
          <tr v-for="t in filtered" :key="t._id">
            <td>{{ t.trade_date }}</td>
            <td><span class="etf-cell"><span class="etf-name">{{ etfName(t.code, etfs) }}</span><span class="etf-code">{{ t.code }}</span></span></td>
            <td><span class="badge" :class="t.action === 'buy' ? 'good' : 'bad'">{{ t.action === 'buy' ? '买入' : '卖出' }}</span></td>
            <td>{{ formatShares(t.shares) }}</td>
            <td>{{ formatPrice(t.price) }}</td>
            <td>{{ formatPercent(t.position_after) }}</td>
            <td class="text-small text-2">{{ t.reason || '—' }}</td>
            <td>
              <button class="btn" @click="openEdit(t)">编辑</button>
              <button class="btn danger" @click="remove(t)">删除</button>
            </td>
          </tr>
        </tbody>
      </table>
      <div v-else class="empty">暂无操作记录</div>
    </div>

    <!-- 弹窗 -->
    <div v-if="showModal" class="modal-mask" @click.self="showModal = false">
      <div class="modal">
        <div class="modal-title">{{ editing ? '编辑操作' : '新增操作' }}</div>
        <div class="grid-2">
          <div class="form-row"><label class="form-label">日期 *</label><input v-model="form.trade_date" type="date" class="input" /></div>
          <div class="form-row">
            <label class="form-label">ETF *</label>
            <select v-model="form.code" class="select">
              <option v-for="e in etfs" :key="e.code" :value="e.code">{{ e.name }}（{{ e.code }}）</option>
            </select>
          </div>
          <div class="form-row">
            <label class="form-label">动作 *</label>
            <select v-model="form.action" class="select">
              <option value="buy">买入</option>
              <option value="sell">卖出</option>
            </select>
          </div>
          <div class="form-row"><label class="form-label">数量(份) *</label><input v-model="form.shares" type="number" class="input" /></div>
          <div class="form-row"><label class="form-label">价格 *</label><input v-model="form.price" type="number" step="any" class="input" /></div>
          <div class="form-row"><label class="form-label">操作后仓位%（选填）</label><input v-model="form.position_after" type="number" step="any" class="input" placeholder="留空则按 持仓份数×最新价÷总资金 自动计算" /></div>
        </div>
        <div class="form-row"><label class="form-label">原因 *</label><textarea v-model="form.reason" class="textarea" placeholder="必填，如：横盘缩量加仓 / 风险熔断减仓"></textarea></div>
        <div class="text-small text-2" style="margin:-8px 0 4px">💡 留空「操作后仓位%」时，系统按「持仓份数 × 最新价 ÷ 总资金」自动算仓位并同步（需先在后台录总资金）；填了则用你填的值。</div>
        <div class="flex gap-8 mt-12">
          <button class="btn primary" @click="save">保存</button>
          <button class="btn" @click="showModal = false">取消</button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.modal-mask { position: fixed; inset: 0; background: rgba(0,0,0,.4); display: flex; align-items: center; justify-content: center; z-index: 100; }
.modal { background: #fff; border-radius: 10px; padding: 20px; width: 560px; max-width: 90vw; max-height: 85vh; overflow-y: auto; }
.modal-title { font-size: 16px; font-weight: 600; margin-bottom: 16px; }
@media (max-width: 768px) {
  .modal-mask { align-items: flex-end; padding-bottom: env(safe-area-inset-bottom, 0px); }
  .modal {
    width: 100%; max-width: 100%; max-height: min(90vh, 100dvh - 24px);
    border-radius: 14px 14px 0 0; padding: 16px 16px calc(16px + env(safe-area-inset-bottom, 0px));
  }
  .grid-2 { grid-template-columns: 1fr; }
  .filter-bar .select { width: 100% !important; }
}
.snapshot-msg { font-size: 13px; color: #059669; }
.muted { color: #9ca3af; }
.field-label { font-size: 12px; color: var(--c-text-2); margin-bottom: 4px; }
</style>
