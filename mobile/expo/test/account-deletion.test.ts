import { FakeSecureStore } from '@app/native-adapters/testing';
import { afterEach, describe, expect, it } from 'vitest';
import type { AuthEngine } from '@app/native-auth';
import { createAccountDeletion } from '../src/account-deletion';
import { startShell } from './support/shell';

const RECEIPT_STORAGE_KEY = 'fixture.deletion.receipt';
const RECEIPT_KEY = 'receipt-for-user-1';
const engines: AuthEngine[] = [];

async function account() {
  const { auth } = startShell();
  engines.push(auth.engine);
  await auth.engine.restore();
  expect((await auth.engine.signIn()).kind).toBe('signedIn');
  const store = new FakeSecureStore();
  const start = () =>
    createAccountDeletion({
      engine: auth.engine,
      crypto: {
        randomBytes: async (length) => new Uint8Array(length),
        sha256: async (bytes) => bytes,
      },
      receiptTransport: auth.accountDeletion.receiptTransport,
      store,
      options: { keychainAccessible: 4 },
      storageKey: RECEIPT_STORAGE_KEY,
    });
  return { auth, store, start };
}

afterEach(() => {
  for (const engine of engines.splice(0)) engine.dispose();
});

describe('durable deletion receipt ownership', () => {
  it('recovers the writer receipt after restart and after the session ends', async () => {
    const { auth, start } = await account();
    await start().receipts.write(RECEIPT_KEY);
    expect(await start().receipts.read()).toBe(RECEIPT_KEY);
    await auth.engine.signOut();
    const recovered = start();
    expect(await recovered.receipts.read()).toBe(RECEIPT_KEY);
    await recovered.receipts.clear();
    expect(await start().receipts.read()).toBeNull();
  });

  it('refuses another account receipt without replacing or clearing it', async () => {
    const { store, start } = await account();
    const foreign = JSON.stringify({ owner: 'user-2', key: 'other-receipt' });
    store.items.set(RECEIPT_STORAGE_KEY, foreign);
    const deletion = start();
    await expect(deletion.receipts.read()).rejects.toThrow();
    await expect(deletion.receipts.write(RECEIPT_KEY)).rejects.toThrow();
    await expect(deletion.receipts.clear()).rejects.toThrow();
    expect(store.items.get(RECEIPT_STORAGE_KEY)).toBe(foreign);
  });

  it('keeps a replacement receipt when an earlier controller tries to clear it', async () => {
    const { store, start } = await account();
    const deletion = start();
    await deletion.receipts.write(RECEIPT_KEY);
    const replacement = JSON.stringify({ owner: 'user-1', key: 'later-receipt' });
    store.items.set(RECEIPT_STORAGE_KEY, replacement);
    await expect(deletion.receipts.clear()).rejects.toThrow();
    expect(store.items.get(RECEIPT_STORAGE_KEY)).toBe(replacement);
  });

  it('does not erase unreadable or temporarily unavailable receipt storage', async () => {
    const { store, start } = await account();
    store.items.set(RECEIPT_STORAGE_KEY, 'unreadable');
    await expect(start().receipts.read()).rejects.toThrow();
    await expect(start().receipts.write(RECEIPT_KEY)).rejects.toThrow();
    expect(store.items.get(RECEIPT_STORAGE_KEY)).toBe('unreadable');
    store.readFailure = 'Keychain unavailable';
    await expect(start().receipts.clear()).rejects.toThrow();
    expect(store.items.get(RECEIPT_STORAGE_KEY)).toBe('unreadable');
  });
});
