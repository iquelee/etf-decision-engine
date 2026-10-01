<script setup>
/**
 * 来源与回退说明行（web/src/rewrite/components/domain/ProvenanceLine.vue）
 * 规范依据：SPEC §2（provenance）/ §6.3（canonical > legacy > 未提供）
 *
 * ★ 目的：让「这个数字从哪来」在 UI 上始终可见。
 *   ⛔ 非 canonical 通道（runtime_status / legacy）**必须显著标注**，
 *      不得让用户把兼容读取误当成正式契约。
 */
defineProps({
  /** 来源标识（mono 小字），如 `api:/api/dashboard.overview.market_regime` */
  source: { type: String, default: '' },
  /** 通道名（如「正式契约」/「运行时状态」/「历史兼容字段」） */
  channelText: { type: String, default: '' },
  /** 通道警示（非契约通道时非空） */
  channelNote: { type: String, default: '' },
  /** 取数时刻文案 */
  retrievedAt: { type: String, default: '' }
});
</script>

<template>
  <div class="prov-line">
    <span v-if="channelText" class="badge outline sm">{{ channelText }}</span>
    <span v-if="source" class="prov-src" :title="source">{{ source }}</span>
    <span v-if="retrievedAt">取数 {{ retrievedAt }}</span>
    <span v-if="channelNote" class="text-3">· {{ channelNote }}</span>
  </div>
</template>
