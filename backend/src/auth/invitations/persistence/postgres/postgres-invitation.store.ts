import { Kysely, Selectable } from 'kysely';
import { storedLocale } from '../../../../common/constants/locales';
import { PostgresTables } from '../../../../common/persistence/postgres/postgres-database';
import { postgresTransactionOf } from '../../../../common/persistence/postgres/postgres-unit-of-work';
import { storedAddress } from '../../../../common/persistence/stored-address';
import { UnitOfWork } from '../../../../common/persistence/unit-of-work';
import { ROLE_AUDIENCE } from '../../../../host/types/host-role.type';
import {
  INVITATION_PURPOSE,
  INVITATION_STATUS,
} from '../../constants/invitations';
import { InvitationStore } from '../../stores/invitation.store';
import {
  InvitationListQuery,
  InvitationTokenChange,
  NewInvitation,
  StoredInvitation,
} from '../../types/invitation';
import { InvitationsTable } from './postgres-invitations.table';

function stored(row: Selectable<InvitationsTable>): StoredInvitation {
  return {
    id: row.id,
    purpose: row.purpose,
    email: row.email,
    name: row.name ?? undefined,
    roleId: row.role_id ?? undefined,
    roleSlug: row.role_slug ?? undefined,
    audience: row.audience ?? undefined,
    clientId: row.client_id,
    invitedBy: row.invited_by ?? undefined,
    userId: row.user_id ?? undefined,
    addressGeneration: row.address_generation ?? undefined,
    locale: storedLocale(row.locale),
    tokenHash: row.token_hash,
    expiresAt: row.expires_at,
    acceptedAt: row.accepted_at ?? undefined,
    revokedAt: row.revoked_at ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class PostgresInvitationStore extends InvitationStore {
  constructor(private readonly database: Kysely<PostgresTables>) {
    super();
  }

  async insert(
    work: UnitOfWork,
    input: NewInvitation,
  ): Promise<StoredInvitation> {
    const row = await postgresTransactionOf(work)
      .insertInto('invitations')
      .values({
        purpose: input.purpose,
        email: storedAddress(input.email),
        name: input.name ?? null,
        role_id: input.roleId ?? null,
        role_slug: input.roleSlug ?? null,
        audience: input.audience ?? null,
        client_id: input.clientId,
        invited_by: input.invitedBy ?? null,
        user_id: input.userId ?? null,
        address_generation: input.addressGeneration ?? null,
        locale: input.locale,
        token_hash: input.tokenHash,
        expires_at: input.expiresAt,
        purge_after: input.purgeAfter,
        created_at: input.now,
        updated_at: input.now,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    return stored(row);
  }

  async findById(id: string): Promise<StoredInvitation | null> {
    const row = await this.database
      .selectFrom('invitations')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();
    return row ? stored(row) : null;
  }

  async takeById(
    work: UnitOfWork,
    id: string,
  ): Promise<StoredInvitation | null> {
    const row = await postgresTransactionOf(work)
      .selectFrom('invitations')
      .selectAll()
      .where('id', '=', id)
      .forUpdate()
      .executeTakeFirst();
    return row ? stored(row) : null;
  }

  async takeByTokenHash(
    work: UnitOfWork,
    tokenHash: string,
  ): Promise<StoredInvitation | null> {
    const row = await postgresTransactionOf(work)
      .selectFrom('invitations')
      .selectAll()
      .where('token_hash', '=', tokenHash)
      .forUpdate()
      .executeTakeFirst();
    return row ? stored(row) : null;
  }

  async replaceToken(
    work: UnitOfWork,
    id: string,
    input: InvitationTokenChange,
  ): Promise<StoredInvitation> {
    const row = await postgresTransactionOf(work)
      .updateTable('invitations')
      .set({
        token_hash: input.tokenHash,
        expires_at: input.expiresAt,
        purge_after: input.purgeAfter,
        updated_at: input.now,
      })
      .where('id', '=', id)
      .returningAll()
      .executeTakeFirstOrThrow();
    return stored(row);
  }

  async markAccepted(work: UnitOfWork, id: string, at: Date): Promise<void> {
    await postgresTransactionOf(work)
      .updateTable('invitations')
      .set({ accepted_at: at, updated_at: at })
      .where('id', '=', id)
      .execute();
  }

  async markRevoked(work: UnitOfWork, id: string, at: Date): Promise<void> {
    await postgresTransactionOf(work)
      .updateTable('invitations')
      .set({ revoked_at: at, updated_at: at })
      .where('id', '=', id)
      .execute();
  }

  async revokeOpenEnrolmentLinks(
    work: UnitOfWork,
    userId: string,
    at: Date,
  ): Promise<number> {
    // Lock the account even when there are no earlier links to update.
    await postgresTransactionOf(work)
      .selectFrom('users')
      .select('id')
      .where('id', '=', userId)
      .forUpdate()
      .executeTakeFirst();
    const result = await postgresTransactionOf(work)
      .updateTable('invitations')
      .set({ revoked_at: at, updated_at: at })
      .where('user_id', '=', userId)
      .where('purpose', '=', INVITATION_PURPOSE.ENROLMENT)
      .where('accepted_at', 'is', null)
      .where('revoked_at', 'is', null)
      .where('expires_at', '>', at)
      .executeTakeFirst();
    return Number(result.numUpdatedRows);
  }

  async list(query: InvitationListQuery) {
    if (query.audiences?.length === 0) return { invitations: [], total: 0 };
    let matching = this.database
      .selectFrom('invitations')
      .where('purpose', 'in', [
        INVITATION_PURPOSE.ACCOUNT,
        INVITATION_PURPOSE.FIRST_ADMIN,
      ]);
    if (query.audiences) {
      const audiences = query.audiences;
      matching = matching.where((eb) =>
        eb.or([
          eb('audience', 'in', audiences),
          ...(audiences.includes(ROLE_AUDIENCE.CUSTOMER)
            ? [eb('audience', 'is', null)]
            : []),
        ]),
      );
    }
    if (query.status === INVITATION_STATUS.ACCEPTED)
      matching = matching.where('accepted_at', 'is not', null);
    if (query.status === INVITATION_STATUS.REVOKED)
      matching = matching
        .where('accepted_at', 'is', null)
        .where('revoked_at', 'is not', null);
    if (
      query.status === INVITATION_STATUS.PENDING ||
      query.status === INVITATION_STATUS.EXPIRED
    ) {
      matching = matching
        .where('accepted_at', 'is', null)
        .where('revoked_at', 'is', null)
        .where(
          'expires_at',
          query.status === INVITATION_STATUS.PENDING ? '>' : '<=',
          query.now,
        );
    }
    const count = await matching
      .select((eb) => eb.fn.countAll<string>().as('total'))
      .executeTakeFirstOrThrow();
    const rows = await matching
      .selectAll()
      .orderBy('created_at', 'desc')
      .orderBy('id', 'desc')
      .offset((query.page - 1) * query.limit)
      .limit(query.limit)
      .execute();
    return { invitations: rows.map(stored), total: Number(count.total) };
  }

  async hasOpenAdminInvitation(
    work: UnitOfWork,
    adminRole: string,
    now: Date,
  ): Promise<boolean> {
    const row = await postgresTransactionOf(work)
      .selectFrom('invitations')
      .select('id')
      .where((eb) =>
        eb.or([
          eb('purpose', '=', INVITATION_PURPOSE.FIRST_ADMIN),
          eb.and([
            eb('purpose', '=', INVITATION_PURPOSE.ACCOUNT),
            eb('role_slug', '=', adminRole),
          ]),
        ]),
      )
      .where('accepted_at', 'is', null)
      .where('revoked_at', 'is', null)
      .where('expires_at', '>', now)
      .executeTakeFirst();
    return row !== undefined;
  }
}
