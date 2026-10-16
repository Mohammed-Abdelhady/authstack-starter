import type { Provider } from '@nestjs/common';
import { UniqueConflictError } from '../../src/common/persistence/persistence-errors';
import type { UnitOfWork } from '../../src/common/persistence/unit-of-work';
import { Clock } from '../../src/common/services/clock';
// feature:oauth-core:start
import { ProviderRevocations } from '../../src/auth/oauth/provider-tokens/services/provider-revocations';
import { MemoryProviderTokenStore } from '../../src/auth/oauth/provider-tokens/testing/provider-token-memory.harness-spec';
// feature:oauth-core:end
import { AccountDeletionService } from '../../src/user/erasure/services/account-deletion.service';
import { ErasureSettings } from '../../src/user/erasure/services/erasure-settings';
import { ErasureWorker } from '../../src/user/erasure/services/erasure-worker';
import {
  AccountDeletionStore,
  DELETION_RECEIPT_CONSTRAINT,
} from '../../src/user/erasure/stores/account-deletion.store';
import {
  InPlaceRunner,
  MemoryAccountEraser,
  MemoryAddressLedger,
  MemoryErasureJobStore,
  MemoryErasureWorld,
  RecordingHook,
} from '../../src/user/erasure/testing/erasure-memory.harness-spec';
import type {
  DeletionRecord,
  StoredDeletionReceipt,
} from '../../src/user/erasure/types/account-deletion';

/** The deletion store's rules in memory: each receipt key is stored once. */
export class MemoryAccountDeletionStore extends AccountDeletionStore {
  readonly receipts = new Map<string, StoredDeletionReceipt>();
  readonly schedules = new Map<string, Date | null>();

  findReceiptIn(
    _unitOfWork: UnitOfWork,
    keyHash: string,
  ): Promise<StoredDeletionReceipt | null> {
    return this.findReceipt(keyHash);
  }

  recordIn(_unitOfWork: UnitOfWork, record: DeletionRecord): Promise<void> {
    const { receipt } = record;
    if (receipt && this.receipts.has(receipt.keyHash)) {
      return Promise.reject(
        new UniqueConflictError(DELETION_RECEIPT_CONSTRAINT.KEY),
      );
    }
    this.schedules.set(record.userId, record.eraseAfter);
    if (receipt) {
      this.receipts.set(receipt.keyHash, {
        userId: record.userId,
        eraseAfter: record.eraseAfter,
        recordedAt: receipt.recordedAt,
      });
    }
    return Promise.resolve();
  }

  findReceipt(keyHash: string): Promise<StoredDeletionReceipt | null> {
    return Promise.resolve(this.receipts.get(keyHash) ?? null);
  }

  findEraseAfter(userId: string): Promise<Date | null> {
    return Promise.resolve(this.schedules.get(userId) ?? null);
  }
}

/**
 * A worker over empty memory stores, for a test of the deletion request alone:
 * asked to run, it finds nothing due.
 */
export function idleErasureWorker(
  clock: Clock,
  settings: ErasureSettings,
): ErasureWorker {
  const world = new MemoryErasureWorld();
  return new ErasureWorker(
    new MemoryErasureJobStore(world),
    new MemoryAccountEraser(world),
    new RecordingHook(),
    new InPlaceRunner(),
    clock,
    settings,
    new MemoryAddressLedger(),
    new ProviderRevocations(new MemoryProviderTokenStore(), clock), // feature:oauth-core
  );
}

/**
 * The deletion service for a testing module that has the config, the clock
 * and the mail services, on a memory store unless one is given.
 */
export function accountDeletionProviders(
  store: AccountDeletionStore = new MemoryAccountDeletionStore(),
): Provider[] {
  return [
    { provide: AccountDeletionStore, useValue: store },
    ErasureSettings,
    {
      provide: ErasureWorker,
      inject: [Clock, ErasureSettings],
      useFactory: idleErasureWorker,
    },
    AccountDeletionService,
  ];
}
