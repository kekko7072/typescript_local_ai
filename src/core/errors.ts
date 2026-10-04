/** Actionable error categories shared by every backend and adapter. */
export type LocalAiErrorCode =
  | 'unavailable'
  | 'unsupported'
  | 'busy'
  | 'cancelled'
  | 'invalid-input'
  | 'prompt-too-long'
  | 'content-blocked'
  | 'backend-configuration'
  | 'session-destroyed'
  | 'generation-failed';

export interface LocalAiErrorOptions {
  /** The native error, kept for diagnostics. Not part of the public contract. */
  cause?: unknown;
}

export class LocalAiError extends Error {
  override readonly name = 'LocalAiError';
  readonly code: LocalAiErrorCode;

  constructor(code: LocalAiErrorCode, message: string, options: LocalAiErrorOptions = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.code = code;
  }

  static is(value: unknown, code?: LocalAiErrorCode): value is LocalAiError {
    return value instanceof LocalAiError && (code === undefined || value.code === code);
  }
}

export function isAbortError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'name' in error &&
    (error as { name: unknown }).name === 'AbortError'
  );
}

/** Converts an unknown thrown value into a `LocalAiError`. */
export function toLocalAiError(error: unknown, fallback: LocalAiErrorCode = 'generation-failed'): LocalAiError {
  if (error instanceof LocalAiError) return error;
  if (isAbortError(error)) return new LocalAiError('cancelled', 'Generation was cancelled.', { cause: error });
  const message = error instanceof Error ? error.message : String(error);
  return new LocalAiError(fallback, message || 'Local AI request failed.', { cause: error });
}
