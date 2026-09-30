<template><input class="uinput" :value="modelValue" @input="$emit('update:modelValue', ($event.target as HTMLInputElement).value)" /></template>
<script setup lang="ts">defineProps<{ modelValue?: string | number; size?: string }>(); defineEmits<{ 'update:modelValue': [v: string] }>();</script>
