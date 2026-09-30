// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { defineComponent, h } from 'vue';
import { mount } from '@vue/test-utils';
import ShapeParamsForm from './ShapeParamsForm.vue';
import ShapePalette from './ShapePalette.vue';
import { provideCadTranslate } from './translate';
import { getSharedShape, paletteSharedShapes, type PropertyPanelSchema } from '../index';

const schema: PropertyPanelSchema = {
  properties: {
    width: { type: 'number', label: 'Width', labelKey: 'params.width', unit: 'mm', default: 20, min: 0.1, step: 1, sliderMax: 100 },
    sides: { type: 'integer', label: 'Sides', labelKey: 'params.sides', default: 6, min: 3, max: 64, step: 1 },
    title: { type: 'string', label: 'Title', default: 'hi' },
    solid: { type: 'boolean', label: 'Solid', default: true },
    mode: { type: 'enum', label: 'Mode', default: 'a', options: [{ label: 'Alpha', value: 'a' }, { label: 'Beta', value: 'b', labelKey: 'x.beta' }] },
  },
  order: ['width', 'sides', 'title', 'solid', 'mode'],
};

describe('ShapeParamsForm', () => {
  it('renders one labelled control per property in schema order', () => {
    const w = mount(ShapeParamsForm, { props: { schema, params: { width: 12.5 } } });
    expect(w.findAll('.ufield label').map((l) => l.text())).toEqual(['Width (mm)', 'Sides', 'Title', 'Solid', 'Mode']);
    expect(w.findAll('[role="slider"]')).toHaveLength(2);
    expect(w.find('[role="slider"]').attributes('aria-valuenow')).toBe('12.5');
    expect((w.find('.uinput').element as HTMLInputElement).value).toBe('hi');
    expect((w.find('.uswitch').element as HTMLInputElement).checked).toBe(true);
  });

  it('emits { params: { key: value } } patches, rounding integers', async () => {
    const w = mount(ShapeParamsForm, { props: { schema, params: {} } });
    await w.find('.uinput').setValue('yo');
    await w.find('.uswitch').setValue(false);
    await w.find('.uselect').setValue('b');
    // Integer slider: type an exact value.
    const sides = w.findAll('[role="slider"]')[1];
    await sides.trigger('keydown', { key: 'Enter' });
    const input = w.find('input[inputmode="decimal"]');
    await input.setValue('7.6');
    await input.trigger('keydown', { key: 'Enter' });
    expect(w.emitted('update')).toEqual([
      [{ params: { title: 'yo' } }],
      [{ params: { solid: false } }],
      [{ params: { mode: 'b' } }],
      [{ params: { sides: 8 } }],
    ]);
  });

  it('localises through a translate prop, else a provided one, else English', () => {
    const t = (key: string, en: string) => (key === 'params.width' ? 'Largeur' : key === 'x.beta' ? 'Bêta' : en);
    const w = mount(ShapeParamsForm, { props: { schema, translate: t } });
    expect(w.find('.ufield label').text()).toBe('Largeur (mm)');
    expect(w.findAll('.uselect option').map((o) => o.text())).toEqual(['Alpha', 'Bêta']);

    const Host = defineComponent({
      setup() {
        provideCadTranslate((key, en) => (key === 'params.sides' ? 'Côtés' : en));
        return () => h(ShapeParamsForm, { schema });
      },
    });
    const w2 = mount(Host);
    expect(w2.findAll('.ufield label')[1].text()).toBe('Côtés');
    expect(w2.findAll('.ufield label')[0].text()).toBe('Width (mm)');
  });

  it('lets a slot replace one field and shows an empty state', async () => {
    const w = mount(ShapeParamsForm, {
      props: { schema, params: { title: 'x' } },
      slots: { 'field-title': `<template #field-title="{ value, update }"><button class="custom" @click="update(value + '!')">{{ value }}</button></template>` },
    });
    expect(w.find('.uinput').exists()).toBe(false);
    await w.find('.custom').trigger('click');
    expect(w.emitted('update')).toEqual([[{ params: { title: 'x!' } }]]);
    expect(mount(ShapeParamsForm, { props: { schema: null } }).text()).toBe('No editable parameters.');
    // A schema with no properties renders an empty form (CubbyCAD's behaviour).
    expect(mount(ShapeParamsForm, { props: { schema: { properties: {} } } }).text()).toBe('');
    expect(mount(ShapeParamsForm, { props: { schema: null, emptyText: 'Rien' } }).text()).toBe('Rien');
  });

  it('renders a real shared shape schema', () => {
    const box = getSharedShape('box')!;
    const w = mount(ShapeParamsForm, { props: { schema: box.schema, params: box.defaults } });
    expect(w.findAll('.ufield label').map((l) => l.text())).toEqual(['Width (mm)', 'Height (mm)', 'Depth (mm)', 'Bevel (mm)', 'Bevel segments']);
  });
});

describe('ShapePalette', () => {
  it('lists palette shapes with icons and emits add on click', async () => {
    const w = mount(ShapePalette);
    const buttons = w.findAll('button');
    expect(buttons.map((b) => b.attributes('data-shape'))).toEqual(paletteSharedShapes().map((s) => s.id));
    expect(buttons[0].text()).toBe('Box');
    expect(buttons[0].find('.uicon').attributes('data-icon')).toBe('i-lucide-box');
    await buttons[1].trigger('click');
    expect(w.emitted('add')).toEqual([['sphere']]);
  });

  it('can be limited and translated', () => {
    const w = mount(ShapePalette, { props: { shapes: ['cone', 'box', 'nope'], translate: (k: string, en: string) => (k === 'primitives.box' ? 'Boîte' : en) } });
    expect(w.findAll('button').map((b) => b.text())).toEqual(['Cone', 'Boîte']);
  });
});
