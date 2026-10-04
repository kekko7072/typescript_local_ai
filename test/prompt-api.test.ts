import { afterEach, describe, expect, it, vi } from 'vitest';
import { LocalAi, promptApiBackend, type PromptApiGlobal } from 'typescript_local_ai';

function fakeLanguageModel(overrides: Partial<PromptApiGlobal> = {}) {
  const destroy = vi.fn();
  const create = vi.fn<PromptApiGlobal['create']>(async (options) => {
    options?.monitor?.({ addEventListener: (_type, listener) => listener({ loaded: 0.5 }) });
    return {
      prompt: async (input: string) => `reply to ${input}`,
      promptStreaming: (input: string) =>
        new ReadableStream<string>({
          start(controller) {
            controller.enqueue('reply ');
            controller.enqueue(`to ${input}`);
            controller.close();
          },
        }),
      destroy,
    };
  });
  const api: PromptApiGlobal = { availability: async () => 'available', create, ...overrides };
  return { api, create, destroy };
}

afterEach(() => {
  delete (globalThis as { LanguageModel?: unknown }).LanguageModel;
});

describe('promptApiBackend', () => {
  it('is unavailable without the LanguageModel global', async () => {
    const backend = promptApiBackend();
    expect((await backend.availability()).availability).toBe('unavailable');
    expect((await backend.capabilities()).streaming).toBe(false);
  });

  it('is the default backend of the browser entry', async () => {
    const { api } = fakeLanguageModel();
    (globalThis as { LanguageModel?: unknown }).LanguageModel = api;
    const ai = LocalAi.create();
    expect(ai.info.id).toBe('chrome-prompt-api');
    expect(await ai.availability()).toEqual({ availability: 'available' });
  });

  it('passes session options and download progress', async () => {
    const { api, create, destroy } = fakeLanguageModel();
    const progress = vi.fn();
    const ai = LocalAi.create({ backend: promptApiBackend({ languageModel: api }) });
    const session = await ai.createSession({ systemPrompt: 'sys', temperature: 0.2, topK: 3, onDownloadProgress: progress });
    expect(create.mock.calls[0]?.[0]).toMatchObject({
      initialPrompts: [{ role: 'system', content: 'sys' }],
      temperature: 0.2,
      topK: 3,
    });
    expect(progress).toHaveBeenCalledWith(0.5);

    expect((await session.generate('hi')).text).toBe('reply to hi');
    const chunks: string[] = [];
    for await (const chunk of session.stream('you')) chunks.push(chunk);
    expect(chunks.join('')).toBe('reply to you');
    session.destroy();
    expect(destroy).toHaveBeenCalledOnce();
  });

  it('requires temperature and topK together', async () => {
    const { api } = fakeLanguageModel();
    const ai = LocalAi.create({ backend: promptApiBackend({ languageModel: api }) });
    await expect(ai.createSession({ temperature: 1 })).rejects.toMatchObject({ code: 'invalid-input' });
  });

  it('maps DOMException names to error codes', async () => {
    const { api } = fakeLanguageModel();
    const backend = promptApiBackend({
      languageModel: {
        ...api,
        create: async () => ({
          prompt: async () => {
            throw new DOMException('too big', 'QuotaExceededError');
          },
          promptStreaming: () => new ReadableStream(),
          destroy: () => undefined,
        }),
      },
    });
    const session = await LocalAi.create({ backend }).createSession();
    await expect(session.generate('x')).rejects.toMatchObject({ code: 'prompt-too-long', message: 'too big' });
  });
});
