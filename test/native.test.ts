import { describe, expect, it, vi } from 'vitest';
import { LocalAi, nativeBackend, type NativeAddon } from 'typescript_local_ai';

describe('nativeBackend', () => {
  it('reports unavailable when the addon is not installed', async () => {
    const backend = nativeBackend();
    const report = await backend.availability();
    expect(report.availability).toBe('unavailable');
    expect(report.reason).toContain('@typescript_local_ai/native');
    await expect(LocalAi.create({ backend }).createSession()).rejects.toMatchObject({ code: 'unavailable' });
  });

  it('adapts callback streaming and cancellation', async () => {
    const cancel = vi.fn();
    const addon: NativeAddon = {
      availability: async () => ({ availability: 'available' }),
      capabilities: async () => ({ streaming: true, structuredOutput: false, toolCalling: false, imageInput: false, modelPreparation: false }),
      createSession: async () => ({
        prompt: async (input) => `native ${input}`,
        promptStreaming: async (input, onChunk) => {
          onChunk('native ');
          await Promise.resolve();
          onChunk(input);
        },
        cancel,
        destroy: () => undefined,
      }),
    };
    const session = await LocalAi.create({ backend: nativeBackend({ addon }) }).createSession();
    expect((await session.generate('a')).text).toBe('native a');
    const chunks: string[] = [];
    for await (const chunk of session.stream('b')) chunks.push(chunk);
    expect(chunks).toEqual(['native ', 'b']);
    expect(cancel).not.toHaveBeenCalled();
  });
});
