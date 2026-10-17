import type { AuthEngine, CryptoPort, AbortSignalPort } from '@app/native-auth';
import type { SecureStoreApi, SecureStoreOptionsApi } from '@app/native-adapters';
import type { Transport } from '@app/sdk';
import type { AccountDeletionProps } from '@app/native-ui';

interface ReceiptRecord {
  owner: string;
  key: string;
}

function receiptRecord(raw: string): ReceiptRecord {
  const value: unknown = JSON.parse(raw);
  if (
    typeof value !== 'object' ||
    value === null ||
    !('owner' in value) ||
    typeof value.owner !== 'string' ||
    !('key' in value) ||
    typeof value.key !== 'string'
  ) {
    throw new Error('The deletion receipt record is unreadable');
  }
  return { owner: value.owner, key: value.key };
}

export function createAccountDeletion(input: {
  engine: AuthEngine;
  crypto: CryptoPort;
  receiptTransport: Transport<AbortSignalPort>;
  store: SecureStoreApi;
  options: SecureStoreOptionsApi;
  storageKey: string;
}): AccountDeletionProps {
  let held: ReceiptRecord | undefined;
  let ownerAtIssue: string | undefined;
  const currentOwner = () => input.engine.snapshot.profile?.id;
  const load = async () => {
    const raw = await input.store.getItemAsync(input.storageKey, input.options);
    return raw === null ? null : receiptRecord(raw);
  };
  return {
    randomBytes: (length) => input.crypto.randomBytes(length),
    receiptTransport: input.receiptTransport,
    receipts: {
      read: async () => {
        const record = await load();
        if (record && currentOwner() && record.owner !== currentOwner()) {
          throw new Error('An unresolved receipt belongs to another account');
        }
        held = record ?? undefined;
        ownerAtIssue = record?.owner;
        return record?.key ?? null;
      },
      write: async (key) => {
        const owner = currentOwner();
        if (!owner) throw new Error('No account is signed in');
        const previous = await load();
        if (previous && (previous.owner !== owner || previous.key !== key)) {
          throw new Error('An earlier deletion receipt is unresolved');
        }
        await input.store.setItemAsync(
          input.storageKey,
          JSON.stringify({ owner, key }),
          input.options,
        );
        held = { owner, key };
        ownerAtIssue = owner;
      },
      clear: async () => {
        const current = await load();
        if (current && (current.owner !== held?.owner || current.key !== held.key)) {
          throw new Error('The deletion receipt changed');
        }
        await input.store.deleteItemAsync(input.storageKey, input.options);
        held = undefined;
      },
    },
    onDeleted: () => {
      if (ownerAtIssue && currentOwner() === ownerAtIssue) void input.engine.signOut();
    },
  };
}
