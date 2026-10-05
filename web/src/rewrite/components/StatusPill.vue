<script setup>
defineProps({
  text:{type:String,default:'—'},
  tone:{type:String,default:'muted'},
  dot:{type:Boolean,default:true}
});
</script>
<template>
  <span class="status-pill" :class="tone">
    <span v-if="dot" class="status-dot"></span>{{ text }}
  </span>
</template>
