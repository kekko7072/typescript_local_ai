import { LocalAiError } from './errors.js';
import type { LocalAiBackend } from './types.js';

type BackendFactory = () => LocalAiBackend;

let defaultFactory: BackendFactory | undefined;

/** @internal Called once by the browser or Node entry point. */
export function setDefaultBackendFactory(factory: BackendFactory): void {
  defaultFactory = factory;
}

/** @internal */
export function resolveBackend(backend: LocalAiBackend | undefined): LocalAiBackend {
  if (backend) return backend;
  if (!defaultFactory) {
    throw new LocalAiError('backend-configuration', 'No default backend is registered for this runtime.');
  }
  return defaultFactory();
}
