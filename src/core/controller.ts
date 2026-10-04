import { LocalAiError, toLocalAiError } from './errors.js';
import { LocalAi, type LocalAiOptions } from './local-ai.js';
import type { LocalAiSession } from './session.js';
import type { LocalAiAvailability, LocalAiSessionOptions } from './types.js';

/**
 * `checking` is the initial status on the server and on the first client
 * render, so server-rendered HTML always matches hydration.
 */
export type LocalAiStatus =
  | 'checking'
  | 'unavailable'
  | 'downloadable'
  | 'downloading'
  | 'ready'
  | 'generating'
  | 'error';

export interface LocalAiState {
  status: LocalAiStatus;
  availability: LocalAiAvailability | null;
  /** Why the backend is unavailable, when it can explain. */
  reason: string | null;
  /** Text of the latest response, growing while it streams. */
  output: string;
  error: LocalAiError | null;
  /** Model download progress (0..1) while preparing, otherwise null. */
  downloadProgress: number | null;
}

export interface LocalAiControllerOptions extends LocalAiOptions {
  /** Options for the session the controller creates on first use. */
  session?: Omit<LocalAiSessionOptions, 'signal' | 'onDownloadProgress'>;
}

export interface LocalAiActions {
  check(): Promise<LocalAiAvailability | undefined>;
  generate(prompt: string): Promise<string | undefined>;
  stream(prompt: string): Promise<string | undefined>;
  cancel(): void;
  reset(): void;
}

export type LocalAiListener = (state: LocalAiState) => void;

export const INITIAL_LOCAL_AI_STATE: LocalAiState = Object.freeze({
  status: 'checking',
  availability: null,
  reason: null,
  output: '',
  error: null,
  downloadProgress: null,
});

/**
 * Framework-neutral state machine behind the React, Vue and Svelte adapters.
 * It never touches the backend until `check()` or a generation is called, so
 * constructing it during server rendering is safe.
 */
export class LocalAiController {
  #options: LocalAiControllerOptions;
  #ai: LocalAi | undefined;
  #state: LocalAiState = INITIAL_LOCAL_AI_STATE;
  #listeners = new Set<LocalAiListener>();
  #session: Promise<LocalAiSession> | undefined;
  #current: LocalAiSession | undefined;
  #actions: LocalAiActions | undefined;
  #abort: AbortController | undefined;

  constructor(options: LocalAiControllerOptions = {}) {
    this.#options = options;
  }

  getState = (): LocalAiState => this.#state;

  subscribe = (listener: LocalAiListener): (() => void) => {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  };

  /** Probes availability. Call it from a client-only lifecycle hook. */
  check = async (): Promise<LocalAiAvailability> => {
    const { availability, reason } = await this.#getAi().availability();
    if (this.#state.status !== 'generating') {
      this.#set({ availability, reason: reason ?? null, status: statusFor(availability) });
    }
    return availability;
  };

  /** Generates a full response in the controller's session. */
  generate = (prompt: string): Promise<string | undefined> =>
    this.#run(prompt, async (session, signal) => {
      const { text } = await session.generate(prompt, { signal });
      this.#set({ output: text });
      return text;
    });

  /** Streams a response, updating `output` with each delta. */
  stream = (prompt: string): Promise<string | undefined> =>
    this.#run(prompt, async (session, signal) => {
      let text = '';
      for await (const chunk of session.stream(prompt, { signal })) {
        text += chunk;
        this.#set({ output: text });
      }
      return text;
    });

  /** Cancels the in-flight generation, if any. */
  cancel = (): void => {
    this.#abort?.abort();
  };

  /** Starts a new conversation: cancels, destroys the session, clears output. */
  reset = (): void => {
    this.cancel();
    this.#destroySession();
    const { availability } = this.#state;
    this.#set({
      output: '',
      error: null,
      status: availability ? statusFor(availability) : 'checking',
    });
  };

  /**
   * Releases the backend session and cancels work. The controller stays
   * usable (React Strict Mode re-runs effects), creating a new session on
   * next use; subscribers manage their own subscriptions.
   */
  dispose = (): void => {
    this.cancel();
    this.#destroySession();
  };

  /**
   * Versions of the actions for UI event handlers: they never reject, since
   * failures are already reported through `status` and `error`.
   */
  get actions(): LocalAiActions {
    return (this.#actions ??= {
      check: () => this.check().catch(() => undefined),
      generate: (prompt) => this.generate(prompt).catch(() => undefined),
      stream: (prompt) => this.stream(prompt).catch(() => undefined),
      cancel: this.cancel,
      reset: this.reset,
    });
  }

  async #run(
    prompt: string,
    work: (session: LocalAiSession, signal: AbortSignal) => Promise<string>,
  ): Promise<string | undefined> {
    if (this.#abort) throw new LocalAiError('busy', 'A response is already being generated.');
    const abort = new AbortController();
    this.#abort = abort;
    this.#set({ status: 'generating', output: '', error: null });
    try {
      const session = await this.#getSession(abort.signal);
      const text = await work(session, abort.signal);
      this.#set({ status: 'ready', availability: 'available', downloadProgress: null });
      return text;
    } catch (error) {
      const failure = toLocalAiError(error);
      if (failure.code === 'cancelled') {
        this.#set({ status: 'ready', downloadProgress: null });
        return undefined;
      }
      if (failure.code === 'unavailable') this.#destroySession();
      this.#set({ status: 'error', error: failure, downloadProgress: null });
      throw failure;
    } finally {
      if (this.#abort === abort) this.#abort = undefined;
    }
  }

  #getSession(signal: AbortSignal): Promise<LocalAiSession> {
    if (this.#session) return this.#session;
    const pending: Promise<LocalAiSession> = this.#getAi()
      .createSession({
        ...this.#options.session,
        signal,
        onDownloadProgress: (downloadProgress) => this.#set({ downloadProgress }),
      })
      .then(
        (session) => {
          // A reset may have happened while the session was being created.
          if (this.#session === pending) this.#current = session;
          else session.destroy();
          return session;
        },
        (error: unknown) => {
          if (this.#session === pending) this.#session = undefined;
          throw error;
        },
      );
    this.#session = pending;
    return pending;
  }

  #destroySession(): void {
    this.#current?.destroy();
    this.#current = undefined;
    this.#session = undefined;
  }

  #getAi(): LocalAi {
    this.#ai ??= new LocalAi(this.#options);
    return this.#ai;
  }

  #set(patch: Partial<LocalAiState>): void {
    this.#state = { ...this.#state, ...patch };
    for (const listener of this.#listeners) listener(this.#state);
  }
}

export function createLocalAiController(options?: LocalAiControllerOptions): LocalAiController {
  return new LocalAiController(options);
}

function statusFor(availability: LocalAiAvailability): LocalAiStatus {
  return availability === 'available' ? 'ready' : availability;
}
