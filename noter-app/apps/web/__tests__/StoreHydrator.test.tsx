import React from 'react';
import { render, waitFor } from '@testing-library/react';
import StoreHydrator from '../components/StoreHydrator';

const mockHydrate = jest.fn();
const mockInitWebEncryptionKey = jest.fn();

jest.mock('../stores/useStore', () => ({
  useStore: (selector?: any) => {
    const state = { hydrate: mockHydrate };
    return selector ? selector(state) : state;
  },
}));

jest.mock('../services/encryptionKey', () => ({
  initWebEncryptionKey: () => mockInitWebEncryptionKey(),
}));

describe('StoreHydrator', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockInitWebEncryptionKey.mockResolvedValue(undefined);
  });

  it('hydrates after encryption key initialization succeeds', async () => {
    render(<StoreHydrator />);

    await waitFor(() => {
      expect(mockInitWebEncryptionKey).toHaveBeenCalledTimes(1);
      expect(mockHydrate).toHaveBeenCalledTimes(1);
    });
  });

  it('hydrates even if encryption key initialization fails', async () => {
    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    mockInitWebEncryptionKey.mockRejectedValue(new Error('init failed'));

    render(<StoreHydrator />);

    await waitFor(() => {
      expect(mockHydrate).toHaveBeenCalledTimes(1);
    });

    consoleErrorSpy.mockRestore();
  });
});
