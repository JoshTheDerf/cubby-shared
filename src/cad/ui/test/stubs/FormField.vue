<template><div class="ufield"><label>{{ label }}</label><slot /></div></template>
<script setup lang="ts">defineProps<{ label?: string }>();</script>
