import { Collection, Db, ObjectId } from 'mongodb';
import { Clock } from '../../../../common/services/clock';
import { UnitOfWork } from '../../../../common/persistence/unit-of-work';
import { mongoSessionOf } from '../../../../session/persistence/mongo/mongo-unit-of-work';
import { NATIVE_ATTEMPT_PHASE } from '../../constants/native-attempt';
import { NativeAttemptStore } from '../../stores/native-attempt.store';
import {
  assertNativeAttemptSecretHash,
  nativeAttemptDetails,
} from '../native-attempt-fields';
import {
  NativeAttempt,
  NativeAttemptCredentials,
  NativeAttemptGuard,
  NativeAttemptOperationGuard,
  NativeAttemptTransition,
  NewNativeAttempt,
} from '../../types/native-attempt';

type NativeAttemptDocument = Omit<NativeAttempt, 'id'> & { _id: ObjectId };

function toAttempt(document: NativeAttemptDocument): NativeAttempt {
  const { _id, ...fields } = document;
  return { id: _id.toHexString(), ...fields };
}

export class MongoNativeAttemptStore extends NativeAttemptStore {
  private readonly collection: Collection<NativeAttemptDocument>;

  constructor(
    db: Db,
    private readonly clock: Clock,
  ) {
    super();
    this.collection = db.collection<NativeAttemptDocument>('native_attempts');
  }

  async ensureIndexes(): Promise<void> {
    await this.collection.createIndex(
      { attemptId: 1 },
      { unique: true, name: 'native_attempt_id_unique' },
    );
    await this.collection.createIndex(
      { expiresAt: 1 },
      { expireAfterSeconds: 0, name: 'native_attempt_expiry' },
    );
  }

  async create(input: NewNativeAttempt): Promise<NativeAttempt> {
    assertNativeAttemptSecretHash(input.secretHash);
    const document: NativeAttemptDocument = {
      _id: new ObjectId(),
      attemptId: input.attemptId,
      secretHash: input.secretHash,
      clientId: input.clientId,
      redirectUri: input.redirectUri,
      codeChallenge: input.codeChallenge,
      state: input.state,
      requestedScopes: [...input.requestedScopes],
      flow: input.flow,
      phase: input.phase,
      authEpoch: input.authEpoch,
      createdAt: input.createdAt,
      expiresAt: input.expiresAt,
      details: nativeAttemptDetails(input.details),
      revision: 0,
      activeOperationId: null,
      cancelledAt: null,
    };
    await this.collection.insertOne(document);
    return toAttempt(document);
  }

  async findByCredentials(
    credentials: NativeAttemptCredentials,
  ): Promise<NativeAttempt | null> {
    const found = await this.collection.findOne(this.live(credentials));
    return found ? toAttempt(found) : null;
  }

  async findAuthenticated(
    attemptId: string,
    secretHash: string,
  ): Promise<NativeAttempt | null> {
    assertNativeAttemptSecretHash(secretHash);
    const found = await this.collection.findOne({ attemptId, secretHash });
    return found ? toAttempt(found) : null;
  }

  claim(
    guard: NativeAttemptGuard,
    operationId: string,
  ): Promise<NativeAttempt | null> {
    return this.claimWith(guard, operationId);
  }

  claimIn(
    unitOfWork: UnitOfWork,
    guard: NativeAttemptGuard,
    operationId: string,
  ): Promise<NativeAttempt | null> {
    return this.claimWith(guard, operationId, unitOfWork);
  }

  release(guard: NativeAttemptOperationGuard): Promise<boolean> {
    return this.releaseWith(guard);
  }

  releaseIn(
    unitOfWork: UnitOfWork,
    guard: NativeAttemptOperationGuard,
  ): Promise<boolean> {
    return this.releaseWith(guard, unitOfWork);
  }

  transition(
    guard: NativeAttemptOperationGuard,
    next: NativeAttemptTransition,
  ): Promise<NativeAttempt | null> {
    return this.transitionWith(guard, next);
  }

