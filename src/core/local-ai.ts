import { resolveBackend } from './defaults.js';
import { LocalAiError, toLocalAiError } from './errors.js';
import { LocalAiSession } from './session.js';
import type {
  LocalAiAvailabilityReport,
  LocalAiBackend,
  LocalAiBackendInfo,
  LocalAiCapabilities,
  LocalAiSessionOptions,
} from './types.js';

export interface LocalAiOptions {
  /** Defaults to the runtime's backend: Prompt API in browsers, the native addon in Node. */
  backend?: LocalAiBackend;
}

/** Entry point: checks availability and creates sessions on one backend. */
export class LocalAi {
  readonly backend: LocalAiBackend;

  constructor(options: LocalAiOptions = {}) {
    this.backend = resolveBackend(options.backend);
  }

  static create(options: LocalAiOptions = {}): LocalAi {
    return new LocalAi(options);
  }

  get info(): LocalAiBackendInfo {
    return this.backend.info;
  }

  async availability(): Promise<LocalAiAvailabilityReport> {
    try {
      return await this.backend.availability();
    } catch (error) {
      return { availability: 'unavailable', reason: toLocalAiError(error, 'unavailable').message };
    }
  }

  capabilities(): Promise<LocalAiCapabilities> {
    return this.backend.capabilities();
  }

  async createSession(options: LocalAiSessionOptions = {}): Promise<LocalAiSession> {
    const { availability, reason } = await this.availability();
    if (availability === 'unavailable') {
      throw new LocalAiError('unavailable', reason ?? `${this.info.name} is not available on this device.`);
    }
    try {
      const inner = await this.backend.createSession(options);
      return new LocalAiSession(inner, this.info);
    } catch (error) {
      throw toLocalAiError(error, 'unavailable');
    }
  }
}
