<script setup>
defineProps({
  title:{type:String,required:true},
  eyebrow:{type:String,default:''},
  subtitle:{type:String,default:''}
});
</script>
<template>
  <div class="section-head">
    <div>
      <div v-if="eyebrow" class="eyebrow">{{ eyebrow }}</div>
      <h2>{{ title }}</h2>
      <p v-if="subtitle">{{ subtitle }}</p>
    </div>
    <slot name="actions"></slot>
  </div>
</template>
