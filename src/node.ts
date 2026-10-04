import { nativeBackend } from './backends/native.js';
import { setDefaultBackendFactory } from './core/defaults.js';

setDefaultBackendFactory(() => nativeBackend());

// Same public surface as the browser entry; only the default backend differs.
export * from './core/index.js';
export { promptApiBackend, type PromptApiBackendOptions, type PromptApiGlobal } from './backends/prompt-api.js';
export {
  nativeBackend,
  NATIVE_PACKAGE,
  type NativeAddon,
  type NativeAddonSession,
  type NativeBackendOptions,
} from './backends/native.js';
