import { Injectable } from '@nestjs/common';
import type { UnitOfWork } from '../../../common/persistence/unit-of-work';
import { postgresTransactionOf } from '../../../common/persistence/postgres/postgres-unit-of-work';
import {
  type CredentialRelyingParty, // feature:passkeys
  EnrolmentStore,
} from '../../enrolment/enrolment.store';
import { CREDENTIAL_PURPOSE } from '../../constants/credential-purpose';
import { REVOKED_REASON } from '../../constants/revoked-reason';
import {
  STORED_SESSION_COLUMNS,
  toStoredSession,
} from './postgres-session-rows';
import { toUuid } from './postgres-issuance-mappers';
import { withPasskeyColumns } from '../../../auth/passkeys/persistence/postgres/postgres-passkey.tables'; // feature:passkeys

@Injectable()
export class PostgresEnrolmentStore extends EnrolmentStore {
  // feature:passkeys:start
  override async hasCredentialIn(
    work: UnitOfWork,
    userId: string,
    credentialId: string,
    relyingParty: CredentialRelyingParty,
  ): Promise<boolean> {
    const credential = await withPasskeyColumns(postgresTransactionOf(work))
      .selectFrom('passkeys')
      .select('id')
      .where('user_id', '=', toUuid(userId))
      .where('credential_id', '=', credentialId)
      .where((where) =>
        relyingParty.includesUnmarked
          ? where.or([
              where('rp_id', '=', relyingParty.rpId),
              where('rp_id', 'is', null),
            ])
          : where('rp_id', '=', relyingParty.rpId),
      )
      .executeTakeFirst();
    return credential !== undefined;
  }
  // feature:passkeys:end

  async readSessionIn(work: UnitOfWork, sessionId: string) {
    const row = await postgresTransactionOf(work)
      .selectFrom('sessions')
      .select(STORED_SESSION_COLUMNS)
      .where('id', '=', toUuid(sessionId))
      .forUpdate()
      .noWait()
      .executeTakeFirst();
    return row ? toStoredSession(row) : null;
  }

  async retireIn(work: UnitOfWork, sessionId: string, now: Date) {
    const result = await postgresTransactionOf(work)
      .updateTable('sessions')
      .set({
        is_valid: false,
        revoked_at: now,
        revoked_reason: REVOKED_REASON.ENROLMENT_PROMOTED,
      })
      .where('id', '=', toUuid(sessionId))
      .where('credential_purpose', '=', CREDENTIAL_PURPOSE.ENROLMENT)
      .where('is_valid', '=', true)
      .where('revoked_at', 'is', null)
      .where('expires_at', '>', now)
      .where('idle_expires_at', '>', now)
      .executeTakeFirst();
    return result.numUpdatedRows === 1n;
  }

  async replaceIn(
    work: UnitOfWork,
    userId: string,
    clientId: string,
    now: Date,
  ): Promise<string[]> {
    const ended = await postgresTransactionOf(work)
      .updateTable('sessions')
      .set({
        is_valid: false,
        revoked_at: now,
        revoked_reason: REVOKED_REASON.ENROLMENT_REPLACED,
      })
      .where('user_id', '=', toUuid(userId))
      .where('client_id', '=', clientId)
      .where('credential_purpose', '=', CREDENTIAL_PURPOSE.ENROLMENT)
      .where('is_valid', '=', true)
      .where('revoked_at', 'is', null)
      .returning('id')
      .execute();
    return ended.map(({ id }) => id);
  }
}
