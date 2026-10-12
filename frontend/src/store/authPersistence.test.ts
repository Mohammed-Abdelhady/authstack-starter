import { describe, expect, it } from 'vitest';
import { configureStore, type UnknownAction } from '@reduxjs/toolkit';
import { persistReducer, persistStore, type Storage } from 'redux-persist';
import { authPersistence } from './authPersistence';
import type { AuthState } from '@/modules/auth/types/auth.types';

const initial: AuthState = {
  user: null,
  isAuthenticated: false,
  isLoading: false,
  error: null,
  validationStatus: 'idle',
  validationErrorStatus: null,
  sessionGeneration: 0,
  identityRequest: null,
};

function memoryStorage(saved?: Record<string, unknown>): {
  storage: Storage;
  values: Map<string, string>;
} {
  const values = new Map<string, string>();
  if (saved)
    values.set(
      'persist:auth',
      JSON.stringify(
        Object.fromEntries(
          Object.entries(saved).map(([key, value]) => [key, JSON.stringify(value)]),
        ),
      ),
    );
  return {
    values,
    storage: {
      getItem: (key: string) => Promise.resolve(values.get(key) ?? null),
      setItem: (key: string, value: string) => {
        values.set(key, value);
        return Promise.resolve();
      },
      removeItem: (key: string) => {
        values.delete(key);
        return Promise.resolve();
      },
    },
  };
}

async function boot(storage: Storage) {
  const reducer = (state = initial, action: UnknownAction): AuthState =>
    action.type === 'login'
      ? { ...state, isAuthenticated: true, isLoading: true, error: 'transient error' }
      : state;
  const store = configureStore({
    reducer: persistReducer(authPersistence(storage), reducer),
    middleware: (getDefaultMiddleware) => getDefaultMiddleware({ serializableCheck: false }),
  });
  let ready!: () => void;
  const rehydrated = new Promise<void>((resolve) => {
    ready = resolve;
  });
  const persistor = persistStore(store, undefined, ready);
  await rehydrated;
  return { store, persistor };
}

describe('auth persistence', () => {
  it('round-trips only the boolean hint and restores transient defaults', async () => {
    const { storage, values } = memoryStorage();
    const first = await boot(storage);
    first.store.dispatch({ type: 'login' });
    await first.persistor.flush();
    first.persistor.pause();
    expect(Object.keys(JSON.parse(values.get('persist:auth')!) as object).sort()).toEqual([
      '_persist',
      'isAuthenticated',
    ]);
    const second = await boot(storage);
    expect(second.store.getState()).toMatchObject({ ...initial, isAuthenticated: true });
    second.persistor.pause();
  });

  it.each([null, 'true', 1, [], { isAuthenticated: true }])(
    'discards malformed legacy hint %j and transient fields',
    async (hint) => {
      const { storage } = memoryStorage({
        isAuthenticated: hint,
        user: { isAuthenticated: true },
        isLoading: { isAuthenticated: false },
        error: { isAuthenticated: false },
        _persist: { isAuthenticated: false },
      });
      const { store, persistor } = await boot(storage);
      expect(store.getState()).toMatchObject(initial);
      expect(store.getState()._persist).toEqual({ version: 2, rehydrated: true });
      persistor.pause();
    },
  );
});
