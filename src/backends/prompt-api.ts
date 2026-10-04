import { LocalAiError, isAbortError } from '../core/errors.js';
import { NO_CAPABILITIES } from '../core/types.js';
import type {
  LocalAiAvailability,
  LocalAiAvailabilityReport,
  LocalAiBackend,
  LocalAiBackendSession,
  LocalAiCapabilities,
  LocalAiGenerateOptions,
  LocalAiSessionOptions,
} from '../core/types.js';

/** The subset of Chrome's Prompt API (`LanguageModel`) this adapter uses. */
interface PromptApiSession {
  prompt(input: string, options?: { signal?: AbortSignal }): Promise<string>;
  promptStreaming(input: string, options?: { signal?: AbortSignal }): ReadableStream<string>;
  destroy(): void;
}

interface PromptApiMonitor {
  addEventListener(type: 'downloadprogress', listener: (event: { loaded: number }) => void): void;
}

interface PromptApiCreateOptions {
  initialPrompts?: { role: 'system'; content: string }[];
  temperature?: number;
  topK?: number;
  signal?: AbortSignal;
  monitor?: (monitor: PromptApiMonitor) => void;
}

export interface PromptApiGlobal {
  availability(): Promise<LocalAiAvailability>;
  create(options?: PromptApiCreateOptions): Promise<PromptApiSession>;
}

export interface PromptApiBackendOptions {
  /** Override the `LanguageModel` global, e.g. in tests. */
  languageModel?: PromptApiGlobal;
}

const INFO = Object.freeze({ id: 'chrome-prompt-api', name: 'Chrome Prompt API' });

/** Backend for the browser's built-in Prompt API (Gemini Nano in Chrome). */
export function promptApiBackend(options: PromptApiBackendOptions = {}): LocalAiBackend {
  const lookup = (): PromptApiGlobal | undefined =>
    options.languageModel ?? (globalThis as { LanguageModel?: PromptApiGlobal }).LanguageModel;

  return {
    info: INFO,

    async availability(): Promise<LocalAiAvailabilityReport> {
      const api = lookup();
      if (!api) {
        return {
          availability: 'unavailable',
          reason:
            typeof window === 'undefined'
              ? 'The Prompt API only exists in the browser.'
              : 'This browser does not expose the Prompt API (LanguageModel).',
        };
      }
      try {
        return { availability: await api.availability() };
      } catch (error) {
        return { availability: 'unavailable', reason: mapError(error).message };
      }
    },

    async capabilities(): Promise<LocalAiCapabilities> {
      if (!lookup()) return NO_CAPABILITIES;
      // Only what this adapter exposes. Chrome's responseConstraint and
      // multimodal input are not bridged yet, so they are not claimed.
      return { ...NO_CAPABILITIES, streaming: true, modelPreparation: true };
    },

    async createSession(sessionOptions: LocalAiSessionOptions): Promise<LocalAiBackendSession> {
      const api = lookup();
      if (!api) throw new LocalAiError('unavailable', 'This browser does not expose the Prompt API (LanguageModel).');
      const { systemPrompt, temperature, topK, signal, onDownloadProgress } = sessionOptions;
      if ((temperature === undefined) !== (topK === undefined)) {
        throw new LocalAiError('invalid-input', 'The Prompt API requires temperature and topK to be set together.');
      }
      const createOptions: PromptApiCreateOptions = {};
      if (systemPrompt) createOptions.initialPrompts = [{ role: 'system', content: systemPrompt }];
      if (temperature !== undefined && topK !== undefined) {
        createOptions.temperature = temperature;
        createOptions.topK = topK;
      }
      if (signal) createOptions.signal = signal;
      if (onDownloadProgress) {
        createOptions.monitor = (monitor) =>
          monitor.addEventListener('downloadprogress', (event) => onDownloadProgress(event.loaded));
      }
      let session: PromptApiSession;
      try {
        session = await api.create(createOptions);
      } catch (error) {
        throw mapError(error);
      }
      return wrapSession(session);
    },
  };
}

function wrapSession(session: PromptApiSession): LocalAiBackendSession {
  return {
    async prompt(input: string, { signal }: LocalAiGenerateOptions): Promise<string> {
      try {
        return await session.prompt(input, signal ? { signal } : undefined);
      } catch (error) {
        throw mapError(error);
      }
    },

    async *promptStreaming(input: string, { signal }: LocalAiGenerateOptions): AsyncIterable<string> {
      let reader: ReadableStreamDefaultReader<string>;
      try {
        reader = session.promptStreaming(input, signal ? { signal } : undefined).getReader();
      } catch (error) {
        throw mapError(error);
      }
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) return;
          yield value;
        }
      } catch (error) {
        throw mapError(error);
      } finally {
        // Runs on completion, error, or when the consumer stops early.
        reader.cancel().catch(() => undefined);
        reader.releaseLock();
      }
    },

    destroy(): void {
      session.destroy();
    },
  };
}

function mapError(error: unknown): LocalAiError {
  if (error instanceof LocalAiError) return error;
  const name = typeof error === 'object' && error !== null && 'name' in error ? String(error.name) : '';
  const message = error instanceof Error && error.message ? error.message : 'Prompt API request failed.';
  if (isAbortError(error)) return new LocalAiError('cancelled', 'Generation was cancelled.', { cause: error });
  switch (name) {
    case 'NotAllowedError':
      return new LocalAiError('unavailable', message, { cause: error });
    case 'NotSupportedError':
      return new LocalAiError('unsupported', message, { cause: error });
    case 'QuotaExceededError':
      return new LocalAiError('prompt-too-long', message, { cause: error });
    case 'InvalidStateError':
      return new LocalAiError('session-destroyed', message, { cause: error });
    case 'NotReadableError':
      return new LocalAiError('content-blocked', message, { cause: error });
    case 'SyntaxError':
    case 'TypeError':
      return new LocalAiError('invalid-input', message, { cause: error });
    default:
      return new LocalAiError('generation-failed', message, { cause: error });
  }
}
