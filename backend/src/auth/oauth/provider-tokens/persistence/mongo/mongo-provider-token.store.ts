import { Collection, Db, ObjectId } from 'mongodb';
import { MalformedIdError } from '../../../../../common/persistence/persistence-errors';
import type { UnitOfWork } from '../../../../../common/persistence/unit-of-work';
import { mongoSessionOf } from '../../../../../session/persistence/mongo/mongo-unit-of-work';
import {
  REVOCATION_OUTCOME,
  REVOCATION_STATE,
  type RevocationOutcome,
} from '../../constants/provider-tokens.constants';
import { ProviderTokenStore } from '../../stores/provider-token.store';
import type {
  DueRevocation,
  KeptProviderToken,
  NewRevocationJob,
  ProviderRevocationJob,
  RevocationFailure,
  SealedToken,
  TokenToKeep,
} from '../../types/provider-tokens';
import { revocationJobOf } from '../revocation-job-fields';

interface TokenDocument extends SealedToken {
  _id: ObjectId;
  provider: string;
  subject: string;
  clientId: string;
  storedAt: Date;
  checkAfter?: Date;
}

interface LinkedAccountDocument {
  linkedAccounts?: { provider: string; providerId: string }[];
}

interface RevocationDocument {
  _id: ObjectId;
  provider: string;
  subject: string;
  clientId: string | null;
  userId: string | null;
  reason: string;
  state: string;
  outcome: string | null;
  ciphertext: string | null;
  iv: string | null;
  tag: string | null;
  keyId: string | null;
  attempts: number;
  failureCode: string | null;
  flaggedAt: Date | null;
  nextAttemptAt: Date | null;
  leaseUntil: Date | null;
  createdAt: Date;
  settledAt: Date | null;
  purgeAfter: Date;
}

export const PROVIDER_TOKEN_COLLECTION = 'provider_tokens';
export const PROVIDER_REVOCATION_COLLECTION = 'provider_revocations';

function objectIdOf(id: string): ObjectId {
  if (!ObjectId.isValid(id)) throw new MalformedIdError();
  return new ObjectId(id);
}

function tokenOf(row: TokenDocument): KeptProviderToken {
  return {
    provider: row.provider,
    subject: row.subject,
    clientId: row.clientId,
    sealed: {
      ciphertext: row.ciphertext,
      iv: row.iv,
      tag: row.tag,
      keyId: row.keyId,
    },
    storedAt: row.storedAt,
  };
}

function jobDocument(job: NewRevocationJob): RevocationDocument {
  const pending = job.sealed !== undefined;
  return {
    _id: new ObjectId(),
    provider: job.provider,
    subject: job.subject,
    clientId: job.clientId,
    userId: job.userId === null ? null : objectIdOf(job.userId).toHexString(),
    reason: job.reason,
    state: pending ? REVOCATION_STATE.PENDING : REVOCATION_STATE.CLOSED,
    outcome: pending ? null : REVOCATION_OUTCOME.NO_TOKEN,
    ciphertext: job.sealed?.ciphertext ?? null,
    iv: job.sealed?.iv ?? null,
    tag: job.sealed?.tag ?? null,
    keyId: job.sealed?.keyId ?? null,
    attempts: 0,
    failureCode: null,
    flaggedAt: null,
    nextAttemptAt: pending ? job.createdAt : null,
    leaseUntil: null,
    createdAt: job.createdAt,
    settledAt: pending ? null : job.createdAt,
    purgeAfter: job.purgeAfter,
  };
}

export class MongoProviderTokenStore extends ProviderTokenStore {
  private readonly tokens: Collection<TokenDocument>;
  private readonly jobs: Collection<RevocationDocument>;
  private readonly users: Collection<LinkedAccountDocument>;

  constructor(db: Db) {
    super();
    this.tokens = db.collection<TokenDocument>(PROVIDER_TOKEN_COLLECTION);
    this.jobs = db.collection<RevocationDocument>(
      PROVIDER_REVOCATION_COLLECTION,
    );
    this.users = db.collection<LinkedAccountDocument>('users');
  }

  async ensureIndexes(): Promise<void> {
    await this.tokens.createIndex(
      { provider: 1, subject: 1, clientId: 1 },
      { unique: true, name: 'provider_token_identity_client_unique' },
    );
    await this.tokens.createIndex(
      { checkAfter: 1 },
      {
        partialFilterExpression: { checkAfter: { $exists: true } },
        name: 'provider_token_check_after',
      },
    );
    await this.jobs.createIndex(
      { purgeAfter: 1 },
      { expireAfterSeconds: 0, name: 'provider_revocation_purge_after' },
    );
    await this.jobs.createIndex(
      { state: 1, nextAttemptAt: 1 },
      { name: 'provider_revocation_due' },
    );
    await this.jobs.createIndex(
      { flaggedAt: -1 },
      {
        partialFilterExpression: { flaggedAt: { $exists: true } },
        name: 'provider_revocation_flagged',
      },
    );
  }

  async keep(token: TokenToKeep): Promise<void> {
    await this.tokens.updateOne(
      {
        provider: token.provider,
        subject: token.subject,
        clientId: token.clientId,
      },
      {
        $set: {
          ...token.sealed,
          storedAt: token.storedAt,
          checkAfter: token.checkAfter,
        },
      },
      { upsert: true },
    );
  }

