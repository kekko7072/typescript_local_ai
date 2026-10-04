import { describe, expect, it } from 'vitest';
import { createLocalAiRoute } from '../src/next/index.js';
import { FakeBackend } from '../src/testing/index.js';

const post = (body: unknown) =>
  new Request('http://localhost/api/local-ai', { method: 'POST', body: JSON.stringify(body) });

describe('createLocalAiRoute', () => {
  it('reports availability and capabilities', async () => {
    const { GET } = createLocalAiRoute({ backend: new FakeBackend() });
    const res = await GET(new Request('http://localhost/api/local-ai'));
    expect(await res.json()).toMatchObject({ availability: 'available', backend: { id: 'fake' }, capabilities: { streaming: true } });
  });

  it('streams plain text and destroys the session', async () => {
    const backend = new FakeBackend();
    const { POST } = createLocalAiRoute({ backend });
    const res = await POST(post({ prompt: 'stream me' }));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/plain');
    expect(await res.text()).toBe('echo: stream me');
    expect(backend.sessions[0]?.destroyed).toBe(true);
  });

  it('returns JSON when stream is false', async () => {
    const { POST } = createLocalAiRoute({ backend: new FakeBackend() });
    const res = await POST(post({ prompt: 'json', stream: false }));
    expect(await res.json()).toEqual({ text: 'echo: json' });
  });

  it('maps errors to HTTP statuses', async () => {
    const { POST } = createLocalAiRoute({ backend: new FakeBackend(), maxPromptLength: 5 });
    expect((await POST(post({ prompt: '' }))).status).toBe(400);
    expect((await POST(post({ prompt: 'too long' }))).status).toBe(413);
    expect((await POST(new Request('http://x', { method: 'POST', body: 'nope' }))).status).toBe(400);

    const unavailable = createLocalAiRoute({ backend: new FakeBackend({ availability: 'unavailable' }) });
    const res = await unavailable.POST(post({ prompt: 'hi' }));
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ error: { code: 'unavailable' } });
  });
});
