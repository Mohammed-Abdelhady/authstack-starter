import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { MalformedIdError } from '../../../../common/persistence/persistence-errors';
import { UnitOfWork } from '../../../../common/persistence/unit-of-work';
import { deviceLabelOf } from '../../../issuance/browser-issuance.store';
import { CREDENTIAL_PURPOSE } from '../../../constants/credential-purpose';
import { toObjectId } from '../../../persistence/mongo/mongo-issuance-mappers';
import { isStorableId } from '../../../persistence/mongo/mongo-session-records';
import { mongoSessionOf } from '../../../persistence/mongo/mongo-unit-of-work';
import {
  NativeCredential,
  NativeCredentialDocument,
} from '../../../persistence/mongo/schemas/native-credential.schema';
import {
  NativeDpopProofId,
  NativeDpopProofIdDocument,
} from '../../../persistence/mongo/schemas/native-dpop-proof-id.schema';
import {
  Session,
  SessionDocument,
} from '../../../persistence/mongo/schemas/session.schema';
import {
  EndedFamilyOwner,
  FamilyRevocation,
  NativeCredentialStore,
  NativeFamilySession,
  NativeSessionOfAccount,
  NewCredentialPair,
  NewNativeSession,
  StoredNativeCredential,
} from '../../credentials/native-credential.store';

function toStoredCredential(
  stored: NativeCredentialDocument,
): StoredNativeCredential {
  return {
    id: stored._id.toString(),
    purpose: stored.purpose,
    sessionId: stored.sessionId.toString(),
    clientId: stored.clientId,
    generation: stored.generation,
    familyId: stored.familyId,
    expiresAt: stored.expiresAt,
    spent: stored.spent,
    consumedAt: stored.consumedAt ?? null,
    revokedAt: stored.revokedAt ?? null,
    proofKeyThumbprint: stored.proofKeyThumbprint ?? null,
    successorAccessHash: stored.successorAccessHash ?? null,
    successorRefreshHash: stored.successorRefreshHash ?? null,
  };
}

/** Stored values go across as they are: the service judges what is missing. */
function toFamilySession(stored: SessionDocument): NativeFamilySession {
  return {
    id: stored._id.toString(),
    userId: stored.user.toString(),
    scopes: [...stored.scopes],
    audience: stored.audience,
    authenticationMethods: [...stored.authenticationMethods],
    proofKeyThumbprint: stored.proofKeyThumbprint ?? null,
    isValid: stored.isValid,
    revokedAt: stored.revokedAt ?? null,
    credentialPurpose: stored.credentialPurpose,
    authEpoch: stored.authEpoch,
    schemaVersion: stored.schemaVersion,
    clientId: stored.clientId,
    userVersion: stored.userVersion,
    clientVersion: stored.clientVersion,
    grantVersion: stored.grantVersion,
    authenticatedAt: stored.authenticatedAt,
    expiresAt: stored.expiresAt,
    idleExpiresAt: stored.idleExpiresAt,
    lastActivityAt: stored.lastActivityAt,
  };
}

/**
 * Takes the family at its first write: that write conflicts with any other open
 * transaction that wrote the same session or token, and MongoDB refuses the
 * later writer at once. A unit of work whose reads went stale is refused the
 * same way at its first write and runs again.
 *
 * The driver's own error leaves as raised: the runner that owns the transaction
 * maps it, and reads its labels to decide a rerun.
 */
@Injectable()
export class MongoNativeCredentialStore extends NativeCredentialStore {
  constructor(
    @InjectModel(NativeCredential.name)
    private readonly credentials: Model<NativeCredentialDocument>,
    @InjectModel(Session.name)
    private readonly sessions: Model<SessionDocument>,
    @InjectModel(NativeDpopProofId.name)
    private readonly proofIds: Model<NativeDpopProofIdDocument>,
  ) {
    super();
  }

  async findPresentedCredential(
    unitOfWork: UnitOfWork,
    tokenHash: string,
  ): Promise<StoredNativeCredential | null> {
    const stored = await this.credentials
      .findOne({ tokenHash })
      .session(mongoSessionOf(unitOfWork))
      .exec();
    return stored ? toStoredCredential(stored) : null;
  }

