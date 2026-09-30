<template>
  <select class="uselect" :value="modelValue" @change="$emit('update:modelValue', ($event.target as HTMLSelectElement).value)">
    <option v-for="i in items" :key="i.value" :value="i.value">{{ i.label }}</option>
  </select>
</template>
<script setup lang="ts">defineProps<{ modelValue?: string; items?: Array<{ label: string; value: string }>; valueKey?: string; size?: string }>(); defineEmits<{ 'update:modelValue': [v: string] }>();</script>
