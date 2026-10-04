// @vitest-environment jsdom
import { act, render, screen } from '@testing-library/react';
import { StrictMode } from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { useLocalAi } from '../src/react/index.js';
import { FakeBackend } from '../src/testing/index.js';

function Chat({ backend }: { backend: FakeBackend }) {
  const ai = useLocalAi({ backend });
  return (
    <div>
      <span data-testid="status">{ai.status}</span>
      <span data-testid="output">{ai.output}</span>
      <button onClick={() => void ai.stream('hello world')}>send</button>
    </div>
  );
}

describe('useLocalAi (React)', () => {
  it('renders checking on the server without probing', () => {
    const backend = new FakeBackend();
    backend.availability = () => {
      throw new Error('must not probe during SSR');
    };
    expect(renderToString(<Chat backend={backend} />)).toContain('checking');
  });

  it('probes after mount and streams output under Strict Mode', async () => {
    const backend = new FakeBackend();
    render(
      <StrictMode>
        <Chat backend={backend} />
      </StrictMode>,
    );
    expect(await screen.findByText('ready')).toBeTruthy();
    await act(async () => {
      screen.getByText('send').click();
    });
    expect(screen.getByTestId('output').textContent).toBe('echo: hello world');
    expect(screen.getByTestId('status').textContent).toBe('ready');
  });
});
