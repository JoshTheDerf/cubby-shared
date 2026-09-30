<template>
  <div class="grid gap-1.5" :style="{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }">
    <button
      v-for="s in items"
      :key="s.id"
      type="button"
      class="flex flex-col items-center justify-center gap-1 rounded-md px-1 py-2 text-xs text-default ring-1 ring-inset ring-default bg-default hover:bg-elevated hover:ring-primary/40 transition-colors cursor-pointer select-none"
      :title="s.label"
      :data-shape="s.id"
      draggable="true"
      @click="emit('add', s.id)"
      @dragstart="onDragStart($event, s.id)"
    >
      <UIcon :name="s.icon" class="size-6 shrink-0" />
      <span class="w-full truncate text-center leading-tight">{{ s.label }}</span>
    </button>
  </div>
</template>

<script setup lang="ts">
/**
 * A grid of the shared built-in shapes (icon + label) in CubbyCAD's palette
 * order. Click emits `add(shapeId)`; dragging carries the id as
 * `application/x-cubby-shape` (and text/plain) for a drop target. UIcon comes
 * from the host app's Nuxt UI auto-import.
 */
import { computed } from 'vue';
import { paletteSharedShapes } from '../shapes';
import type { Translate } from '../schema';
import { useCadTranslate } from './translate';

const props = withDefaults(defineProps<{
  /** Limit / reorder to these shape ids (default: every palette shape). */
  shapes?: string[];
  columns?: number;
  translate?: Translate;
}>(), { columns: 4 });

const emit = defineEmits<{ add: [shapeId: string] }>();

const tr = useCadTranslate(() => props.translate);

const items = computed(() => {
  const all = paletteSharedShapes();
  const list = props.shapes
    ? props.shapes.map((id) => all.find((s) => s.id === id)).filter((s): s is NonNullable<typeof s> => !!s)
    : all;
  return list.map((s) => ({ id: s.id, icon: s.icon, label: tr(s.labelKey, s.label) }));
});

function onDragStart(e: DragEvent, id: string) {
  if (!e.dataTransfer) return;
  e.dataTransfer.setData('application/x-cubby-shape', id);
  e.dataTransfer.setData('text/plain', id);
  e.dataTransfer.effectAllowed = 'copy';
}
</script>
