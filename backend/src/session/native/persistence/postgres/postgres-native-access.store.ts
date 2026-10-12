import { Kysely } from 'kysely';
import { CREDENTIAL_PURPOSE } from '../../../constants/credential-purpose';
import {
  FIRST_USE,
  FirstUse,
  LiveAccessCredential,
  NativeAccessStore,
} from '../../credentials/native-access.store';
import { PostgresTables } from '../../../../common/persistence/postgres/postgres-database';
import { toUuid } from '../../../persistence/postgres/postgres-issuance-mappers';
import { autocommit } from '../../../../auth/persistence/postgres/postgres-pending-codes-database';

/**
 * Each read is a committed authority read: one statement on the primary,
 * outside any transaction, so it sees every revocation that has returned.
 */
export class PostgresNativeAccessStore extends NativeAccessStore {
  constructor(private readonly database: Kysely<PostgresTables>) {
    super();
  }

  async readCommittedAccessCredential(
    tokenHash: string,
    now: Date,
  ): Promise<LiveAccessCredential | null> {
    const row = await autocommit({}, () =>
      this.database
        .selectFrom('native_credentials')
        .select(['id', 'session_id', 'proof_key_thumbprint'])
        .where('token_hash', '=', tokenHash)
        .where('purpose', '=', CREDENTIAL_PURPOSE.NATIVE_ACCESS)
        .where('spent', '=', false)
        .where('revoked_at', 'is', null)
        .where('expires_at', '>', now)
        .executeTakeFirst(),
    );
    return row
      ? {
          id: row.id,
          sessionId: row.session_id,
          proofKeyThumbprint: row.proof_key_thumbprint,
        }
      : null;
  }

  async markFirstUse(credentialId: string, now: Date): Promise<FirstUse> {
    const marked = await autocommit({}, () =>
      this.database
        .updateTable('native_credentials')
        .set({ first_used_at: now })
        .where('id', '=', toUuid(credentialId))
        .where('spent', '=', false)
        .where('revoked_at', 'is', null)
        .where('first_used_at', 'is', null)
        .returning('id')
        .execute(),
    );
    return marked.length === 0 ? FIRST_USE.NOT_MARKED : FIRST_USE.MARKED;
  }

  async readCommittedAccessIsLive(
    credentialId: string,
    now: Date,
  ): Promise<boolean> {
    const row = await autocommit({}, () =>
      this.database
        .selectFrom('native_credentials')
        .select('id')
        .where('id', '=', toUuid(credentialId))
        .where('spent', '=', false)
        .where('revoked_at', 'is', null)
        .where('expires_at', '>', now)
        .executeTakeFirst(),
    );
    return row !== undefined;
  }
}
