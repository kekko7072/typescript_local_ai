import { LocalAiError, toLocalAiError } from '../core/errors.js';
import { NO_CAPABILITIES } from '../core/types.js';
import type {
  LocalAiAvailabilityReport,
  LocalAiBackend,
  LocalAiBackendSession,
  LocalAiCapabilities,
  LocalAiGenerateOptions,
  LocalAiSessionOptions,
} from '../core/types.js';

export const NATIVE_PACKAGE = '@typescript_local_ai/native';

/**
 * The contract the napi-rs addon over `rust_local_ai` is expected to export.
 * Streaming is callback-based because that maps directly onto napi-rs
 * threadsafe functions; this adapter turns it into an async iterable.
 */
export interface NativeAddon {
  availability(): Promise<LocalAiAvailabilityReport>;
  capabilities(): Promise<LocalAiCapabilities>;
  createSession(options: { systemPrompt?: string; temperature?: number; topK?: number }): Promise<NativeAddonSession>;
}

export interface NativeAddonSession {
  prompt(input: string): Promise<string>;
  /** Calls `onChunk` with each delta and resolves when the turn ends. */
  promptStreaming(input: string, onChunk: (chunk: string) => void): Promise<void>;
  /** Cancels the in-flight turn; the pending promise rejects. */
  cancel(): void;
  destroy(): void;
}

export interface NativeBackendOptions {
  /** Provide the addon directly instead of loading `@typescript_local_ai/native`. */
  addon?: NativeAddon | (() => Promise<NativeAddon>);
}

const INFO = Object.freeze({ id: 'native', name: 'Native (rust_local_ai)' });

/** Backend for Node.js that calls the Rust core through its native addon. */
export function nativeBackend(options: NativeBackendOptions = {}): LocalAiBackend {
  let loading: Promise<NativeAddon | Error> | undefined;
  const load = (): Promise<NativeAddon | Error> => {
    loading ??= resolveAddon(options.addon).catch((error: unknown) =>
      error instanceof Error ? error : new Error(String(error)),
    );
    return loading;
  };

  return {
    info: INFO,

    async availability(): Promise<LocalAiAvailabilityReport> {
      const addon = await load();
      if (addon instanceof Error) {
        return { availability: 'unavailable', reason: `${NATIVE_PACKAGE} could not be loaded: ${addon.message}` };
      }
      return addon.availability();
    },

    async capabilities(): Promise<LocalAiCapabilities> {
      const addon = await load();
      return addon instanceof Error ? NO_CAPABILITIES : addon.capabilities();
    },

    async createSession({ systemPrompt, temperature, topK, signal }: LocalAiSessionOptions): Promise<LocalAiBackendSession> {
      const addon = await load();
      if (addon instanceof Error) throw new LocalAiError('unavailable', addon.message, { cause: addon });
      if (signal?.aborted) throw new LocalAiError('cancelled', 'Session creation was cancelled.');
      const native = await addon.createSession(definedOnly({ systemPrompt, temperature, topK }));
      return wrapSession(native);
    },
  };
}

async function resolveAddon(addon: NativeBackendOptions['addon']): Promise<NativeAddon> {
  if (typeof addon === 'function') return addon();
  if (addon) return addon;
  // A variable specifier keeps bundlers from trying to resolve the optional
  // addon at build time; it is only ever loaded by Node at runtime.
  const specifier: string = NATIVE_PACKAGE;
  const mod = (await import(/* webpackIgnore: true */ /* @vite-ignore */ specifier)) as {
    default?: NativeAddon;
  } & Partial<NativeAddon>;
  return (mod.default ?? mod) as NativeAddon;
}

function wrapSession(native: NativeAddonSession): LocalAiBackendSession {
  return {
    async prompt(input: string, { signal }: LocalAiGenerateOptions): Promise<string> {
      const stop = onAbort(signal, () => native.cancel());
      try {
        return await native.prompt(input);
      } catch (error) {
        throw signal?.aborted ? new LocalAiError('cancelled', 'Generation was cancelled.') : toLocalAiError(error);
      } finally {
        stop();
      }
    },

    async *promptStreaming(input: string, { signal }: LocalAiGenerateOptions): AsyncIterable<string> {
      const queue: string[] = [];
      let wake: (() => void) | undefined;
      let finished = false;
      let failure: unknown;
      const notify = () => {
        wake?.();
        wake = undefined;
      };
      const stop = onAbort(signal, () => native.cancel());
      native
        .promptStreaming(input, (chunk) => {
          queue.push(chunk);
          notify();
        })
        .then(
          () => {
            finished = true;
            notify();
          },
          (error: unknown) => {
            failure = error;
            finished = true;
            notify();
          },
        );
      try {
        while (true) {
          const chunk = queue.shift();
          if (chunk !== undefined) {
            yield chunk;
            continue;
          }
          if (finished) break;
          await new Promise<void>((resolve) => (wake = resolve));
        }
        if (failure !== undefined) {
          throw signal?.aborted ? new LocalAiError('cancelled', 'Generation was cancelled.') : toLocalAiError(failure);
        }
      } finally {
        if (!finished) native.cancel();
        stop();
      }
    },

    destroy(): void {
      native.destroy();
    },
  };
}

function onAbort(signal: AbortSignal | undefined, handler: () => void): () => void {
  if (!signal) return () => undefined;
  signal.addEventListener('abort', handler, { once: true });
  return () => signal.removeEventListener('abort', handler);
}

function definedOnly<T extends Record<string, unknown>>(value: T): Partial<T> {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as Partial<T>;
}
