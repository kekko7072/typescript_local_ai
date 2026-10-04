# typescript_local_ai

Local, on-device AI for TypeScript. One package, with an entry point for each
framework. Part of [Universal Local AI](https://github.com/kekko7072/universal_local_ai)
([vezz.io](https://vezz.io)).

```sh
npm install typescript_local_ai
```

| Import | Use it for | Framework needed |
|---|---|---|
| `typescript_local_ai` | Plain TypeScript, any framework | none |
| `typescript_local_ai/react` | React and Next.js client components | `react >= 18` |
| `typescript_local_ai/vue` | Vue and Nuxt | `vue >= 3.3` |
| `typescript_local_ai/svelte` | Svelte 4/5 and SvelteKit | `svelte >= 4` |
| `typescript_local_ai/next` | Next.js route handlers (server) | `next >= 14` |
| `typescript_local_ai/testing` | Deterministic `FakeBackend` for tests | none |

Frameworks are **optional peer dependencies**. Installing the package never
pulls in React, Vue or Svelte, and each subpath imports only its own framework.

## Backends and current status

The root import picks a backend from the runtime through `package.json`
export conditions:

| Runtime | Default backend | Status |
|---|---|---|
| Browser | Chrome Prompt API (`LanguageModel`, Gemini Nano) | Implemented. It needs a Chromium build that exposes the API, and availability is checked at runtime. |
| Node.js | `@typescript_local_ai/native`, a napi-rs addon over [`rust_local_ai`](https://github.com/kekko7072/rust_local_ai) | Adapter implemented. **The addon is not published yet**, so in Node this backend reports `unavailable` with a reason. |
| Edge / workers | Prompt API build | Reports `unavailable`. There is no on-device model there. |

Capabilities are reported only when the adapter really bridges them. For
example, Chrome supports `responseConstraint` and multimodal input, but this
adapter does not expose them yet, so it reports `structuredOutput: false` and
`imageInput: false`.

## Core API

```ts
import { LocalAi, LocalAiError } from 'typescript_local_ai';

const ai = LocalAi.create();
const { availability, reason } = await ai.availability();
// 'available' | 'downloadable' | 'downloading' | 'unavailable'

if (availability !== 'unavailable') {
  const session = await ai.createSession({
    systemPrompt: 'Answer in one sentence.',
    onDownloadProgress: (p) => console.log(`model ${Math.round(p * 100)}%`),
  });

  const { text } = await session.generate('What is on-device AI?');

  for await (const delta of session.stream('And why does it matter?')) {
    process.stdout.write(delta);
  }

  session.destroy();
}
```

A session is a conversation and runs one turn at a time. Pass `signal` to
`generate` or `stream` to cancel a turn. Failures are thrown as `LocalAiError`
with a typed `code`: `unavailable`, `unsupported`, `busy`, `cancelled`,
`invalid-input`, `prompt-too-long`, `content-blocked`,
`backend-configuration`, `session-destroyed` or `generation-failed`.

To pick a backend yourself, pass `LocalAi.create({ backend: promptApiBackend() })`,
or pass `nativeBackend()` or your own `LocalAiBackend`.

## React (and Next.js client components)

```tsx
'use client';
import { useLocalAi } from 'typescript_local_ai/react';

export function Chat() {
  const ai = useLocalAi({ session: { systemPrompt: 'Be concise.' } });

  if (ai.status === 'checking') return <p>Checking local AI…</p>;
  if (ai.status === 'unavailable') return <p>Not available: {ai.reason}</p>;

  return (
    <>
      <button disabled={ai.status === 'generating'} onClick={() => ai.stream('Hello!')}>
        Ask
      </button>
      {ai.status === 'generating' && <button onClick={ai.cancel}>Stop</button>}
      <p>{ai.output}</p>
      {ai.error && <p role="alert">{ai.error.code}: {ai.error.message}</p>}
    </>
  );
}
```

The built entry starts with `"use client"`. The status is `checking` on the
server and on the first client render, and availability is only probed after
mount, so hydration always matches.

## Vue

```vue
<script setup lang="ts">
import { useLocalAi } from 'typescript_local_ai/vue';
const { status, output, error, stream, cancel } = useLocalAi();
</script>

<template>
  <button :disabled="status === 'generating'" @click="stream('Hello!')">Ask</button>
  <p>{{ output }}</p>
</template>
```

Availability is probed in `onMounted`, which never runs during Nuxt SSR. The
session is released when the component's scope is disposed.

## Svelte

```svelte
<script lang="ts">
  import { localAi } from 'typescript_local_ai/svelte';
  const ai = localAi();
</script>

<button disabled={$ai.status === 'generating'} on:click={() => ai.stream('Hello!')}>Ask</button>
<p>{$ai.output}</p>
```

This is a standard `svelte/store`, so it works in Svelte 4 and 5 without
compiling `.svelte` files. It probes only in the browser.

The actions returned by every framework adapter (`generate`, `stream`,
`check`, `cancel`, `reset`) never reject; failures appear in `status` and
`error`. The underlying `LocalAiController` is framework-neutral and is also
exported from the root import.

## Next.js server

```ts
// app/api/local-ai/route.ts
import { createLocalAiRoute } from 'typescript_local_ai/next';

export const runtime = 'nodejs';
export const { GET, POST } = createLocalAiRoute();
```

- `GET` returns the backend, availability and capabilities as JSON.
- `POST` takes `{ "prompt": string, "stream"?: boolean }`. By default it
  streams `text/plain` deltas; with `stream: false` it returns `{ "text": string }`.
- Errors are returned as `{ error: { code, message } }` with an HTTP status
  (400, 413, 429, 499, 501, 503 and so on).
- Each request gets its own session, which is destroyed when the response
  ends or the client disconnects.

`/next` imports `server-only`, so using it in a client component fails at
build time instead of bundling server code into the browser.

## Testing your app

```ts
import { LocalAi } from 'typescript_local_ai';
import { FakeBackend } from 'typescript_local_ai/testing';

const ai = LocalAi.create({ backend: new FakeBackend({ respond: (p) => `fake: ${p}` }) });
```

## Development

```sh
npm ci
npm run check   # typecheck, unit tests, build, publint, smoke-import every subpath
```

CI runs the same steps on Node 20, 22 and 24, followed by a pack dry run. CI
never publishes.

## Releasing

`.github/workflows/release.yml` publishes to npm with
[provenance](https://docs.npmjs.com/generating-provenance-statements) when a
GitHub release is published.

1. Bump `version` in `package.json` and add an entry to `CHANGELOG.md`.
2. Optional: run Actions → Release → Run workflow. It runs every check and
   `npm publish --dry-run`.
3. Publish a GitHub release tagged `v<version>`. Versions with a prerelease
   suffix (`0.2.0-beta.1`) go to the `next` dist-tag.

One-time setup:

- Create a GitHub environment named `npm` (adding required reviewers is
  recommended).
- **First publish:** npm can only attach a Trusted Publisher to a package that
  already exists. Add a granular npm access token as the `NPM_TOKEN` secret of
  the `npm` environment for the first release.
- **After that:** on npmjs.com → `typescript_local_ai` → Settings → Trusted
  Publisher, add GitHub Actions with owner `kekko7072`, repository
  `typescript_local_ai`, workflow `release.yml` and environment `npm`. Then
  delete the `NPM_TOKEN` secret; later releases use OIDC with no stored token.

The workflow refuses a tag that differs from `package.json` and a version that
is already on npm.

## License

MIT
