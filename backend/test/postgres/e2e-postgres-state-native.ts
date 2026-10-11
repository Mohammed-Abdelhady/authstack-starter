import type { INestApplication } from '@nestjs/common';
import type { Kysely, Selectable } from 'kysely';
import type {
  AuthorizationTransactionsTable,
  PostgresTables,
} from '../../src/common/persistence/postgres/postgres-database';
import { NativeAuthorizationStore } from '../../src/session/native/authorize/native-authorization.store';
import {
  type AuthorizationReadGate,
  type E2eNativeState,
  type StoredAuthorizationRequest,
} from '../utils/e2e-state-native';

function toRequest(
  row: Selectable<AuthorizationTransactionsTable> | undefined,
): StoredAuthorizationRequest | null {
  if (!row) return null;
  return {
    transactionId: row.transaction_id,
    clientId: row.client_id,
    redirectUri: row.redirect_uri,
    consumed: row.consumed,
    requestedScopes: row.requested_scopes,
    ...(row.code_hash === null ? {} : { codeHash: row.code_hash }),
    ...(row.user_id === null ? {} : { userId: row.user_id }),
  };
}

/** Both reads of a pending request count: the first one made is the one held. */
function pauseNextRead(store: NativeAuthorizationStore): AuthorizationReadGate {
  let announceReached = () => {};
  let releaseRead = () => {};
  let shouldPause = true;
  const reached = new Promise<void>((resolve) => {
    announceReached = resolve;
  });
  const blocked = new Promise<void>((resolve) => {
    releaseRead = resolve;
  });
  const holdFirst = async <Result>(read: () => Promise<Result>) => {
    if (!shouldPause) return read();
    shouldPause = false;
    const answer = await read();
    announceReached();
    await blocked;
    return answer;
  };
  const findPending = store.findPending.bind(store);
  const findPendingIn = store.findPendingIn.bind(store);
  const spies = [
    jest
      .spyOn(store, 'findPending')
      .mockImplementation((...args) => holdFirst(() => findPending(...args))),
    jest
      .spyOn(store, 'findPendingIn')
      .mockImplementation((...args) => holdFirst(() => findPendingIn(...args))),
  ];

  return {
    reached,
    release: releaseRead,
    restore: () => spies.forEach((spy) => spy.mockRestore()),
  };
}

export function postgresNativeState(
  app: INestApplication,
  database: Kysely<PostgresTables>,
): E2eNativeState {
  return {
    authorizationRequest: async (transactionId) =>
      toRequest(
        await database
          .selectFrom('authorization_transactions')
          .selectAll()
          .where('transaction_id', '=', transactionId)
          .executeTakeFirst(),
      ),
    authorizationRequestForCode: async (codeHash) =>
      toRequest(
        await database
          .selectFrom('authorization_transactions')
          .selectAll()
          .where('code_hash', '=', codeHash)
          .executeTakeFirst(),
      ),
    authorizationRequestCount: async () => {
      const rows = await database
        .selectFrom('authorization_transactions')
        .select('id')
        .execute();
      return rows.length;
    },
    approvedAuthorizationRequestCount: async (transactionId) => {
      const rows = await database
        .selectFrom('authorization_transactions')
        .select('id')
        .where('transaction_id', '=', transactionId)
        .where('code_hash', 'is not', null)
        .execute();
      return rows.length;
    },
    storeAuthorizationRedirect: async (transactionId, redirectUri) => {
      await database
        .updateTable('authorization_transactions')
        .set({ redirect_uri: redirectUri })
        .where('transaction_id', '=', transactionId)
        .execute();
    },
    pauseNextAuthorizationRead: () =>
      pauseNextRead(app.get(NativeAuthorizationStore, { strict: false })),

    credentialCount: async () => {
      const rows = await database
        .selectFrom('native_credentials')
        .select('id')
        .execute();
      return rows.length;
    },
    credentialsForTokens: async (tokenHashes) => {
      if (tokenHashes.length === 0) return [];
      const rows = await database
        .selectFrom('native_credentials')
        .select([
          'session_id',
          'purpose',
          'spent',
          'revoked_at',
          'proof_key_thumbprint',
        ])
        .where('token_hash', 'in', tokenHashes)
        .orderBy('purpose')
        .execute();
      return rows.map((row) => ({
        sessionId: row.session_id,
        purpose: row.purpose,
        spent: row.spent,
        ...(row.revoked_at === null ? {} : { revokedAt: row.revoked_at }),
        ...(row.proof_key_thumbprint === null
          ? {}
          : { proofKeyThumbprint: row.proof_key_thumbprint }),
      }));
    },
  };
}
