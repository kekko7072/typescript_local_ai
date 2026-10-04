/**
 * Mirrors the Prompt API vocabulary:
 * - `available`: a session can be created now;
 * - `downloadable`: the model can be fetched, which `createSession` triggers;
 * - `downloading`: the model is being fetched;
 * - `unavailable`: this device, runtime or configuration cannot run it.
 */
export type LocalAiAvailability = 'available' | 'downloadable' | 'downloading' | 'unavailable';

export interface LocalAiAvailabilityReport {
  availability: LocalAiAvailability;
  /** Human-readable explanation when the backend can give one. */
  reason?: string;
}

/** What the active backend can really do. Never inferred from the OS name. */
export interface LocalAiCapabilities {
  /** Incremental chunks, not one final chunk dressed up as a stream. */
  streaming: boolean;
  /** Native schema-constrained output. */
  structuredOutput: boolean;
  /** Native tool calling. */
  toolCalling: boolean;
  /** Image input. */
  imageInput: boolean;
  /** The backend can download or prepare its model on request. */
  modelPreparation: boolean;
}

export interface LocalAiBackendInfo {
  /** Stable identifier such as `chrome-prompt-api` or `native`. */
  id: string;
  /** Display name for diagnostics. */
  name: string;
}

export interface LocalAiSessionOptions {
  /** System instructions for the whole session. */
  systemPrompt?: string;
  temperature?: number;
  topK?: number;
  /** Aborts session creation, including a model download. */
  signal?: AbortSignal;
  /** Called with download progress in the range 0..1 when the backend reports it. */
  onDownloadProgress?: (progress: number) => void;
}

export interface LocalAiGenerateOptions {
  signal?: AbortSignal;
}

export interface LocalAiResponse {
  text: string;
  backend: LocalAiBackendInfo;
}

/** A single conversational context owned by a backend. */
export interface LocalAiBackendSession {
  prompt(input: string, options: LocalAiGenerateOptions): Promise<string>;
  /** Yields text deltas. */
  promptStreaming(input: string, options: LocalAiGenerateOptions): AsyncIterable<string>;
  destroy(): void;
}

/** The contract every backend adapter implements. */
export interface LocalAiBackend {
  readonly info: LocalAiBackendInfo;
  availability(): Promise<LocalAiAvailabilityReport>;
  capabilities(): Promise<LocalAiCapabilities>;
  createSession(options: LocalAiSessionOptions): Promise<LocalAiBackendSession>;
}

export const NO_CAPABILITIES: LocalAiCapabilities = Object.freeze({
  streaming: false,
  structuredOutput: false,
  toolCalling: false,
  imageInput: false,
  modelPreparation: false,
});
