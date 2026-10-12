import type { INestApplication } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import type { Model } from 'mongoose';
import {
  AuthorizationTransaction,
  AuthorizationTransactionDocument,
} from '../../src/session/persistence/mongo/schemas/authorization-transaction.schema';
import {
  NativeCredential,
  NativeCredentialDocument,
} from '../../src/session/persistence/mongo/schemas/native-credential.schema';
import type {
  AuthorizationReadGate,
  E2eNativeState,
  StoredAuthorizationRequest,
} from './e2e-state-native';

type Transactions = Model<AuthorizationTransactionDocument>;

function toRequest(
  stored: AuthorizationTransaction | null,
): StoredAuthorizationRequest | null {
  if (!stored) return null;
  return {
    transactionId: stored.transactionId,
    clientId: stored.clientId,
    redirectUri: stored.redirectUri,
    consumed: stored.consumed,
    requestedScopes: stored.requestedScopes,
    ...(stored.codeHash === undefined ? {} : { codeHash: stored.codeHash }),
    ...(stored.userId === undefined
      ? {}
      : { userId: stored.userId.toString() }),
  };
}

function pauseNextRead(transactions: Transactions): AuthorizationReadGate {
  let announceReached = () => {};
  let releaseRead = () => {};
  let shouldPause = true;
  const reached = new Promise<void>((resolve) => {
    announceReached = resolve;
  });
  const blocked = new Promise<void>((resolve) => {
    releaseRead = resolve;
  });
  const originalFindOne = transactions.findOne.bind(transactions);
  const spy = jest
    .spyOn(transactions, 'findOne')
    .mockImplementation((...args) => {
      const query = originalFindOne(...args);
      if (!shouldPause) {
        return query;
      }
      shouldPause = false;
      const originalExec = query.exec.bind(query);
      jest.spyOn(query, 'exec').mockImplementation(async (...execArgs) => {
        const transaction = await originalExec(...execArgs);
        announceReached();
        await blocked;
        return transaction;
      });
      return query;
    });

  return {
    reached,
    release: releaseRead,
    restore: () => spy.mockRestore(),
  };
}

export function mongoNativeState(app: INestApplication): E2eNativeState {
  // Each model is asked for when a case first needs it.
  const transactions = () =>
    app.get<Transactions>(getModelToken(AuthorizationTransaction.name));
  const credentials = () =>
    app.get<Model<NativeCredentialDocument>>(
      getModelToken(NativeCredential.name),
    );
  return {
    authorizationRequest: async (transactionId) =>
      toRequest(await transactions().findOne({ transactionId }).lean().exec()),
    authorizationRequestForCode: async (codeHash) =>
      toRequest(await transactions().findOne({ codeHash }).lean().exec()),
    authorizationRequestCount: () => transactions().countDocuments().exec(),
    approvedAuthorizationRequestCount: (transactionId) =>
      transactions()
        .countDocuments({ transactionId, codeHash: { $exists: true } })
        .exec(),
    storeAuthorizationRedirect: async (transactionId, redirectUri) => {
      await transactions().collection.updateOne(
        { transactionId },
        { $set: { redirectUri } },
      );
    },
    pauseNextAuthorizationRead: () => pauseNextRead(transactions()),

    credentialCount: () => credentials().countDocuments().exec(),
    credentialsForTokens: async (tokenHashes) => {
      const stored = await credentials()
        .find({ tokenHash: { $in: tokenHashes } })
        .sort({ purpose: 1 })
        .lean()
        .exec();
      return stored.map((credential) => ({
        sessionId: credential.sessionId.toString(),
        purpose: credential.purpose,
        spent: credential.spent,
        ...(credential.revokedAt === undefined
          ? {}
          : { revokedAt: credential.revokedAt }),
        ...(credential.proofKeyThumbprint === undefined
          ? {}
          : { proofKeyThumbprint: credential.proofKeyThumbprint }),
      }));
    },
  };
}
