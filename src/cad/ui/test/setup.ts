import { config } from '@vue/test-utils';
import UFormField from './stubs/FormField.vue';
import UInput from './stubs/Input.vue';
import USwitch from './stubs/Switch.vue';
import USelect from './stubs/Select.vue';
import UIcon from './stubs/Icon.vue';

// Stand-ins for the Nuxt UI components the shared templates use by name.
config.global.components = { ...config.global.components, UFormField, UInput, USwitch, USelect, UIcon };
