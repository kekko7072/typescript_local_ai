# Changelog

All notable changes to `typescript_local_ai` are documented here. The project
follows [Semantic Versioning](https://semver.org); while it is `0.x`, minor
versions may contain breaking changes.

## 0.1.0 — unreleased

First release.

- Core: `LocalAi`, `LocalAiSession`, typed `LocalAiError`, and the
  framework-neutral `LocalAiController`.
- Backends: the Chrome Prompt API in browsers, and a Node adapter for the
  planned `@typescript_local_ai/native` addon (reports `unavailable` until the
  addon ships).
- Subpaths: `/react` (`useLocalAi`, `"use client"`), `/vue` (`useLocalAi`),
  `/svelte` (`localAi` store), `/next` (`createLocalAiRoute`, `server-only`),
  `/testing` (`FakeBackend`).
