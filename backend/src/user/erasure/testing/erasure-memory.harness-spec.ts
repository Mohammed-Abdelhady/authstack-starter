import {
  UnitOfWork,
  UnitOfWorkRunner,
} from '../../../common/persistence/unit-of-work';
import { AddressLedger } from '../../../common/persistence/address-ledger';
import type { OwnedAddressLookup } from '../../../common/persistence/types/address-ledger';
import { AccountErasureHook } from '../account-erasure-hook';
import {
  ERASURE_STANDING,
  ERASURE_STEP,
  type ErasureStanding,
} from '../constants/erasure.constants';
import { AccountEraser } from '../stores/account-eraser';
import { ErasureJobStore } from '../stores/erasure-job.store';
import type {
  AccountErasureRead,
  BegunErasure,
  ErasureFacts,
  ErasureFailure,
  ErasureJob,
  ErasureLease,
  ErasureSubject,
  LinkedIdentity,
  UnscheduledSelection,
} from '../types/erasure';

class MemoryUnitOfWork extends UnitOfWork {}

/** Runs the work at once; the in-memory stores need no transaction. */
export class InPlaceRunner extends UnitOfWorkRunner {
  run<Result>(work: (unitOfWork: UnitOfWork) => Promise<Result>) {
    return work(new MemoryUnitOfWork());
  }
}

export interface MemoryAccount {
  isDeleted: boolean;
  eraseAfter: Date | null;
  deletedAt?: Date;
  /** The mark a person's own deletion leaves. */
  selfDeletedAt?: Date;
  address: string | null;
  pendingAddress: string | null;
  identities: LinkedIdentity[];
}

interface MemoryJob extends ErasureJob {
  leaseOwner: string | null;
  leaseUntil: Date | null;
}

/** The ports' rules, kept in maps: one job per account, leases, steps. */
export class MemoryErasureWorld {
  readonly accounts = new Map<string, MemoryAccount>();
  readonly jobs = new Map<string, MemoryJob>();
  private nextJob = 1;

  jobOf(userId: string): MemoryJob | undefined {
    return this.jobs.get(userId);
  }

  isDue(userId: string, now: Date): boolean {
    const account = this.accounts.get(userId);
    const job = this.jobs.get(userId);
    return (
      account !== undefined &&
      account.isDeleted &&
      account.eraseAfter !== null &&
      account.eraseAfter <= now &&
      (!job || !this.isTaken(job, now, undefined))
    );
  }

  isTaken(job: MemoryJob, now: Date, owner: string | undefined): boolean {
    const leased =
      job.leaseOwner !== owner &&
      job.leaseUntil !== null &&
      job.leaseUntil > now;
    const waiting = job.nextAttemptAt !== null && job.nextAttemptAt > now;
    return job.step === ERASURE_STEP.ERASED || leased || waiting;
  }

  newJob(userId: string, lease: ErasureLease): MemoryJob {
    const job: MemoryJob = {
      id: `job-${this.nextJob++}`,
      userId,
      step: ERASURE_STEP.ERASING,
      attempts: 0,
      failureCode: null,
      failedAt: null,
      nextAttemptAt: null,
      startedAt: lease.now,
      erasedAt: null,
      leaseOwner: lease.owner,
      leaseUntil: lease.until,
    };
    this.jobs.set(userId, job);
    return job;
  }

  jobById(jobId: string): MemoryJob | undefined {
    return [...this.jobs.values()].find((job) => job.id === jobId);
  }
}

function view(job: MemoryJob): ErasureJob {
  const { leaseOwner: _owner, leaseUntil: _until, ...rest } = job;
  return { ...rest };
}

export class MemoryErasureJobStore extends ErasureJobStore {
  constructor(private readonly world: MemoryErasureWorld) {
    super();
  }

  findDue(now: Date, limit: number): Promise<string[]> {
    const due = [...this.world.accounts.keys()].filter((id) =>
      this.world.isDue(id, now),
    );
    return Promise.resolve(due.slice(0, limit));
  }

  beginIn(
    _unitOfWork: UnitOfWork,
    userId: string,
    lease: ErasureLease,
  ): Promise<BegunErasure | null> {
    const account = this.world.accounts.get(userId);
    if (
      !account?.isDeleted ||
      !account.eraseAfter ||
      account.eraseAfter > lease.now
    ) {
      return Promise.resolve(null);
    }
    const existing = this.world.jobOf(userId);
    if (existing && this.world.isTaken(existing, lease.now, lease.owner)) {
      return Promise.resolve(null);
    }
    const job = existing ?? this.world.newJob(userId, lease);
    job.leaseOwner = lease.owner;
    job.leaseUntil = lease.until;
    const begun: BegunErasure = {
      job: view(job),
      accountId: userId,
      onAccount: {
        address: account.address,
        pendingAddress: account.pendingAddress,
      },
    };
    return Promise.resolve(begun);
  }

  markHookDone(jobId: string, lease: ErasureLease): Promise<boolean> {
    const job = this.world.jobById(jobId);
    if (job?.leaseOwner !== lease.owner || job.step !== ERASURE_STEP.ERASING) {
      return Promise.resolve(false);
    }
    job.step = ERASURE_STEP.HOOK_DONE;
    return Promise.resolve(true);
  }