  transitionIn(
    unitOfWork: UnitOfWork,
    guard: NativeAttemptOperationGuard,
    next: NativeAttemptTransition,
  ): Promise<NativeAttempt | null> {
    return this.transitionWith(guard, next, unitOfWork);
  }

  cancel(guard: NativeAttemptGuard): Promise<boolean> {
    return this.cancelWith(guard);
  }

  cancelIn(
    unitOfWork: UnitOfWork,
    guard: NativeAttemptGuard,
  ): Promise<boolean> {
    return this.cancelWith(guard, unitOfWork);
  }

  private live(credentials: NativeAttemptCredentials) {
    return {
      attemptId: credentials.attemptId,
      clientId: credentials.clientId,
      secretHash: credentials.secretHash,
      expiresAt: { $gt: this.clock.now() },
      cancelledAt: null,
      phase: { $ne: NATIVE_ATTEMPT_PHASE.DENIED },
    };
  }

  private mutable(credentials: NativeAttemptCredentials) {
    return {
      ...this.live(credentials),
      phase: {
        $nin: [
          NATIVE_ATTEMPT_PHASE.DENIED,
          NATIVE_ATTEMPT_PHASE.CODE_READY,
          NATIVE_ATTEMPT_PHASE.RECOVERY_COMPLETE,
        ],
      },
    };
  }

  private async claimWith(
    guard: NativeAttemptGuard,
    operationId: string,
    unitOfWork?: UnitOfWork,
  ): Promise<NativeAttempt | null> {
    const found = await this.collection.findOneAndUpdate(
      {
        ...this.mutable(guard),
        revision: guard.revision,
        activeOperationId: null,
      },
      { $set: { activeOperationId: operationId }, $inc: { revision: 1 } },
      {
        returnDocument: 'after',
        session: unitOfWork ? mongoSessionOf(unitOfWork) : undefined,
      },
    );
    return found ? toAttempt(found) : null;
  }

  private async releaseWith(
    guard: NativeAttemptOperationGuard,
    unitOfWork?: UnitOfWork,
  ): Promise<boolean> {
    const result = await this.collection.updateOne(
      {
        ...this.mutable(guard),
        revision: guard.revision,
        activeOperationId: guard.operationId,
      },
      { $set: { activeOperationId: null }, $inc: { revision: 1 } },
      { session: unitOfWork ? mongoSessionOf(unitOfWork) : undefined },
    );
    return result.modifiedCount === 1;
  }

  private async transitionWith(
    guard: NativeAttemptOperationGuard,
    next: NativeAttemptTransition,
    unitOfWork?: UnitOfWork,
  ): Promise<NativeAttempt | null> {
    const now = this.clock.now();
    if (next.expiresAt.getTime() <= now.getTime()) return null;
    const found = await this.collection.findOneAndUpdate(
      {
        ...this.mutable(guard),
        expiresAt: { $gt: now, $gte: next.expiresAt },
        revision: guard.revision,
        activeOperationId: guard.operationId,
      },
      {
        $set: {
          phase: next.phase,
          expiresAt: next.expiresAt,
          details: nativeAttemptDetails(next.details),
          activeOperationId: null,
        },
        $inc: { revision: 1 },
      },
      {
        returnDocument: 'after',
        session: unitOfWork ? mongoSessionOf(unitOfWork) : undefined,
      },
    );
    return found ? toAttempt(found) : null;
  }

  private async cancelWith(
    guard: NativeAttemptGuard,
    unitOfWork?: UnitOfWork,
  ): Promise<boolean> {
    const result = await this.collection.updateOne(
      { ...this.mutable(guard), revision: guard.revision },
      {
        $set: {
          phase: NATIVE_ATTEMPT_PHASE.DENIED,
          cancelledAt: this.clock.now(),
          activeOperationId: null,
        },
        $inc: { revision: 1 },
      },
      { session: unitOfWork ? mongoSessionOf(unitOfWork) : undefined },
    );
    return result.modifiedCount === 1;
  }
}
