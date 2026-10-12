import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, Model } from 'mongoose';
import { singleStatement } from '../../../../common/persistence/mongo/mongo-unique-conflict';
import { UnitOfWork } from '../../../../common/persistence/unit-of-work';
import { toObjectId } from '../../../persistence/mongo/mongo-issuance-mappers';
import { mongoSessionOf } from '../../../persistence/mongo/mongo-unit-of-work';
import {
  AuthorizationTransaction,
  AuthorizationTransactionDocument,
} from '../../../persistence/mongo/schemas/authorization-transaction.schema';
import {
  AUTHORIZATION_APPROVAL,
  AUTHORIZATION_DENIAL,
  AuthorizationApproval,
  AuthorizationApprovalOutcome,
  AuthorizationCode,
  CODE_SPEND,
  CodeHolder,
  CodeSpend,
  AuthorizationDenial,
  AuthorizationDenialGuard,
  GRANT_VERSION_CAPTURE,
  GrantVersionCapture,
  NativeAuthorizationStore,
  NewPendingAuthorization,
  PendingAuthorization,
} from '../../authorize/native-authorization.store';
import { NATIVE_AUTH_INTENT } from '../../oauth/native-oauth.types';

function pendingAt(now: Date): FilterQuery<AuthorizationTransaction> {
  return {
    consumed: false,
    codeHash: { $exists: false },
    expiresAt: { $gt: now },
  };
}

function toPending(
  stored: AuthorizationTransactionDocument,
): PendingAuthorization {
  return {
    id: stored._id.toString(),
    transactionId: stored.transactionId,
    clientId: stored.clientId,
    redirectUri: stored.redirectUri,
    state: stored.state,
    expiresAt: stored.expiresAt,
  };
}

function toCode(stored: AuthorizationTransactionDocument): AuthorizationCode {
  return {
    id: stored._id.toString(),
    clientId: stored.clientId,
    redirectUri: stored.redirectUri,
    codeChallenge: stored.codeChallenge,
    userId: stored.userId ? stored.userId.toString() : null,
    codeExpiresAt: stored.codeExpiresAt ?? null,
    requestedScopes: [...stored.requestedScopes],
    audience: stored.audience ?? null,
    authenticationMethods: [...stored.authenticationMethods],
    capturedUserVersion: stored.capturedUserVersion ?? null,
    capturedClientVersion: stored.capturedClientVersion ?? null,
    capturedGrantVersion: stored.capturedGrantVersion ?? null,
    authEpoch: stored.authEpoch,
  };
}

function spendOutcome(result: { matchedCount: number }): CodeSpend {
  return result.matchedCount === 1
    ? CODE_SPEND.SPENT
    : CODE_SPEND.ALREADY_SPENT;
}

/**
 * Inside a unit of work the driver's own error leaves as raised: the runner
 * that owns the transaction maps it, and reads its labels to decide a rerun.
 */
@Injectable()
export class MongoNativeAuthorizationStore extends NativeAuthorizationStore {
  constructor(
    @InjectModel(AuthorizationTransaction.name)
    private readonly transactions: Model<AuthorizationTransactionDocument>,
  ) {
    super();
  }

  async createPending(pending: NewPendingAuthorization): Promise<void> {
    await singleStatement(() =>
      this.transactions.create({
        ...pending,
        intent: NATIVE_AUTH_INTENT,
        consumed: false,
      }),
    );
  }

  async findPending(
    transactionId: string,
    now: Date,
  ): Promise<PendingAuthorization | null> {
    const stored = await singleStatement(() =>
      this.transactions
        .findOne({
          transactionId,
          intent: NATIVE_AUTH_INTENT,
          ...pendingAt(now),
        })
        .exec(),
    );
    return stored ? toPending(stored) : null;
  }

  async findPendingIn(
    unitOfWork: UnitOfWork,
    transactionId: string,
    now: Date,
  ): Promise<PendingAuthorization | null> {
    const stored = await this.transactions
      .findOne({ transactionId, intent: NATIVE_AUTH_INTENT, ...pendingAt(now) })
      .session(mongoSessionOf(unitOfWork))
      .exec();
    return stored ? toPending(stored) : null;
  }

