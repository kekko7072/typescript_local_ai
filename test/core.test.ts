import { describe, expect, it } from 'vitest';
import { LocalAi, LocalAiController, LocalAiError } from 'typescript_local_ai';
import { FakeBackend } from '../src/testing/index.js';

describe('LocalAi', () => {
  it('creates sessions that generate and stream', async () => {
    const ai = LocalAi.create({ backend: new FakeBackend() });
    const session = await ai.createSession({ systemPrompt: 'Be brief.' });
    expect((await session.generate('hello')).text).toBe('echo: hello');
    const chunks: string[] = [];
    for await (const chunk of session.stream('one two')) chunks.push(chunk);
    expect(chunks).toEqual(['echo: ', 'one ', 'two']);
  });

  it('refuses sessions when the backend is unavailable', async () => {
    const ai = LocalAi.create({ backend: new FakeBackend({ availability: 'unavailable', reason: 'no model' }) });
    expect(await ai.availability()).toEqual({ availability: 'unavailable', reason: 'no model' });
    await expect(ai.createSession()).rejects.toMatchObject({ code: 'unavailable', message: 'no model' });
  });

  it('allows one turn at a time and rejects empty prompts', async () => {
    const session = await LocalAi.create({ backend: new FakeBackend({ chunkDelayMs: 5 }) }).createSession();
    const first = session.generate('a');
    await expect(session.generate('b')).rejects.toMatchObject({ code: 'busy' });
    await first;
    await expect(session.generate('  ')).rejects.toMatchObject({ code: 'invalid-input' });
    session.destroy();
    await expect(session.generate('c')).rejects.toMatchObject({ code: 'session-destroyed' });
  });

  it('maps aborts to cancelled', async () => {
    const session = await LocalAi.create({ backend: new FakeBackend({ chunkDelayMs: 20 }) }).createSession();
    const abort = new AbortController();
    const pending = session.generate('x', { signal: abort.signal });
    abort.abort();
    await expect(pending).rejects.toSatisfy((e) => LocalAiError.is(e, 'cancelled'));
    expect(session.busy).toBe(false);
  });
});

describe('LocalAiController', () => {
  it('starts in checking and never probes on construction', () => {
    const backend = new FakeBackend();
    let probed = false;
    backend.availability = async () => {
      probed = true;
      return { availability: 'available' };
    };
    const controller = new LocalAiController({ backend });
    expect(controller.getState().status).toBe('checking');
    expect(probed).toBe(false);
  });

  it('tracks availability, streaming output and conversation reuse', async () => {
    const backend = new FakeBackend({ availability: 'downloadable' });
    const controller = new LocalAiController({ backend, session: { systemPrompt: 'sys' } });
    const seen: string[] = [];
    controller.subscribe((s) => seen.push(s.output));

    await controller.check();
    expect(controller.getState().status).toBe('downloadable');

    expect(await controller.stream('hi there')).toBe('echo: hi there');
    expect(controller.getState()).toMatchObject({ status: 'ready', availability: 'available', output: 'echo: hi there' });
    expect(seen).toContain('echo: hi ');

    await controller.generate('again');
    expect(backend.sessions).toHaveLength(1);
    expect(backend.sessions[0]?.options.systemPrompt).toBe('sys');

    controller.reset();
    expect(backend.sessions[0]?.destroyed).toBe(true);
    expect(controller.getState().output).toBe('');
    await controller.generate('fresh');
    expect(backend.sessions).toHaveLength(2);
  });

  it('cancels without reporting an error', async () => {
    const controller = new LocalAiController({ backend: new FakeBackend({ chunkDelayMs: 20 }) });
    const pending = controller.stream('a b c');
    await new Promise((r) => setTimeout(r, 30));
    controller.cancel();
    expect(await pending).toBeUndefined();
    expect(controller.getState()).toMatchObject({ status: 'ready', error: null });
  });

  it('reports failures in state; actions never reject', async () => {
    const backend = new FakeBackend({
      respond: () => {
        throw new LocalAiError('content-blocked', 'blocked');
      },
    });
    const controller = new LocalAiController({ backend });
    await expect(controller.generate('x')).rejects.toMatchObject({ code: 'content-blocked' });
    expect(await controller.actions.generate('x')).toBeUndefined();
    expect(controller.getState()).toMatchObject({ status: 'error', error: { code: 'content-blocked' } });
  });

  it('rejects overlapping generations', async () => {
    const controller = new LocalAiController({ backend: new FakeBackend({ chunkDelayMs: 5 }) });
    const first = controller.generate('a');
    await expect(controller.generate('b')).rejects.toMatchObject({ code: 'busy' });
    await first;
  });
});
