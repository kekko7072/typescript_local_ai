import { get } from 'svelte/store';
import { describe, expect, it } from 'vitest';
import { localAi } from '../src/svelte/index.js';
import { FakeBackend } from '../src/testing/index.js';

describe('localAi (Svelte)', () => {
  it('does not probe outside the browser', () => {
    const backend = new FakeBackend();
    backend.availability = () => {
      throw new Error('must not probe during SSR');
    };
    expect(get(localAi({ backend })).status).toBe('checking');
  });

  it('is a store with actions', async () => {
    const backend = new FakeBackend();
    const ai = localAi({ backend });
    const states: string[] = [];
    const unsubscribe = ai.subscribe((s) => states.push(s.status));
    await ai.check();
    await ai.stream('svelte');
    expect(get(ai).output).toBe('echo: svelte');
    expect(states).toContain('generating');
    unsubscribe();
    expect(backend.sessions[0]?.destroyed).toBe(true);
  });
});