  async takeTokensIn(
    unitOfWork: UnitOfWork,
    identity: { provider: string; subject: string },
  ): Promise<KeptProviderToken[]> {
    const session = mongoSessionOf(unitOfWork);
    const rows = await this.tokens.find(identity, { session }).toArray();
    await this.tokens.deleteMany(identity, { session });
    return rows.map(tokenOf);
  }

  async takeUnclaimedIn(
    unitOfWork: UnitOfWork,
    now: Date,
    limit: number,
  ): Promise<{ checked: number; unclaimed: KeptProviderToken[] }> {
    const session = mongoSessionOf(unitOfWork);
    const due = await this.tokens
      .find({ checkAfter: { $lte: now } }, { session })
      .sort({ checkAfter: 1 })
      .limit(limit)
      .toArray();
    const unclaimed: KeptProviderToken[] = [];
    for (const row of due) {
      // The same filter on the row: a newer keep moved the check, so leave it.
      const unchanged = { _id: row._id, checkAfter: row.checkAfter };
      const linked = await this.users.findOne(
        {
          linkedAccounts: {
            $elemMatch: { provider: row.provider, providerId: row.subject },
          },
        },
        { session, projection: { _id: 1 } },
      );
      if (linked) {
        await this.tokens.updateOne(
          unchanged,
          { $unset: { checkAfter: '' } },
          { session },
        );
        continue;
      }
      const removed = await this.tokens.findOneAndDelete(unchanged, {
        session,
      });
      if (removed) unclaimed.push(tokenOf(removed));
    }
    return { checked: due.length, unclaimed };
  }

  async addJobsIn(
    unitOfWork: UnitOfWork,
    jobs: NewRevocationJob[],
  ): Promise<void> {
    if (jobs.length === 0) return;
    await this.jobs.insertMany(jobs.map(jobDocument), {
      session: mongoSessionOf(unitOfWork),
    });
  }

  async claimDue(
    now: Date,
    limit: number,
    leaseUntil: Date,
  ): Promise<DueRevocation[]> {
    const claimed: DueRevocation[] = [];
    for (let index = 0; index < limit; index += 1) {
      const row = await this.jobs.findOneAndUpdate(
        {
          state: REVOCATION_STATE.PENDING,
          $and: [
            {
              $or: [{ nextAttemptAt: null }, { nextAttemptAt: { $lte: now } }],
            },
            { $or: [{ leaseUntil: null }, { leaseUntil: { $lte: now } }] },
          ],
        },
        { $set: { leaseUntil } },
        { sort: { createdAt: 1 }, returnDocument: 'after' },
      );
      if (row === null) break;
      if (row.clientId && row.ciphertext && row.iv && row.tag && row.keyId) {
        claimed.push({
          id: row._id.toHexString(),
          provider: row.provider,
          subject: row.subject,
          clientId: row.clientId,
          sealed: {
            ciphertext: row.ciphertext,
            iv: row.iv,
            tag: row.tag,
            keyId: row.keyId,
          },
          attempts: row.attempts,
        });
      }
    }
    return claimed;
  }

  async settle(
    jobId: string,
    outcome: RevocationOutcome,
    at: Date,
  ): Promise<boolean> {
    if (!ObjectId.isValid(jobId)) return false;
    const result = await this.jobs.updateOne(
      { _id: new ObjectId(jobId), state: REVOCATION_STATE.PENDING },
      {
        $set: {
          state:
            outcome === REVOCATION_OUTCOME.REVOKED
              ? REVOCATION_STATE.REVOKED
              : REVOCATION_STATE.CLOSED,
          outcome,
          settledAt: at,
          ciphertext: null,
          iv: null,
          tag: null,
          keyId: null,
          nextAttemptAt: null,
          leaseUntil: null,
        },
      },
    );
    return result.modifiedCount === 1;
  }

  async markFailed(jobId: string, failure: RevocationFailure): Promise<void> {
    await this.jobs.updateOne(
      { _id: objectIdOf(jobId), state: REVOCATION_STATE.PENDING },
      [
        {
          $set: {
            attempts: { $add: ['$attempts', 1] },
            failureCode: { $literal: failure.code },
            nextAttemptAt: failure.nextAttemptAt,
            leaseUntil: null,
            flaggedAt: failure.flag
              ? { $ifNull: ['$flaggedAt', failure.at] }
              : '$flaggedAt',
          },
        },
      ],
    );
  }

  async listFlagged(limit: number): Promise<ProviderRevocationJob[]> {
    if (limit === 0) return [];
    const rows = await this.jobs
      .find({ state: REVOCATION_STATE.PENDING, flaggedAt: { $ne: null } })
      .sort({ flaggedAt: -1, _id: -1 })
      .limit(limit)
      .toArray();
    return rows.map((row) =>
      revocationJobOf({
        id: row._id.toHexString(),
        provider: row.provider,
        userId: row.userId,
        reason: row.reason,
        state: row.state,
        outcome: row.outcome,
        attempts: row.attempts,
        failureCode: row.failureCode,
        flaggedAt: row.flaggedAt,
        nextAttemptAt: row.nextAttemptAt,
        createdAt: row.createdAt,
        settledAt: row.settledAt,
      }),
    );
  }
}