  async approve(
    unitOfWork: UnitOfWork,
    id: string,
    approval: AuthorizationApproval,
  ): Promise<AuthorizationApprovalOutcome> {
    const claimed = await this.transactions
      .updateOne(
        { _id: toObjectId(id), ...pendingAt(approval.now) },
        {
          $set: {
            codeHash: approval.codeHash,
            codeExpiresAt: approval.codeExpiresAt,
            expiresAt: approval.codeExpiresAt,
            userId: toObjectId(approval.userId),
            capturedUserVersion: approval.capturedUserVersion,
            capturedClientVersion: approval.capturedClientVersion,
            authenticationMethods: approval.authenticationMethods,
          },
        },
      )
      .session(mongoSessionOf(unitOfWork))
      .exec();
    return claimed.matchedCount === 1
      ? AUTHORIZATION_APPROVAL.APPROVED
      : AUTHORIZATION_APPROVAL.NOT_PENDING;
  }

  async captureGrantVersion(
    unitOfWork: UnitOfWork,
    id: string,
    codeHash: string,
    grantVersion: number,
  ): Promise<GrantVersionCapture> {
    const captured = await this.transactions
      .updateOne(
        { _id: toObjectId(id), consumed: false, codeHash },
        { $set: { capturedGrantVersion: grantVersion } },
      )
      .session(mongoSessionOf(unitOfWork))
      .exec();
    return captured.matchedCount === 1
      ? GRANT_VERSION_CAPTURE.CAPTURED
      : GRANT_VERSION_CAPTURE.NOT_APPROVED;
  }

  async deny(
    id: string,
    guard: AuthorizationDenialGuard,
  ): Promise<AuthorizationDenial> {
    const denied = await singleStatement(() =>
      this.transactions
        .findOneAndUpdate(
          {
            _id: toObjectId(id),
            transactionId: guard.transactionId,
            intent: NATIVE_AUTH_INTENT,
            ...pendingAt(guard.now),
            redirectUri: guard.redirectUri,
          },
          { $set: { consumed: true } },
          { new: true },
        )
        .exec(),
    );
    return denied
      ? {
          outcome: AUTHORIZATION_DENIAL.DENIED,
          redirectUri: denied.redirectUri,
          state: denied.state,
        }
      : { outcome: AUTHORIZATION_DENIAL.NOT_PENDING };
  }

  async findUnspentCode(codeHash: string): Promise<AuthorizationCode | null> {
    const stored = await singleStatement(() =>
      this.transactions.findOne({ codeHash, consumed: false }).exec(),
    );
    return stored ? toCode(stored) : null;
  }

  async findCodeHolder(
    codeHash: string,
    now: Date,
  ): Promise<CodeHolder | null> {
    const stored = await singleStatement(() =>
      this.transactions
        .findOne({ codeHash, consumed: false, codeExpiresAt: { $gt: now } })
        .select({ clientId: 1, userId: 1 })
        .exec(),
    );
    return stored
      ? {
          clientId: stored.clientId,
          userId: stored.userId ? stored.userId.toString() : null,
        }
      : null;
  }

  async spendCode(id: string): Promise<CodeSpend> {
    return spendOutcome(
      await singleStatement(() =>
        this.transactions.updateOne(
          { _id: toObjectId(id), consumed: false },
          { $set: { consumed: true } },
        ),
      ),
    );
  }

  async findUnspentCodeIn(
    unitOfWork: UnitOfWork,
    id: string,
  ): Promise<AuthorizationCode | null> {
    const stored = await this.transactions
      .findOne({ _id: toObjectId(id), consumed: false })
      .session(mongoSessionOf(unitOfWork))
      .exec();
    return stored ? toCode(stored) : null;
  }

  async spendCodeIn(unitOfWork: UnitOfWork, id: string): Promise<CodeSpend> {
    return spendOutcome(
      await this.transactions
        .updateOne(
          { _id: toObjectId(id), consumed: false },
          { $set: { consumed: true } },
        )
        .session(mongoSessionOf(unitOfWork))
        .exec(),
    );
  }
}
