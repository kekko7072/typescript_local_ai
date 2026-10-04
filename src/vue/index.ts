import { computed, getCurrentInstance, getCurrentScope, onMounted, onScopeDispose, shallowRef, type ComputedRef, type ShallowRef } from 'vue';
import {
  LocalAiController,
  type LocalAiActions,
  type LocalAiAvailability,
  type LocalAiControllerOptions,
  type LocalAiError,
  type LocalAiState,
  type LocalAiStatus,
} from 'typescript_local_ai';

export type UseLocalAiOptions = LocalAiControllerOptions;

export interface UseLocalAiResult extends LocalAiActions {
  state: Readonly<ShallowRef<LocalAiState>>;
  status: ComputedRef<LocalAiStatus>;
  availability: ComputedRef<LocalAiAvailability | null>;
  reason: ComputedRef<string | null>;
  output: ComputedRef<string>;
  error: ComputedRef<LocalAiError | null>;
  downloadProgress: ComputedRef<number | null>;
  controller: LocalAiController;
}

/**
 * Vue composable over one local AI conversation. Inside a component,
 * availability is probed in `onMounted`, which never runs during SSR.
 */
export function useLocalAi(options?: UseLocalAiOptions): UseLocalAiResult {
  const controller = new LocalAiController(options);
  const state = shallowRef(controller.getState());
  const unsubscribe = controller.subscribe((next) => {
    state.value = next;
  });

  if (getCurrentInstance()) {
    onMounted(() => void controller.actions.check());
  } else if (typeof window !== 'undefined') {
    void controller.actions.check();
  }
  if (getCurrentScope()) {
    onScopeDispose(() => {
      unsubscribe();
      controller.dispose();
    });
  }

  return {
    state,
    status: computed(() => state.value.status),
    availability: computed(() => state.value.availability),
    reason: computed(() => state.value.reason),
    output: computed(() => state.value.output),
    error: computed(() => state.value.error),
    downloadProgress: computed(() => state.value.downloadProgress),
    ...controller.actions,
    controller,
  };
}

export type { LocalAiState, LocalAiStatus, LocalAiActions, LocalAiControllerOptions } from 'typescript_local_ai';
