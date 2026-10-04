import { readable, type Readable } from 'svelte/store';
import {
  INITIAL_LOCAL_AI_STATE,
  LocalAiController,
  type LocalAiActions,
  type LocalAiControllerOptions,
  type LocalAiState,
} from 'typescript_local_ai';

export type LocalAiStoreOptions = LocalAiControllerOptions;

export interface LocalAiStore extends Readable<LocalAiState>, LocalAiActions {
  controller: LocalAiController;
}

/**
 * Svelte store over one local AI conversation; works with `$store` in
 * Svelte 4 and 5. Availability is probed on first subscription in the
 * browser only, so SvelteKit SSR renders `checking`.
 */
export function localAi(options?: LocalAiStoreOptions): LocalAiStore {
  const controller = new LocalAiController(options);
  const store = readable<LocalAiState>(INITIAL_LOCAL_AI_STATE, (set) => {
    set(controller.getState());
    const unsubscribe = controller.subscribe(set);
    if (typeof window !== 'undefined') void controller.actions.check();
    return () => {
      unsubscribe();
      controller.dispose();
    };
  });

  return { subscribe: store.subscribe, ...controller.actions, controller };
}

export type { LocalAiState, LocalAiStatus, LocalAiActions, LocalAiControllerOptions } from 'typescript_local_ai';
