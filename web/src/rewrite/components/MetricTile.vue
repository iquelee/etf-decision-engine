<script setup>
defineProps({
  label:{type:String,required:true},
  value:{type:[String,Number],default:'—'},
  note:{type:String,default:''},
  tone:{type:String,default:'neutral'},
  compact:{type:Boolean,default:false}
});
</script>
<template>
  <div class="metric-tile" :class="[tone,{compact}]">
    <div class="metric-label">{{ label }}</div>
    <div class="metric-value">{{ value }}</div>
    <div v-if="note" class="metric-note">{{ note }}</div>
  </div>
</template>
