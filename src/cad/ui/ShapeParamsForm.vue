<template>
  <div class="space-y-2">
    <template v-if="schema">
      <UFormField
        v-for="key in fields"
        :key="key"
        :label="fieldLabel(schema.properties[key])"
      >
        <!-- `#field-<key>` replaces the built-in control for one property
             (CubbyCAD's font picker uses it); it gets the property, its current
             value and an `update(value)` that emits the patch. -->
        <slot
          v-if="$slots[`field-${key}`]"
          :name="`field-${key}`"
          :prop="schema.properties[key]"
          :value="currentValue(key)"
          :update="(v: unknown) => emitPatch(key, v)"
        />
        <UInput
          v-else-if="schema.properties[key].type === 'string'"
          :size="size"
          :model-value="String(currentValue(key) ?? (schema.properties[key] as StringPropertySchema).default)"
          @update:model-value="(v: string | number | undefined) => patchString(key, v === undefined ? undefined : String(v), schema!.properties[key] as StringPropertySchema)"
        />
        <USwitch
          v-else-if="schema.properties[key].type === 'boolean'"
          :size="size"
          :model-value="Boolean(currentValue(key) ?? (schema.properties[key] as BooleanPropertySchema).default)"
          @update:model-value="(v: boolean) => patchBoolean(key, v)"
        />
        <USelect
          v-else-if="schema.properties[key].type === 'enum'"
          :size="size"
          :model-value="String(currentValue(key) ?? (schema.properties[key] as EnumPropertySchema).default)"
          :items="enumItems(schema.properties[key] as EnumPropertySchema)"
          value-key="value"
          @update:model-value="(v: string) => patchEnum(key, v)"
        />
        <NumberSlider
          v-else
          :size="size"
          :model-value="Number(currentValue(key) ?? schema.properties[key].default)"
          :min="(schema.properties[key] as NumberPropertySchema | IntegerPropertySchema).min"
          :max="(schema.properties[key] as NumberPropertySchema | IntegerPropertySchema).max"
          :step="(schema.properties[key] as NumberPropertySchema | IntegerPropertySchema).step ?? (schema.properties[key].type === 'integer' ? 1 : undefined)"
          :slider-max="(schema.properties[key] as NumberPropertySchema | IntegerPropertySchema).sliderMax"
          :commit-on-release="commitOnRelease"
          @update:model-value="(v: number) => patchNumber(key, v, schema!.properties[key])"
        />
      </UFormField>
    </template>

    <slot v-else name="empty">
      <div class="text-xs text-muted">{{ emptyText ?? 'No editable parameters.' }}</div>
    </slot>
  </div>
</template>

<script setup lang="ts">
/**
 * The property form for a shape's params — CubbyCAD's built-in-schema panel
 * (moved from its GeometryProperties.vue), shared with Cubby Slicer. Renders
 * one control per schema property (number/integer → NumberSlider, string →
 * input, boolean → switch, enum → select) in `schema.order`, and emits every
 * edit as `{ params: { [key]: value } }` (the shape CubbyCAD's scene store
 * deep-merges into `geometry.params`).
 */
import { computed } from 'vue';
import UFormField from '@nuxt/ui/components/FormField.vue';
import UInput from '@nuxt/ui/components/Input.vue';
import USwitch from '@nuxt/ui/components/Switch.vue';
import USelect from '@nuxt/ui/components/Select.vue';
import NumberSlider from './NumberSlider.vue';
import type {
  PropertyPanelSchema, PropertySchema, NumberPropertySchema, IntegerPropertySchema,
  StringPropertySchema, BooleanPropertySchema, EnumPropertySchema, Translate,
} from '../schema';
import { useCadTranslate } from './translate';

const props = defineProps<{
  schema?: PropertyPanelSchema | null;
  /** The geometry's current `params` bag (missing keys show the default). */
  params?: Record<string, unknown> | null;
  /** `(i18nKey, english) → label`; defaults to the provided one, else English. */
  translate?: Translate;
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
  /** Emit slider edits once at the end of a drag (see NumberSlider). */
  commitOnRelease?: boolean;
  /** Shown (unless the `#empty` slot is used) when there's nothing to edit. */
  emptyText?: string;
}>();

const emit = defineEmits<{
  update: [updates: { params: Record<string, unknown> }];
}>();

const tr = useCadTranslate(() => props.translate);

const fields = computed<string[]>(() => {
  const s = props.schema;
  if (!s) return [];
  return (s.order ?? Object.keys(s.properties)).filter((k) => k in s.properties);
});

function fieldLabel(prop: PropertySchema): string {
  const label = prop.labelKey ? tr(prop.labelKey, prop.label) : prop.label;
  return prop.unit ? `${label} (${prop.unit})` : label;
}

function enumItems(prop: EnumPropertySchema): Array<{ label: string; value: string }> {
  return prop.options.map((o) => ({ label: o.labelKey ? tr(o.labelKey, o.label) : o.label, value: o.value }));
}

function currentValue(key: string): unknown {
  return props.params?.[key];
}

function emitPatch(key: string, value: unknown) {
  emit('update', { params: { [key]: value } });
}

function patchNumber(key: string, value: number, prop: PropertySchema) {
  if (!Number.isFinite(value)) return;
  const v = prop.type === 'integer' ? Math.round(value) : value;
  emitPatch(key, v);
}

function patchString(key: string, value: string | undefined, prop: StringPropertySchema) {
  emitPatch(key, String(value ?? prop.default));
}

function patchBoolean(key: string, value: boolean) {
  emitPatch(key, !!value);
}

function patchEnum(key: string, value: string) {
  emitPatch(key, String(value ?? ''));
}
</script>
