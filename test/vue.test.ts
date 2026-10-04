import { describe, expect, it } from 'vitest';
import { createSSRApp, defineComponent, effectScope, h, nextTick } from 'vue';
import { renderToString } from 'vue/server-renderer';
import { useLocalAi } from '../src/vue/index.js';
import { FakeBackend } from '../src/testing/index.js';

describe('useLocalAi (Vue)', () => {
  it('renders checking during SSR without probing', async () => {
    const backend = new FakeBackend();
    backend.availability = () => {
      throw new Error('must not probe during SSR');
    };
    const App = defineComponent({
      setup() {
        const ai = useLocalAi({ backend });
        return () => h('span', ai.status.value);
      },
    });
    expect(await renderToString(createSSRApp(App))).toContain('checking');
  });

  it('exposes reactive state and cleans up with its scope', async () => {
    const backend = new FakeBackend();
    const scope = effectScope();
    const ai = scope.run(() => useLocalAi({ backend }))!;
    await ai.check();
    expect(ai.status.value).toBe('ready');
    await ai.generate('vue');
    await nextTick();
    expect(ai.output.value).toBe('echo: vue');
    scope.stop();
    expect(backend.sessions[0]?.destroyed).toBe(true);
  });
});
