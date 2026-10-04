import { LocalAiError } from 'typescript_local_ai';
import type {
  LocalAiAvailability,
  LocalAiBackend,
  LocalAiBackendSession,
  LocalAiCapabilities,
  LocalAiGenerateOptions,
  LocalAiSessionOptions,
} from 'typescript_local_ai';

export interface FakeBackendOptions {
  availability?: LocalAiAvailability;
  reason?: string;
  capabilities?: Partial<LocalAiCapabilities>;
  /** Response for a prompt. Defaults to echoing it. Throw to simulate failures. */
  respond?: (prompt: string, history: readonly string[]) => string | Promise<string>;
  /** Splits a response into stream chunks. Defaults to words. */
  chunk?: (text: string) => string[];
  /** Delay before each chunk, in milliseconds. */
  chunkDelayMs?: number;
}

/** A deterministic in-memory backend for tests and examples. */
export class FakeBackend implements LocalAiBackend {
  readonly info = Object.freeze({ id: 'fake', name: 'Fake backend' });
  availabilityValue: LocalAiAvailability;
  readonly sessions: { options: LocalAiSessionOptions; prompts: string[]; destroyed: boolean }[] = [];
  #options: FakeBackendOptions;

  constructor(options: FakeBackendOptions = {}) {
    this.#options = options;
    this.availabilityValue = options.availability ?? 'available';
  }

  async availability() {
    const reason = this.#options.reason;
    return reason === undefined ? { availability: this.availabilityValue } : { availability: this.availabilityValue, reason };
  }

  async capabilities(): Promise<LocalAiCapabilities> {
    return {
      streaming: true,
      structuredOutput: false,
      toolCalling: false,
      imageInput: false,
      modelPreparation: false,
      ...this.#options.capabilities,
    };
  }

  async createSession(options: LocalAiSessionOptions): Promise<LocalAiBackendSession> {
    if (this.availabilityValue === 'unavailable') {
      throw new LocalAiError('unavailable', this.#options.reason ?? 'Fake backend is unavailable.');
    }
    const record = { options, prompts: [] as string[], destroyed: false };
    this.sessions.push(record);
    const respond = this.#options.respond ?? ((prompt: string) => `echo: ${prompt}`);
    const chunk = this.#options.chunk ?? ((text: string) => text.match(/\S+\s*/g) ?? [text]);
    const delay = this.#options.chunkDelayMs ?? 0;

    return {
      async prompt(input: string, { signal }: LocalAiGenerateOptions) {
        record.prompts.push(input);
        const text = await respond(input, record.prompts);
        await sleep(delay, signal);
        return text;
      },
      async *promptStreaming(input: string, { signal }: LocalAiGenerateOptions) {
        record.prompts.push(input);
        const text = await respond(input, record.prompts);
        for (const part of chunk(text)) {
          await sleep(delay, signal);
          yield part;
        }
      },
      destroy() {
        record.destroyed = true;
      },
    };
  }
}

function sleep(ms: number, signal: AbortSignal | undefined): Promise<void> {
  if (signal?.aborted) return Promise.reject(new LocalAiError('cancelled', 'Generation was cancelled.'));
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new LocalAiError('cancelled', 'Generation was cancelled.'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}
