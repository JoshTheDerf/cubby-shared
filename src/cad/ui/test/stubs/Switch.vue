<template><input class="uswitch" type="checkbox" :checked="modelValue" @change="$emit('update:modelValue', ($event.target as HTMLInputElement).checked)" /></template>
<script setup lang="ts">defineProps<{ modelValue?: boolean; size?: string }>(); defineEmits<{ 'update:modelValue': [v: boolean] }>();</script>
