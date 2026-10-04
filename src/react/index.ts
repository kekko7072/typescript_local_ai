import { useEffect, useState, useSyncExternalStore } from 'react';
import {
  INITIAL_LOCAL_AI_STATE,
  LocalAiController,
  type LocalAiActions,
  type LocalAiControllerOptions,
  type LocalAiState,
} from 'typescript_local_ai';

export type UseLocalAiOptions = LocalAiControllerOptions;

export interface UseLocalAiResult extends LocalAiState, LocalAiActions {
  controller: LocalAiController;
}

const getServerSnapshot = (): LocalAiState => INITIAL_LOCAL_AI_STATE;

/**
 * React hook over one local AI conversation. Options are read on first
 * render. Availability is probed after mount, so server rendering and the
 * first client render both report `checking`.
 */
export function useLocalAi(options?: UseLocalAiOptions): UseLocalAiResult {
  const [controller] = useState(() => new LocalAiController(options));
  const state = useSyncExternalStore(controller.subscribe, controller.getState, getServerSnapshot);

  useEffect(() => {
    void controller.actions.check();
    return controller.dispose;
  }, [controller]);

  return { ...state, ...controller.actions, controller };
}

export type { LocalAiState, LocalAiStatus, LocalAiActions, LocalAiControllerOptions } from 'typescript_local_ai';
