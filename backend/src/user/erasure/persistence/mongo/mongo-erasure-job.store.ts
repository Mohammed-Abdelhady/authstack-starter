import { Collection, Db, Filter, ObjectId } from 'mongodb';
import { MalformedIdError } from '../../../../common/persistence/persistence-errors';
import type { UnitOfWork } from '../../../../common/persistence/unit-of-work';
import { mongoSessionOf } from '../../../../session/persistence/mongo/mongo-unit-of-work';
import {
  ERASURE_STANDING,
  ERASURE_STEP,
  type ErasureStanding,
} from '../../constants/erasure.constants';
import { ErasureJobStore } from '../../stores/erasure-job.store';
import type {
  BegunErasure,
  ErasureFailure,
  ErasureJob,
  ErasureLease,
  UnscheduledSelection,
} from '../../types/erasure';

export const ERASURE_JOB_COLLECTION = 'erasure_jobs';

type JobDocument = Omit<ErasureJob, 'id'> & {
  _id: ObjectId;
  leaseOwner: string | null;
  leaseUntil: Date | null;
  purgeAfter: Date | null;
};
type AccountDocument = {
  _id: ObjectId;
  email: string;
  pendingEmail?: string;
  isDeleted: boolean;
  deletedAt?: Date;
  selfDeletedAt?: Date;
  eraseAfter?: Date;
  erasureFence?: number;
};

function objectId(value: string): ObjectId {
  if (!ObjectId.isValid(value)) throw new MalformedIdError();
  return new ObjectId(value);
}

/**
 * Deactivated with no schedule, by the person's own deletion: its mark still
 * equals `deletedAt`, which a later staff deactivation or restore moves.
 */
function unscheduled({
  deletedBefore,
}: UnscheduledSelection): Filter<AccountDocument> {
  const own = {
    selfDeletedAt: { $type: 'date' as const },
    $expr: { $eq: ['$selfDeletedAt', '$deletedAt'] },
  };
  const waiting = { isDeleted: true, eraseAfter: { $exists: false } };
  if (!deletedBefore) return { ...waiting, ...own };
  const unmarked = {
    selfDeletedAt: { $exists: false },
    deletedAt: { $lt: deletedBefore },
  };
  return { ...waiting, $or: [own, unmarked] };
}

function toJob(document: JobDocument): ErasureJob {
  return {
    id: document._id.toHexString(),
    userId: document.userId,
    step: document.step,
    attempts: document.attempts,
    failureCode: document.failureCode,
    failedAt: document.failedAt,
    nextAttemptAt: document.nextAttemptAt,
    startedAt: document.startedAt,
    erasedAt: document.erasedAt,
  };
}

export class MongoErasureJobStore extends ErasureJobStore {
  private readonly jobs: Collection<JobDocument>;
  private readonly users: Collection<AccountDocument>;

  constructor(db: Db) {
    super();
    this.jobs = db.collection<JobDocument>(ERASURE_JOB_COLLECTION);
    this.users = db.collection<AccountDocument>('users');
  }

  async ensureIndexes(): Promise<void> {
    await this.jobs.createIndex(
      { userId: 1 },
      { unique: true, name: 'erasure_job_user_unique' },
    );
    await this.jobs.createIndex(
      { purgeAfter: 1 },
      { expireAfterSeconds: 0, name: 'erasure_job_purge_after' },
    );
    await this.jobs.createIndex(
      { step: 1, startedAt: -1 },
      { name: 'erasure_job_open' },
    );
    await this.users.createIndex(
      { eraseAfter: 1 },
      {
        name: 'user_erase_due',
        partialFilterExpression: {
          isDeleted: true,
          eraseAfter: { $exists: true },
        },
      },
    );
  }

  async findDue(now: Date, limit: number): Promise<string[]> {
    if (limit <= 0) return [];
    const rows = await this.users
      .aggregate<{ _id: ObjectId }>([
        { $match: { isDeleted: true, eraseAfter: { $lte: now } } },
        {
          $lookup: {
            from: ERASURE_JOB_COLLECTION,
            let: { userId: { $toString: '$_id' } },
            pipeline: [{ $match: { $expr: { $eq: ['$userId', '$$userId'] } } }],
            as: 'jobs',
          },
        },
        {
          $match: {
            'jobs.step': { $ne: ERASURE_STEP.ERASED },
            'jobs.leaseUntil': { $not: { $gt: now } },
            'jobs.nextAttemptAt': { $not: { $gt: now } },
          },
        },
        { $sort: { eraseAfter: 1 } },
        { $limit: limit },
        { $project: { _id: 1 } },
      ])
      .toArray();
    return rows.map((row) => row._id.toHexString());
  }

