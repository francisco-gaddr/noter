const TOKEN_KEYS = ['token', 'auth_token'] as const;
const REFRESH_TOKEN_KEYS = ['refresh_token', 'auth_refresh_token'] as const;

const getSafeStorage = (kind: 'local' | 'session') => {
  if (typeof window === 'undefined') return null;
  try {
    return kind === 'local' ? window.localStorage : window.sessionStorage;
  } catch {
    return null;
  }
};

export const setWebAuthToken = (token: string | null) => {
  const session = getSafeStorage('session');
  const local = getSafeStorage('local');
  if (token) {
    for (const key of TOKEN_KEYS) {
      session?.setItem(key, token);
      local?.removeItem(key);
    }
    return;
  }
  for (const key of TOKEN_KEYS) {
    session?.removeItem(key);
    local?.removeItem(key);
  }
};

export const setWebRefreshToken = (token: string | null) => {
  const session = getSafeStorage('session');
  const local = getSafeStorage('local');
  if (token) {
    for (const key of REFRESH_TOKEN_KEYS) {
      session?.setItem(key, token);
      local?.removeItem(key);
    }
    return;
  }
  for (const key of REFRESH_TOKEN_KEYS) {
    session?.removeItem(key);
    local?.removeItem(key);
  }
};

export const getWebAuthTokenSync = (): string | null => {
  const session = getSafeStorage('session');
  const local = getSafeStorage('local');
  for (const key of TOKEN_KEYS) {
    const fromSession = session?.getItem(key);
    if (fromSession) return fromSession;
  }
  for (const key of TOKEN_KEYS) {
    const fromLocal = local?.getItem(key);
    if (fromLocal) {
      setWebAuthToken(fromLocal);
      return fromLocal;
    }
  }
  return null;
};

export const getWebRefreshTokenSync = (): string | null => {
  const session = getSafeStorage('session');
  const local = getSafeStorage('local');
  for (const key of REFRESH_TOKEN_KEYS) {
    const fromSession = session?.getItem(key);
    if (fromSession) return fromSession;
  }
  for (const key of REFRESH_TOKEN_KEYS) {
    const fromLocal = local?.getItem(key);
    if (fromLocal) {
      setWebRefreshToken(fromLocal);
      return fromLocal;
    }
  }
  return null;
};
