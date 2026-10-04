// Imports every built subpath through the package's own exports map, the way
// a consumer would, to catch export, condition and directive mistakes.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = await import('typescript_local_ai');
assert.equal(typeof root.LocalAi, 'function');
// Node resolves the "node" condition, so the default backend is native.
assert.equal(root.LocalAi.create().info.id, 'native');
assert.equal((await root.LocalAi.create().availability()).availability, 'unavailable');

const testing = await import('typescript_local_ai/testing');
const session = await root.LocalAi.create({ backend: new testing.FakeBackend() }).createSession();
assert.equal((await session.generate('smoke')).text, 'echo: smoke');

const react = await import('typescript_local_ai/react');
assert.equal(typeof react.useLocalAi, 'function');
const reactSource = await readFile(new URL('../dist/react/index.js', import.meta.url), 'utf8');
assert.ok(reactSource.startsWith('"use client";'), 'react entry must start with "use client"');

const vue = await import('typescript_local_ai/vue');
assert.equal(typeof vue.useLocalAi, 'function');

const svelte = await import('typescript_local_ai/svelte');
assert.equal(typeof svelte.localAi, 'function');

console.log('smoke: root, testing, react, vue, svelte OK');