  async beginIn(
    unitOfWork: UnitOfWork,
    userId: string,
    lease: ErasureLease,
  ): Promise<BegunErasure | null> {
    const session = mongoSessionOf(unitOfWork);
    const id = objectId(userId);
    const account = await this.users.findOneAndUpdate(
      { _id: id, isDeleted: true, eraseAfter: { $lte: lease.now } },
      { $inc: { erasureFence: 1 } },
      { session, returnDocument: 'after' },
    );
    if (!account) return null;
    const canonicalId = id.toHexString();
    const existing = await this.jobs.findOne(
      { userId: canonicalId },
      { session },
    );
    if (
      existing &&
      (existing.step === ERASURE_STEP.ERASED ||
        (existing.leaseOwner !== lease.owner &&
          existing.leaseUntil !== null &&
          existing.leaseUntil > lease.now) ||
        (existing.nextAttemptAt !== null && existing.nextAttemptAt > lease.now))
    ) {
      return null;
    }
    const document = await this.jobs.findOneAndUpdate(
      { userId: canonicalId },
      {
        $set: { leaseOwner: lease.owner, leaseUntil: lease.until },
        $setOnInsert: {
          step: ERASURE_STEP.ERASING,
          attempts: 0,
          failureCode: null,
          failedAt: null,
          nextAttemptAt: null,
          startedAt: lease.now,
          erasedAt: null,
          purgeAfter: null,
        },
      },
      { upsert: true, session, returnDocument: 'after' },
    );
    if (!document) throw new Error('MongoDB returned no erasure job');
    return {
      job: toJob(document),
      accountId: canonicalId,
      onAccount: {
        address: account.email || null,
        pendingAddress: account.pendingEmail || null,
      },
    };
  }

  async markHookDone(jobId: string, lease: ErasureLease): Promise<boolean> {
    const result = await this.jobs.updateOne(
      {
        _id: objectId(jobId),
        leaseOwner: lease.owner,
        step: ERASURE_STEP.ERASING,
      },
      { $set: { step: ERASURE_STEP.HOOK_DONE } },
    );
    return result.modifiedCount === 1;
  }

  async markFailed(
    jobId: string,
    owner: string,
    failure: ErasureFailure,
  ): Promise<void> {
    await this.jobs.updateOne(
      {
        _id: objectId(jobId),
        leaseOwner: owner,
        step: { $ne: ERASURE_STEP.ERASED },
      },
      {
        $inc: { attempts: 1 },
        $set: {
          failureCode: failure.code,
          failedAt: failure.at,
          nextAttemptAt: failure.nextAttemptAt,
          leaseOwner: null,
          leaseUntil: null,
        },
      },
    );
  }

  async finishIn(
    unitOfWork: UnitOfWork,
    jobId: string,
    erasedAt: Date,
    purgeAfter: Date,
  ): Promise<boolean> {
    const result = await this.jobs.updateOne(
      { _id: objectId(jobId), step: { $ne: ERASURE_STEP.ERASED } },
      {
        $set: {
          step: ERASURE_STEP.ERASED,
          erasedAt,
          purgeAfter,
          nextAttemptAt: null,
          leaseOwner: null,
          leaseUntil: null,
        },
      },
      { session: mongoSessionOf(unitOfWork) },
    );
    return result.modifiedCount === 1;
  }

  async withdrawIn(unitOfWork: UnitOfWork, jobId: string): Promise<void> {
    await this.jobs.deleteOne(
      { _id: objectId(jobId), step: { $ne: ERASURE_STEP.ERASED } },
      { session: mongoSessionOf(unitOfWork) },
    );
  }

  async holdForRestoreIn(
    unitOfWork: UnitOfWork,
    userId: string,
  ): Promise<ErasureStanding> {
    const session = mongoSessionOf(unitOfWork);
    const id = objectId(userId);
    await this.users.updateOne(
      { _id: id },
      { $inc: { erasureFence: 1 } },
      { session },
    );
    const job = await this.jobs.findOne(
      { userId: id.toHexString() },
      { session },
    );
    if (job) return ERASURE_STANDING.ERASING;
    await this.users.updateOne(
      { _id: id },
      { $unset: { eraseAfter: '' } },
      { session },
    );
    return ERASURE_STANDING.RESTORABLE;
  }

  async listOpen(limit: number): Promise<ErasureJob[]> {
    if (limit <= 0) return [];
    const rows = await this.jobs
      .find({ step: { $ne: ERASURE_STEP.ERASED } })
      .sort({ startedAt: -1, _id: -1 })
      .limit(limit)
      .toArray();
    return rows.map(toJob);
  }

  async scheduleUnscheduled(
    selection: UnscheduledSelection,
    limit: number,
  ): Promise<number> {
    if (limit <= 0) return 0;
    const matches = unscheduled(selection);
    const rows = await this.users.find(matches).limit(limit).toArray();
    if (rows.length === 0) return 0;
    const result = await this.users.updateMany(
      { ...matches, _id: { $in: rows.map((row) => row._id) } },
      { $set: { eraseAfter: selection.eraseAfter } },
    );
    return result.modifiedCount;
  }
}
