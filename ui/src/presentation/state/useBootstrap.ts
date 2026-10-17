import { useAppBootstrap, type AudioRuntime } from './useAppBootstrap';
import { useAutoSave } from './useAutoSave';

export type { AudioRuntime };

export const useBootstrap = (): AudioRuntime => {
  useAutoSave();
  return useAppBootstrap();
};
