// Run with --conditions=react-server: `server-only` throws in any other
// environment, which is exactly what keeps /next out of client bundles.
import assert from 'node:assert/strict';

const { createLocalAiRoute } = await import('typescript_local_ai/next');
const { FakeBackend } = await import('typescript_local_ai/testing');
const { POST } = createLocalAiRoute({ backend: new FakeBackend() });
const res = await POST(new Request('http://localhost', { method: 'POST', body: JSON.stringify({ prompt: 'next' }) }));
assert.equal(await res.text(), 'echo: next');
console.log('smoke: next OK');
