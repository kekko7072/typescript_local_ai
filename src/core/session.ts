import { LocalAiError, toLocalAiError } from './errors.js';
import type {
  LocalAiBackendInfo,
  LocalAiBackendSession,
  LocalAiGenerateOptions,
  LocalAiResponse,
} from './types.js';

/**
 * A stateful conversation. One turn runs at a time: starting a second turn
 * while one is in flight throws `busy` instead of interleaving context.
 */
export class LocalAiSession {
  #inner: LocalAiBackendSession;
  #backend: LocalAiBackendInfo;
  #busy = false;
  #destroyed = false;

  constructor(inner: LocalAiBackendSession, backend: LocalAiBackendInfo) {
    this.#inner = inner;
    this.#backend = backend;
  }

  get busy(): boolean {
    return this.#busy;
  }

  get destroyed(): boolean {
    return this.#destroyed;
  }

  async generate(prompt: string, options: LocalAiGenerateOptions = {}): Promise<LocalAiResponse> {
    this.#begin(prompt, options.signal);
    try {
      const text = await this.#inner.prompt(prompt, options);
      throwIfAborted(options.signal);
      return { text, backend: this.#backend };
    } catch (error) {
      throw toLocalAiError(error);
    } finally {
      this.#busy = false;
    }
  }

  /** Streams text deltas. Breaking out of the loop ends the turn. */
  async *stream(prompt: string, options: LocalAiGenerateOptions = {}): AsyncGenerator<string, void, undefined> {
    this.#begin(prompt, options.signal);
    try {
      for await (const chunk of this.#inner.promptStreaming(prompt, options)) {
        throwIfAborted(options.signal);
        yield chunk;
      }
      throwIfAborted(options.signal);
    } catch (error) {
      throw toLocalAiError(error);
    } finally {
      this.#busy = false;
    }
  }

  destroy(): void {
    if (this.#destroyed) return;
    this.#destroyed = true;
    this.#inner.destroy();
  }

  #begin(prompt: string, signal: AbortSignal | undefined): void {
    if (this.#destroyed) throw new LocalAiError('session-destroyed', 'The session has been destroyed.');
    if (typeof prompt !== 'string' || prompt.trim() === '') {
      throw new LocalAiError('invalid-input', 'The prompt must be a non-empty string.');
    }
    if (this.#busy) throw new LocalAiError('busy', 'The session is already generating a response.');
    throwIfAborted(signal);
    this.#busy = true;
  }
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw new LocalAiError('cancelled', 'Generation was cancelled.', { cause: signal.reason });
}
