import { promptApiBackend } from './backends/prompt-api.js';
import { setDefaultBackendFactory } from './core/defaults.js';

setDefaultBackendFactory(() => promptApiBackend());

export * from './core/index.js';
export { promptApiBackend, type PromptApiBackendOptions, type PromptApiGlobal } from './backends/prompt-api.js';
export {
  nativeBackend,
  NATIVE_PACKAGE,
  type NativeAddon,
  type NativeAddonSession,
  type NativeBackendOptions,
} from './backends/native.js';
