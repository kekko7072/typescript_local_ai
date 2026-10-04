import 'server-only';
import {
  LocalAi,
  LocalAiError,
  type LocalAiBackend,
  type LocalAiErrorCode,
  type LocalAiSessionOptions,
} from 'typescript_local_ai';

export interface LocalAiRouteOptions {
  /** Defaults to the Node backend. Route handlers need `runtime = 'nodejs'`. */
  backend?: LocalAiBackend;
  /** Options for the per-request session. */
  session?: Omit<LocalAiSessionOptions, 'signal' | 'onDownloadProgress'>;
  /** Rejects longer prompts with 413 before reaching the model. Default 8000. */
  maxPromptLength?: number;
}

export interface LocalAiRequestBody {
  prompt: string;
  /** Stream plain-text deltas instead of returning JSON. Default true. */
  stream?: boolean;
}

export interface LocalAiRouteHandlers {
  /** Reports availability and capabilities as JSON. */
  GET(request: Request): Promise<Response>;
  /** Generates a response for `{ prompt, stream? }`. */
  POST(request: Request): Promise<Response>;
}

const STATUS: Record<LocalAiErrorCode, number> = {
  unavailable: 503,
  unsupported: 501,
  busy: 429,
  cancelled: 499,
  'invalid-input': 400,
  'prompt-too-long': 413,
  'content-blocked': 422,
  'backend-configuration': 500,
  'session-destroyed': 500,
  'generation-failed': 500,
};

/**
 * Next.js App Router handlers backed by local AI on the server.
 *
 * ```ts
 * // app/api/local-ai/route.ts
 * import { createLocalAiRoute } from 'typescript_local_ai/next';
 * export const runtime = 'nodejs';
 * export const { GET, POST } = createLocalAiRoute();
 * ```
 *
 * Each POST uses a fresh session that is destroyed when the response ends or
 * the client disconnects.
 */
export function createLocalAiRoute(options: LocalAiRouteOptions = {}): LocalAiRouteHandlers {
  let ai: LocalAi | undefined;
  const getAi = () => (ai ??= new LocalAi(options.backend ? { backend: options.backend } : {}));
  const maxPromptLength = options.maxPromptLength ?? 8000;

  return {
    async GET() {
      const local = getAi();
      const [availability, capabilities] = await Promise.all([local.availability(), local.capabilities()]);
      return Response.json({ backend: local.info, ...availability, capabilities });
    },

    async POST(request: Request) {
      let body: LocalAiRequestBody;
      try {
        body = parseBody(await request.json(), maxPromptLength);
      } catch (error) {
        return errorResponse(
          error instanceof LocalAiError ? error : new LocalAiError('invalid-input', 'The body must be JSON.'),
        );
      }

      let session;
      try {
        session = await getAi().createSession({ ...options.session, signal: request.signal });
      } catch (error) {
        return errorResponse(error);
      }

      if (body.stream === false) {
        try {
          const { text } = await session.generate(body.prompt, { signal: request.signal });
          return Response.json({ text });
        } catch (error) {
          return errorResponse(error);
        } finally {
          session.destroy();
        }
      }

      const iterator = session.stream(body.prompt, { signal: request.signal })[Symbol.asyncIterator]();
      // Pull the first chunk before committing to a 200, so early failures
      // (unavailable, prompt too long) still get a proper status code.
      let first: IteratorResult<string>;
      try {
        first = await iterator.next();
      } catch (error) {
        session.destroy();
        return errorResponse(error);
      }

      const encoder = new TextEncoder();
      let pending: IteratorResult<string> | undefined = first;
      const stream = new ReadableStream<Uint8Array>({
        async pull(controller) {
          try {
            const result = pending ?? (await iterator.next());
            pending = undefined;
            if (result.done) {
              controller.close();
              session.destroy();
            } else {
              controller.enqueue(encoder.encode(result.value));
            }
          } catch (error) {
            session.destroy();
            controller.error(error);
          }
        },
        async cancel() {
          await iterator.return?.();
          session.destroy();
        },
      });

      return new Response(stream, {
        headers: {
          'content-type': 'text/plain; charset=utf-8',
          'cache-control': 'no-store',
          'x-content-type-options': 'nosniff',
        },
      });
    },
  };
}

function parseBody(value: unknown, maxPromptLength: number): LocalAiRequestBody {
  if (typeof value !== 'object' || value === null) {
    throw new LocalAiError('invalid-input', 'The body must be a JSON object.');
  }
  const { prompt, stream } = value as Record<string, unknown>;
  if (typeof prompt !== 'string' || prompt.trim() === '') {
    throw new LocalAiError('invalid-input', '`prompt` must be a non-empty string.');
  }
  if (prompt.length > maxPromptLength) {
    throw new LocalAiError('prompt-too-long', `\`prompt\` exceeds ${maxPromptLength} characters.`);
  }
  if (stream !== undefined && typeof stream !== 'boolean') {
    throw new LocalAiError('invalid-input', '`stream` must be a boolean.');
  }
  return stream === undefined ? { prompt } : { prompt, stream };
}

function errorResponse(error: unknown): Response {
  const failure =
    error instanceof LocalAiError ? error : new LocalAiError('generation-failed', 'Local AI request failed.');
  return Response.json({ error: { code: failure.code, message: failure.message } }, { status: STATUS[failure.code] });
}