  markFailed(jobId: string, owner: string, failure: ErasureFailure) {
    const job = this.world.jobById(jobId);
    if (job?.leaseOwner === owner && job.step !== ERASURE_STEP.ERASED) {
      job.attempts += 1;
      job.failureCode = failure.code;
      job.failedAt = failure.at;
      job.nextAttemptAt = failure.nextAttemptAt;
      job.leaseOwner = null;
      job.leaseUntil = null;
    }
    return Promise.resolve();
  }

  finishIn(
    _unitOfWork: UnitOfWork,
    jobId: string,
    erasedAt: Date,
  ): Promise<boolean> {
    const job = this.world.jobById(jobId);
    if (!job || job.step === ERASURE_STEP.ERASED) return Promise.resolve(false);
    job.step = ERASURE_STEP.ERASED;
    job.erasedAt = erasedAt;
    job.leaseOwner = null;
    job.leaseUntil = null;
    return Promise.resolve(true);
  }

  withdrawIn(_unitOfWork: UnitOfWork, jobId: string): Promise<void> {
    const job = this.world.jobById(jobId);
    if (job && job.step !== ERASURE_STEP.ERASED)
      this.world.jobs.delete(job.userId);
    return Promise.resolve();
  }

  holdForRestoreIn(
    _unitOfWork: UnitOfWork,
    userId: string,
  ): Promise<ErasureStanding> {
    if (this.world.jobOf(userId))
      return Promise.resolve(ERASURE_STANDING.ERASING);
    const account = this.world.accounts.get(userId);
    if (account) account.eraseAfter = null;
    return Promise.resolve(ERASURE_STANDING.RESTORABLE);
  }

  listOpen(limit: number): Promise<ErasureJob[]> {
    const open = [...this.world.jobs.values()].filter(
      (job) => job.step !== ERASURE_STEP.ERASED,
    );
    return Promise.resolve(open.slice(0, limit).map(view));
  }

  scheduleUnscheduled(
    selection: UnscheduledSelection,
    limit: number,
  ): Promise<number> {
    const { eraseAfter, deletedBefore } = selection;
    const waiting = [...this.world.accounts.values()].filter((account) => {
      const deletedAt = account.deletedAt?.getTime();
      const own =
        account.selfDeletedAt !== undefined &&
        account.selfDeletedAt.getTime() === deletedAt;
      const unmarkedBefore =
        account.selfDeletedAt === undefined &&
        deletedAt !== undefined &&
        deletedBefore !== undefined &&
        deletedAt < deletedBefore.getTime();
      return (
        account.isDeleted &&
        account.eraseAfter === null &&
        (own || unmarkedBefore)
      );
    });
    for (const account of waiting.slice(0, limit))
      account.eraseAfter = eraseAfter;
    return Promise.resolve(Math.min(waiting.length, limit));
  }
}

/** Removes the account from the world; `removals` says what went by what. */
export class MemoryAccountEraser extends AccountEraser {
  readonly removals: ErasureFacts[] = [];

  constructor(private readonly world: MemoryErasureWorld) {
    super();
  }

  get erased(): string[] {
    return this.removals.map((facts) => facts.accountId);
  }

  readFactsIn(_unitOfWork: UnitOfWork, userId: string, now: Date) {
    const account = this.world.accounts.get(userId);
    const due =
      account?.isDeleted === true &&
      account.eraseAfter !== null &&
      account.eraseAfter <= now;
    const read: AccountErasureRead | null =
      account && due
        ? {
            accountId: userId,
            onAccount: {
              address: account.address,
              pendingAddress: account.pendingAddress,
            },
            sessionIds: [],
            identities: [...account.identities],
          }
        : null;
    return Promise.resolve(read);
  }

  eraseIn(_unitOfWork: UnitOfWork, facts: ErasureFacts): Promise<void> {
    this.world.accounts.delete(facts.accountId);
    this.removals.push(facts);
    return Promise.resolve();
  }
}

/** Address claims by address, with the ledger's rule for a live one. */
export class MemoryAddressLedger extends AddressLedger {
  readonly claims = new Map<string, { owner: string; lapsesAt: Date }>();

  holdsLiveClaim(_unitOfWork: UnitOfWork, input: OwnedAddressLookup) {
    const claim = this.claims.get(input.address);
    return Promise.resolve(
      claim?.owner === input.owner && claim.lapsesAt > input.now,
    );
  }

  claim(): never {
    throw new Error('The erasure worker never claims an address');
  }

  release(): never {
    throw new Error('The erasure worker never releases an address');
  }

  isFree(): never {
    throw new Error('The erasure worker never asks whether an address is free');
  }
}

/** A host hook that records its calls and fails while `failure` is set. */
export class RecordingHook extends AccountErasureHook {
  readonly calls: { subject: ErasureSubject; inTransaction: boolean }[] = [];
  failure: Error | undefined;

  constructor(readonly runsInEraseTransaction = false) {
    super();
  }

  erase(subject: ErasureSubject, unitOfWork?: UnitOfWork): Promise<void> {
    this.calls.push({ subject, inTransaction: unitOfWork !== undefined });
    return this.failure ? Promise.reject(this.failure) : Promise.resolve();
  }
}
