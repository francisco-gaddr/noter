export const createMockStoreState = <T extends Record<string, any>>(state: T): T => state;

export const createSelectorStoreMock = <T extends Record<string, any>>(stateOrFactory: T | (() => T)) => ({
  useStore: (selector?: (state: T) => unknown) => {
    const state = typeof stateOrFactory === 'function'
      ? (stateOrFactory as () => T)()
      : stateOrFactory;
    return selector ? selector(state) : state;
  },
});