  async findFamilySession(
    unitOfWork: UnitOfWork,
    sessionId: string,
  ): Promise<NativeFamilySession | null> {
    const stored = await this.sessions
      .findById(toObjectId(sessionId))
      .session(mongoSessionOf(unitOfWork))
      .exec();
    return stored ? toFamilySession(stored) : null;
  }

  async insertNativeSession(
    unitOfWork: UnitOfWork,
    session: NewNativeSession,
  ): Promise<string> {
    const { userId, proofKeyThumbprint, ...fields } = session;
    const [created] = await this.sessions.create(
      [
        {
          ...fields,
          device: deviceLabelOf(fields.device),
          user: toObjectId(userId),
          isValid: true,
          ...(proofKeyThumbprint ? { proofKeyThumbprint } : {}),
        },
      ],
      { session: mongoSessionOf(unitOfWork) },
    );
    return created._id.toString();
  }

  async insertCredentialPair(
    unitOfWork: UnitOfWork,
    pair: NewCredentialPair,
  ): Promise<void> {
    const shared = {
      sessionId: toObjectId(pair.sessionId),
      clientId: pair.clientId,
      generation: pair.generation,
      familyId: pair.familyId,
      issuedAt: pair.issuedAt,
      spent: false,
      ...(pair.proofKeyThumbprint
        ? { proofKeyThumbprint: pair.proofKeyThumbprint }
        : {}),
    };
    await this.credentials.create(
      [
        {
          ...shared,
          tokenHash: pair.access.tokenHash,
          purpose: CREDENTIAL_PURPOSE.NATIVE_ACCESS,
          expiresAt: pair.access.expiresAt,
        },
        {
          ...shared,
          tokenHash: pair.refresh.tokenHash,
          purpose: CREDENTIAL_PURPOSE.NATIVE_REFRESH,
          expiresAt: pair.refresh.expiresAt,
        },
      ],
      { session: mongoSessionOf(unitOfWork), ordered: true },
    );
  }

  async revokeFamily(
    unitOfWork: UnitOfWork,
    revocation: FamilyRevocation,
  ): Promise<EndedFamilyOwner | null> {
    const db = mongoSessionOf(unitOfWork);
    const sessionId = toObjectId(revocation.sessionId);
    const session = await this.sessions
      .findOneAndUpdate(
        { _id: sessionId },
        {
          $set: {
            isValid: false,
            revokedAt: revocation.now,
            revokedReason: revocation.reason,
          },
        },
      )
      .select({ user: 1, clientId: 1 })
      .session(db)
      .exec();
    await this.credentials
      .updateMany(
        { familyId: revocation.familyId, sessionId },
        { $set: { spent: true, revokedAt: revocation.now } },
      )
      .session(db)
      .exec();
    return session
      ? { userId: session.user.toString(), clientId: session.clientId }
      : null;
  }

  async reserveProofId(
    unitOfWork: UnitOfWork,
    proofIdHash: string,
    expiresAt: Date,
  ): Promise<void> {
    await this.proofIds.create([{ proofIdHash, expiresAt }], {
      session: mongoSessionOf(unitOfWork),
    });
  }

  async findSessionOfAccount(
    unitOfWork: UnitOfWork,
    sessionId: string,
    userId: string,
  ): Promise<NativeSessionOfAccount | null> {
    if (!isStorableId(sessionId)) {
      throw new MalformedIdError();
    }
    const stored = await this.sessions
      .findOne({ _id: sessionId, user: toObjectId(userId) })
      .session(mongoSessionOf(unitOfWork))
      .exec();
    return stored
      ? {
          id: stored._id.toString(),
          clientId: stored.clientId,
          isValid: stored.isValid,
          revoked: Boolean(stored.revokedAt),
          credentialPurpose: stored.credentialPurpose,
        }
      : null;
  }

  async revokeSessionCredentials(
    unitOfWork: UnitOfWork,
    sessionId: string,
    now: Date,
  ): Promise<void> {
    await this.credentials
      .updateMany(
        { sessionId: toObjectId(sessionId) },
        { $set: { spent: true, revokedAt: now } },
      )
      .session(mongoSessionOf(unitOfWork))
      .exec();
  }
}
