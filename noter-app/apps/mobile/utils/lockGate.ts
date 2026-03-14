export type LockGateState = {
  isLocked: boolean;
  checking: boolean;
  hasToken: boolean;
  isInitialized: boolean;
};

export const canNavigateToSensitiveRoute = (state: LockGateState) => {
  if (state.isLocked) return false;
  if (state.checking) return false;
  if (!state.hasToken) return false;
  if (!state.isInitialized) return false;
  return true;
};
